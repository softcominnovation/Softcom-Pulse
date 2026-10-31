import test from "node:test";
import assert from "node:assert/strict";
import { evaluateUsage, recoveryLimit } from "../lib/notifications/usage.ts";
import { agentMonitoringSchema, cardMetricsSchema } from "../lib/config/agent-monitoring.ts";
import { filesystemCapacity } from "../lib/monitoring/filesystem-capacity.ts";
import { agentBindingValid } from "../lib/monitoring/agent-monitoring.ts";
import { notificationDecision, defaultNotificationPolicy } from "../lib/notifications/policy.ts";
import { notificationText } from "../lib/notifications/contracts.ts";
import { presentSignalService } from "../lib/server/signal/service-view.ts";
import { readAgentMonitoring, saveAgentMonitoring } from "../lib/server/config/agent-monitoring.ts";
import { deriveRatio } from "../lib/server/zabbix/mapping.ts";
const start = 1800000000000;
const sample = (time, value=75, extra={}) => ({ metric:"cpu", limit:70, token:String(time), sampleAt:time, validUntil:time+120000, value, rule:"rule", ...extra });
test("usage confirms distinct evidence over time, applies hysteresis and survives restart", () => {
  let result=evaluateUsage(undefined,sample(start),start); assert.equal(result.state,"unknown");
  result=evaluateUsage(JSON.parse(JSON.stringify(result.checkpoint)),sample(start+60000),start+60000); assert.equal(result.state,"unavailable");
  result=evaluateUsage(result.checkpoint,sample(start+120000,67),start+120000); assert.equal(result.state,"unavailable");
  result=evaluateUsage(result.checkpoint,sample(start+180000,60),start+180000); assert.equal(result.state,"unavailable");
  result=evaluateUsage(result.checkpoint,sample(start+240000,60),start+240000); assert.equal(result.state,"healthy");
});
test("cached samples, missing data and rule edits cannot manufacture confirmation", () => {
  const first=evaluateUsage(undefined,sample(start),start);
  assert.equal(evaluateUsage(first.checkpoint,sample(start),start+90000).state,"unknown");
  const missing=evaluateUsage(first.checkpoint,sample(start+60000,null),start+60000);
  assert.equal(missing.checkpoint.candidate,null);
  assert.equal(evaluateUsage(missing.checkpoint,sample(start+120000),start+120000).state,"unknown");
  assert.equal(evaluateUsage(first.checkpoint,sample(start+60000,75,{rule:"edited"}),start+60000).state,"unknown");
});
test("disk confirms after 30s, repeated high state is stable, low thresholds recover", () => {
  const first=evaluateUsage(undefined,sample(start,75,{metric:"disk"}),start);
  const high=evaluateUsage(first.checkpoint,sample(start+30000,75,{metric:"disk"}),start+30000);
  assert.equal(high.state,"unavailable");
  assert.equal(evaluateUsage(high.checkpoint,sample(start+60000,80,{metric:"disk"}),start+60000).checkpoint.candidate,null);
  assert.equal(recoveryLimit(70),65); assert.equal(recoveryLimit(1),0.5);
});
const metric=value=>({value,unit:"bytes",quality:"fresh",observedAt:new Date(start).toISOString(),validUntil:new Date(start+120000).toISOString()});
const volumes=[{key:"one",name:"/",metrics:{diskUsedBytes:metric(80),diskTotalBytes:metric(100)}},{key:"two",name:"/data",metrics:{diskUsedBytes:metric(20),diskTotalBytes:metric(400)}}];
test("capacity is weighted and never silently drops a missing or invalid volume", () => {
  const selection={filesystemKeys:["one","two"],independentVolumesConfirmed:true};
  assert.equal(filesystemCapacity(volumes,selection).usagePercent.value,20);
  assert.equal(filesystemCapacity(volumes.slice(0,1),selection).usagePercent,undefined);
  assert.equal(filesystemCapacity(volumes,{...selection,independentVolumesConfirmed:false}).coverage,"incomplete");
  assert.equal(filesystemCapacity(volumes,{filesystemKeys:[],independentVolumesConfirmed:false}).coverage,"unconfigured");
  assert.equal(filesystemCapacity([{...volumes[0],metrics:{diskUsedBytes:metric(200),diskTotalBytes:metric(100)}}]).coverage,"incomplete");
});
test("configuration validates pairs, limits, volume ownership syntax and independent selection", () => {
  for(const pair of [["cpu","memory"],["cpu","disk"],["disk","memory"]]) assert.deepEqual(cardMetricsSchema.parse(pair),pair);
  for(const pair of [["cpu","cpu"],["cpu","memory","disk"],["ram","cpu"]]) assert.equal(cardMetricsSchema.safeParse(pair).success,false);
  const config={schemaVersion:1,vmBinding:{parentHostKey:"PARENT",vmKey:"vm-"+"a".repeat(32)},capacity:{filesystemKeys:[],independentVolumesConfirmed:false},thresholds:{cpu:null,memory:70,disk:null}};
  assert.equal(agentMonitoringSchema.safeParse(config).success,true);
  assert.equal(agentMonitoringSchema.safeParse({...config,thresholds:{...config.thresholds,disk:70}}).success,false);
  const diskOnly={...config,thresholds:{cpu:null,memory:null,disk:52}};
  const missingCapacity=agentMonitoringSchema.safeParse(diskOnly);
  assert.deepEqual(missingCapacity.error.issues[0].path,["capacity","filesystemKeys"]);
  assert.equal(agentMonitoringSchema.safeParse({...diskOnly,capacity:{filesystemKeys:["device-"+"a".repeat(32)],independentVolumesConfirmed:false}}).success,true);
  assert.equal(agentMonitoringSchema.safeParse({...config,thresholds:{...config.thresholds,cpu:101}}).success,false);
  assert.equal(agentBindingValid("agent",config,[{vms:[{name:"vm",parentHostKey:"PARENT",vmKey:config.vmBinding.vmKey,linuxHostKey:"agent"}]}]),true);
  assert.equal(agentBindingValid("new-agent",config,[{vms:[{name:"vm",parentHostKey:"PARENT",vmKey:config.vmBinding.vmKey,linuxHostKey:"agent"}]}]),false);
});
test("usage is warning audio while attention remains off and global scope still applies", () => {
  const policy=defaultNotificationPolicy(),event={targetRef:"resource:00000000-0000-4000-8000-000000000001",critical:true,monitoringEnabled:true,eventType:"usage",severity:"warning"};
  assert.deepEqual(notificationDecision(policy,event),{enabled:true,sound:"warning"});
  assert.equal(notificationDecision(policy,{...event,critical:false}).enabled,false);
  assert.equal(notificationDecision(policy,{...event,eventType:"attention"}).enabled,false);
  assert.equal(notificationText({messageCode:"usage_disk",metricContext:{metric:"disk",valuePercent:72.4,thresholdPercent:70,recoveryPercent:65,source:"agent",observedAt:new Date(start).toISOString(),coverage:"2 volumes"}}),"Disco da VM em 72,4% · limite 70%");
});

test("Signal disk follows the resolved worker and never falls back to another machine", () => {
 const row={cardMetrics:["cpu","disk"]};
 const now=Date.now();const hosts=["one","two"].map((hostKey,index)=>({hostKey,agentCard:{capacity:{usagePercent:{value:index?80:20,quality:"fresh",validUntil:new Date(now+60000).toISOString()}}}}));
 const resolution=hostKey=>({candidate:hostKey?{hostKey,cpu:3,memory:4,uptimeSeconds:1}:null});
 assert.equal(presentSignalService(row,resolution("one"),[],hosts).disk,20);
 assert.equal(presentSignalService(row,resolution("two"),[],hosts).disk,80);
 assert.equal(presentSignalService(row,resolution("missing"),[],hosts).disk,null);
 assert.equal(presentSignalService(row,resolution(null),[],hosts).disk,null);
 hosts[1].agentCard.capacity.usagePercent.quality="stale";
 assert.equal(presentSignalService(row,resolution("two"),[],hosts).disk,null);
});

test("demo Agent configuration simulates settings without accessing the database", async () => {
 const previous=process.env.PULSE_DEMO_MODE, e2e=process.env.PULSE_E2E;
 process.env.PULSE_DEMO_MODE="1";delete process.env.PULSE_E2E;
 try {
  const data=await readAgentMonitoring("linux-signal-worker");assert.equal(data.demo,true);assert.equal(data.revision,0);
  const saved=await saveAgentMonitoring(data.hostKey,{expectedRevision:0,vmBinding:data.currentVmBinding,capacity:{filesystemKeys:[data.volumes[0].key],independentVolumesConfirmed:false},thresholds:{cpu:70,memory:null,disk:70},cardMetrics:["cpu","disk"]});
  assert.equal(saved.settings.thresholds.disk,70);assert.equal(saved.capacity.coverage,"complete");
  assert.equal((await readAgentMonitoring(data.hostKey)).revision,0);
 } finally { if(previous===undefined)delete process.env.PULSE_DEMO_MODE;else process.env.PULSE_DEMO_MODE=previous;if(e2e===undefined)delete process.env.PULSE_E2E;else process.env.PULSE_E2E=e2e; }
});

test("derived RAM keeps the oldest evidence time and the newest real operand sample", () => {
 const total=metric(100), used={...metric(80),sampleObservedAt:new Date(start+60000).toISOString()};
 const metrics={memoryTotalBytes:total,memoryUsedBytes:used};
 deriveRatio(metrics,"memoryUsedBytes","memoryTotalBytes","memoryUsagePercent");
 assert.equal(metrics.memoryUsagePercent.value,80);
 assert.equal(metrics.memoryUsagePercent.observedAt,total.observedAt);
 assert.equal(metrics.memoryUsagePercent.sampleObservedAt,used.sampleObservedAt);
 assert.equal(metrics.memoryUsagePercent.validUntil,total.validUntil);
});
