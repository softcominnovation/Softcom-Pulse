import "server-only";
import { defaultDashboardBlocks, effectiveOptions, type PresentationDocument } from "../../config/presentation.ts";
import type { ResourceConfig } from "../../config/resources.ts";
import type { ExternalServicePublic } from "../../config/external-services.ts";
import type { StandaloneVpsCard, StandaloneVpsDetail, StandaloneVpsHighlight } from "../../config/standalone-vps.ts";
import type {
  AvailabilityPanelData,
  ConfiguredResource,
  Container,
  History,
  Host,
  Metric,
  Overview,
  Problem,
  ProbeCard,
  ReadResult,
  SignalFlowBlockData,
  SignalOverviewCard,
  Summary,
  VirtualMachine,
  VmWorkloads,
} from "../../monitoring/contracts.ts";
import type { Template } from "../../monitoring/templates.ts";

export function isDemoMode() {
  return process.env.PULSE_DEMO_MODE === "1" && process.env.PULSE_E2E !== "1";
}

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function metric(
  value: number | null,
  unit: Metric["unit"] = "percent",
  observedAt = nowIso(-12_000)
): Metric {
  return {
    value,
    unit,
    observedAt: value === null ? null : observedAt,
    quality: value === null ? "missing" : "fresh",
    validUntil: nowIso(3_600_000),
  };
}

function makeStrip(length = 40, warnIndices: number[] = []) {
  return Array.from({ length }, (_, index) => (warnIndices.includes(index) ? 1 : 0));
}

const vmBlueprints: Array<{
  vmId: string;
  name: string;
  displayName: string;
  linuxHostKey: string | null;
  cpu: number;
  vcpu: number;
  ramUsedGb: number;
  ramTotalGb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  uptimeDays: number;
  isTemplate?: boolean;
}> = [
  { vmId: "101", name: "vm-retaguarda-db", displayName: "Retaguarda · PostgreSQL Primário", linuxHostKey: "linux-retaguarda-db", cpu: 34.2, vcpu: 8, ramUsedGb: 22.4, ramTotalGb: 32, diskUsedGb: 310, diskTotalGb: 500, uptimeDays: 48 },
  { vmId: "102", name: "vm-api-fiscal", displayName: "API Fiscal · NFC-e / NF-e", linuxHostKey: "linux-api-fiscal", cpu: 28.6, vcpu: 6, ramUsedGb: 10.8, ramTotalGb: 16, diskUsedGb: 94, diskTotalGb: 200, uptimeDays: 31 },
  { vmId: "103", name: "vm-pdv-sync", displayName: "PDV Sync & Mensageria", linuxHostKey: "linux-pdv-sync", cpu: 21.4, vcpu: 4, ramUsedGb: 6.2, ramTotalGb: 8, diskUsedGb: 58, diskTotalGb: 120, uptimeDays: 29 },
  { vmId: "104", name: "vm-whatsapp-evo", displayName: "Hub WhatsApp · Evolution Cluster", linuxHostKey: "linux-whatsapp-evo", cpu: 64.5, vcpu: 6, ramUsedGb: 12.6, ramTotalGb: 16, diskUsedGb: 118, diskTotalGb: 160, uptimeDays: 19 },
  { vmId: "105", name: "vm-signal-worker", displayName: "Softcom Signal · Workers & Filas", linuxHostKey: "linux-signal-worker", cpu: 19.8, vcpu: 4, ramUsedGb: 5.4, ramTotalGb: 8, diskUsedGb: 42, diskTotalGb: 100, uptimeDays: 42 },
  { vmId: "106", name: "vm-redis-cache", displayName: "Redis Cluster · Sessões & Filas", linuxHostKey: null, cpu: 14.2, vcpu: 4, ramUsedGb: 11.2, ramTotalGb: 16, diskUsedGb: 28, diskTotalGb: 80, uptimeDays: 64 },
  { vmId: "107", name: "vm-portal-contador", displayName: "Portal do Contador & XML", linuxHostKey: null, cpu: 16.5, vcpu: 4, ramUsedGb: 4.8, ramTotalGb: 8, diskUsedGb: 76, diskTotalGb: 150, uptimeDays: 27 },
  { vmId: "108", name: "vm-softcom-pay", displayName: "Softcom Pay · Gateway PIX & TEF", linuxHostKey: null, cpu: 24.1, vcpu: 4, ramUsedGb: 6.9, ramTotalGb: 8, diskUsedGb: 64, diskTotalGb: 120, uptimeDays: 53 },
  { vmId: "109", name: "vm-bff-mobile", displayName: "BFF Mobile & Autenticação", linuxHostKey: null, cpu: 18.0, vcpu: 4, ramUsedGb: 4.1, ramTotalGb: 8, diskUsedGb: 39, diskTotalGb: 80, uptimeDays: 36 },
  { vmId: "110", name: "vm-relatorios-bi", displayName: "BI & Relatórios Analíticos", linuxHostKey: null, cpu: 31.7, vcpu: 6, ramUsedGb: 13.5, ramTotalGb: 16, diskUsedGb: 210, diskTotalGb: 300, uptimeDays: 22 },
  { vmId: "111", name: "vm-nfe-eventos", displayName: "Manifestação & Eventos Sefaz", linuxHostKey: null, cpu: 12.3, vcpu: 2, ramUsedGb: 2.9, ramTotalGb: 4, diskUsedGb: 34, diskTotalGb: 60, uptimeDays: 41 },
  { vmId: "112", name: "vm-backup-agent", displayName: "Agente de Backup & Snapshots", linuxHostKey: null, cpu: 8.4, vcpu: 2, ramUsedGb: 2.1, ramTotalGb: 4, diskUsedGb: 45, diskTotalGb: 80, uptimeDays: 64 },
  { vmId: "113", name: "vm-proxy-ingress", displayName: "Traefik Ingress & TLS Edge", linuxHostKey: null, cpu: 11.6, vcpu: 2, ramUsedGb: 1.8, ramTotalGb: 4, diskUsedGb: 22, diskTotalGb: 40, uptimeDays: 64 },
  { vmId: "114", name: "vm-observabilidade", displayName: "Zabbix Proxy & Coletor Pulse", linuxHostKey: null, cpu: 15.9, vcpu: 4, ramUsedGb: 5.0, ramTotalGb: 8, diskUsedGb: 68, diskTotalGb: 120, uptimeDays: 18 },
  { vmId: "901", name: "tpl-ubuntu-2404-docker", displayName: "Template Ubuntu 24.04 · Docker Engine", linuxHostKey: null, cpu: 0, vcpu: 4, ramUsedGb: 0, ramTotalGb: 8, diskUsedGb: 12, diskTotalGb: 60, uptimeDays: 0, isTemplate: true },
  { vmId: "902", name: "tpl-debian-12-worker", displayName: "Template Debian 12 · Worker Base", linuxHostKey: null, cpu: 0, vcpu: 2, ramUsedGb: 0, ramTotalGb: 4, diskUsedGb: 9, diskTotalGb: 40, uptimeDays: 0, isTemplate: true },
];

export function buildDemoHosts(): Host[] {
  const observedAt = nowIso(-10_000);
  const evidence = {
    source: "zabbix" as const,
    observedAt,
    basis: "item" as const,
    validUntil: nowIso(3_600_000),
  };

  const vms: VirtualMachine[] = vmBlueprints.map((bp) => {
    const ramUsedBytes = bp.ramUsedGb * 1024 ** 3;
    const ramTotalBytes = bp.ramTotalGb * 1024 ** 3;
    const diskUsedBytes = bp.diskUsedGb * 1024 ** 3;
    const diskTotalBytes = bp.diskTotalGb * 1024 ** 3;
    const ramPct = bp.ramTotalGb > 0 ? Number(((bp.ramUsedGb / bp.ramTotalGb) * 100).toFixed(1)) : 0;
    const diskPct = bp.diskTotalGb > 0 ? Number(((bp.diskUsedGb / bp.diskTotalGb) * 100).toFixed(1)) : 0;
    return {
      vmKey: `qemu/${bp.vmId}`,
      vmId: bp.vmId,
      name: bp.name,
      displayName: bp.displayName,
      presentationStatus: "ready",
      parentHostKey: "ASGARD",
      state: bp.isTemplate ? "stopped" : "running",
      linuxHostKey: bp.linuxHostKey,
      evidence,
      metrics: {
        cpuUsagePercent: metric(bp.cpu, "percent", observedAt),
        provisionedCpuCount: metric(bp.vcpu, "count", observedAt),
        memoryUsedBytes: metric(ramUsedBytes, "bytes", observedAt),
        memoryTotalBytes: metric(ramTotalBytes, "bytes", observedAt),
        memoryUsagePercent: metric(ramPct, "percent", observedAt),
        diskUsedBytes: metric(diskUsedBytes, "bytes", observedAt),
        diskTotalBytes: metric(diskTotalBytes, "bytes", observedAt),
        diskUsagePercent: metric(diskPct, "percent", observedAt),
        uptimeSeconds: metric(bp.uptimeDays * 86400, "seconds", observedAt),
      },
    };
  });

  const asgard: Host = {
    hostKey: "ASGARD",
    name: "ASGARD",
    displayName: "ASGARD · Cluster Proxmox Principal",
    presentationStatus: "ready",
    role: "hypervisor",
    availability: "reachable",
    evidence,
    metrics: {
      cpuUsagePercent: metric(29.4, "percent", observedAt),
      osCpuCount: metric(64, "count", observedAt),
      memoryUsedBytes: metric(112 * 1024 ** 3, "bytes", observedAt),
      memoryTotalBytes: metric(192 * 1024 ** 3, "bytes", observedAt),
      memoryUsagePercent: metric(58.3, "percent", observedAt),
      diskUsedBytes: metric(1420 * 1024 ** 3, "bytes", observedAt),
      diskTotalBytes: metric(3200 * 1024 ** 3, "bytes", observedAt),
      diskUsagePercent: metric(44.4, "percent", observedAt),
      networkReceiveBitsPerSecond: metric(184_500_000, "bits/s", observedAt),
      networkTransmitBitsPerSecond: metric(142_300_000, "bits/s", observedAt),
      uptimeSeconds: metric(64 * 86400 + 14_200, "seconds", observedAt),
    },
    storages: [
      {
        key: "nvme-vmstore",
        name: "nvme-vmstore (ZFS Mirror NVMe)",
        metrics: {
          diskUsagePercent: metric(46.2, "percent", observedAt),
          diskUsedBytes: metric(924 * 1024 ** 3, "bytes", observedAt),
          diskTotalBytes: metric(2000 * 1024 ** 3, "bytes", observedAt),
        },
      },
      {
        key: "local-zfs",
        name: "local-zfs (Sistema & Templates)",
        metrics: {
          diskUsagePercent: metric(38.5, "percent", observedAt),
          diskUsedBytes: metric(385 * 1024 ** 3, "bytes", observedAt),
          diskTotalBytes: metric(1000 * 1024 ** 3, "bytes", observedAt),
        },
      },
      {
        key: "pbs-backup",
        name: "pbs-backup (Proxmox Backup Server)",
        metrics: {
          diskUsagePercent: metric(61.8, "percent", observedAt),
          diskUsedBytes: metric(2472 * 1024 ** 3, "bytes", observedAt),
          diskTotalBytes: metric(4000 * 1024 ** 3, "bytes", observedAt),
        },
      },
    ],
    filesystems: [
      {
        key: "fs-root",
        name: "/ (rpool/ROOT/pve-1)",
        metrics: {
          diskUsagePercent: metric(24.1, "percent", observedAt),
          diskUsedBytes: metric(48 * 1024 ** 3, "bytes", observedAt),
          diskTotalBytes: metric(200 * 1024 ** 3, "bytes", observedAt),
        },
      },
    ],
    interfaces: [
      {
        key: "vmbr0",
        name: "vmbr0 · 10GbE LAN Operação",
        metrics: {
          networkReceiveBitsPerSecond: metric(184_500_000, "bits/s", observedAt),
          networkTransmitBitsPerSecond: metric(142_300_000, "bits/s", observedAt),
        },
      },
      {
        key: "vmbr1",
        name: "vmbr1 · VLAN Bancos & Storage",
        metrics: {
          networkReceiveBitsPerSecond: metric(96_200_000, "bits/s", observedAt),
          networkTransmitBitsPerSecond: metric(88_400_000, "bits/s", observedAt),
        },
      },
    ],
    vms: vms.filter((vm) => !vm.name.startsWith("tpl-")),
  };

  const linuxHosts: Host[] = vmBlueprints
    .filter((bp) => bp.linuxHostKey !== null)
    .map((bp) => {
      const ramUsedBytes = bp.ramUsedGb * 1024 ** 3;
      const ramTotalBytes = bp.ramTotalGb * 1024 ** 3;
      const diskUsedBytes = bp.diskUsedGb * 1024 ** 3;
      const diskTotalBytes = bp.diskTotalGb * 1024 ** 3;
      const ramPct = Number(((bp.ramUsedGb / bp.ramTotalGb) * 100).toFixed(1));
      const diskPct = Number(((bp.diskUsedGb / bp.diskTotalGb) * 100).toFixed(1));
      return {
        hostKey: bp.linuxHostKey!,
        name: bp.linuxHostKey!,
        displayName: bp.displayName,
        presentationStatus: "ready",
        role: "linux",
        availability: "reachable",
        evidence,
        metrics: {
          cpuUsagePercent: metric(bp.cpu, "percent", observedAt),
          osCpuCount: metric(bp.vcpu, "count", observedAt),
          memoryUsedBytes: metric(ramUsedBytes, "bytes", observedAt),
          memoryTotalBytes: metric(ramTotalBytes, "bytes", observedAt),
          memoryUsagePercent: metric(ramPct, "percent", observedAt),
          diskUsedBytes: metric(diskUsedBytes, "bytes", observedAt),
          diskTotalBytes: metric(diskTotalBytes, "bytes", observedAt),
          diskUsagePercent: metric(diskPct, "percent", observedAt),
          networkReceiveBitsPerSecond: metric(28_400_000, "bits/s", observedAt),
          networkTransmitBitsPerSecond: metric(24_100_000, "bits/s", observedAt),
          uptimeSeconds: metric(bp.uptimeDays * 86400, "seconds", observedAt),
        },
        storages: [],
        filesystems: [
          {
            key: "/",
            name: "/",
            metrics: {
              diskUsagePercent: metric(diskPct, "percent", observedAt),
              diskUsedBytes: metric(diskUsedBytes, "bytes", observedAt),
              diskTotalBytes: metric(diskTotalBytes, "bytes", observedAt),
            },
          },
        ],
        interfaces: [
          {
            key: "eth0",
            name: "eth0",
            metrics: {
              networkReceiveBitsPerSecond: metric(28_400_000, "bits/s", observedAt),
              networkTransmitBitsPerSecond: metric(24_100_000, "bits/s", observedAt),
            },
          },
        ],
        vms: [],
      };
    });

  return [asgard, ...linuxHosts];
}

export function buildDemoContainers(hostKey?: string): Container[] {
  const observedAt = nowIso(-10_000);
  const evidence = {
    source: "zabbix" as const,
    observedAt,
    basis: "item" as const,
    validUntil: nowIso(3_600_000),
  };
  const items: Container[] = [
    {
      reference: "cnt-retaguarda-api",
      hostKey: "linux-retaguarda-db",
      name: "retaguarda-erp-api",
      displayName: "Retaguarda ERP · API Principal",
      image: "ghcr.io/softcominnovation/retaguarda-api:4.18.2",
      status: "running",
      health: "healthy",
      healthReason: "observed",
      healthObservedAt: observedAt,
      healthValidUntil: nowIso(3_600_000),
      evidence,
      metrics: {
        cpuUsagePercent: metric(18.4, "percent", observedAt),
        memoryUsedBytes: metric(1.8 * 1024 ** 3, "bytes", observedAt),
        memoryUsagePercent: metric(22.5, "percent", observedAt),
        uptimeSeconds: metric(18 * 86400, "seconds", observedAt),
        restartCount: metric(0, "count", observedAt),
      },
    },
    {
      reference: "cnt-nfce-autorizador",
      hostKey: "linux-api-fiscal",
      name: "nfce-autorizador-worker",
      displayName: "Autorizador Fiscal NFC-e / NF-e",
      image: "ghcr.io/softcominnovation/fiscal-worker:2.9.0",
      status: "running",
      health: "healthy",
      healthReason: "observed",
      healthObservedAt: observedAt,
      healthValidUntil: nowIso(3_600_000),
      evidence,
      metrics: {
        cpuUsagePercent: metric(24.7, "percent", observedAt),
        memoryUsedBytes: metric(2.4 * 1024 ** 3, "bytes", observedAt),
        memoryUsagePercent: metric(30.0, "percent", observedAt),
        uptimeSeconds: metric(14 * 86400, "seconds", observedAt),
        restartCount: metric(0, "count", observedAt),
      },
    },
    {
      reference: "cnt-pdv-sync",
      hostKey: "linux-pdv-sync",
      name: "pdv-sync-broker",
      displayName: "PDV Sync · Broker de Caixas",
      image: "ghcr.io/softcominnovation/pdv-sync:3.4.1",
      status: "running",
      health: "healthy",
      healthReason: "observed",
      healthObservedAt: observedAt,
      healthValidUntil: nowIso(3_600_000),
      evidence,
      metrics: {
        cpuUsagePercent: metric(16.2, "percent", observedAt),
        memoryUsedBytes: metric(1.5 * 1024 ** 3, "bytes", observedAt),
        memoryUsagePercent: metric(18.8, "percent", observedAt),
        uptimeSeconds: metric(29 * 86400, "seconds", observedAt),
        restartCount: metric(0, "count", observedAt),
      },
    },
    {
      reference: "cnt-evolution-api",
      hostKey: "linux-whatsapp-evo",
      name: "evolution-api-v2",
      displayName: "Evolution API · Sessões WhatsApp",
      image: "atendai/evolution-api:v2.2.3",
      status: "running",
      health: "healthy",
      healthReason: "observed",
      healthObservedAt: observedAt,
      healthValidUntil: nowIso(3_600_000),
      evidence,
      metrics: {
        cpuUsagePercent: metric(42.8, "percent", observedAt),
        memoryUsedBytes: metric(3.6 * 1024 ** 3, "bytes", observedAt),
        memoryUsagePercent: metric(45.0, "percent", observedAt),
        uptimeSeconds: metric(9 * 86400, "seconds", observedAt),
        restartCount: metric(1, "count", observedAt),
      },
    },
    {
      reference: "cnt-signal-outbox",
      hostKey: "linux-signal-worker",
      name: "signal-outbox-worker",
      displayName: "Softcom Signal · Outbox Dispatcher",
      image: "ghcr.io/softcominnovation/signal-worker:1.12.0",
      status: "running",
      health: "healthy",
      healthReason: "observed",
      healthObservedAt: observedAt,
      healthValidUntil: nowIso(3_600_000),
      evidence,
      metrics: {
        cpuUsagePercent: metric(14.9, "percent", observedAt),
        memoryUsedBytes: metric(1.1 * 1024 ** 3, "bytes", observedAt),
        memoryUsagePercent: metric(13.8, "percent", observedAt),
        uptimeSeconds: metric(42 * 86400, "seconds", observedAt),
        restartCount: metric(0, "count", observedAt),
      },
    },
  ];
  return hostKey ? items.filter((item) => item.hostKey === hostKey) : items;
}

export function buildDemoResourceConfigs(): ResourceConfig[] {
  const createdAt = nowIso(-86_400_000 * 30);
  const updatedAt = nowIso(-3_600_000);
  const presentation = {
    showStatus: true,
    showCpu: true,
    showMemory: true,
    showDisk: true,
    showNetwork: true,
    showUptime: true,
    metricsSource: "auto" as const,
  };
  const containerPresentation = {
    showStatus: true,
    showCpu: true,
    showMemory: true,
    showDisk: true,
    showNetwork: true,
    showUptime: true,
    showHealth: true,
    showHealthTimeline: false,
    healthTimelineRange: "1h" as const,
  };
  return [
    {
      id: uid(901),
      resourceType: "host",
      source: "zabbix",
      zabbixHostKey: "ASGARD",
      selectorType: null,
      selectorValue: null,
      displayName: "ASGARD · Hypervisor Proxmox",
      description: "Cluster principal de virtualização da operação",
      serviceType: "Hypervisor",
      dashboardEnabled: true,
      critical: true,
      displayOrder: 1,
      presentation,
      enabled: true,
      createdAt,
      updatedAt,
    },
    {
      id: uid(902),
      resourceType: "host",
      source: "zabbix",
      zabbixHostKey: "linux-retaguarda-db",
      selectorType: null,
      selectorValue: null,
      displayName: "Retaguarda · PostgreSQL Primário",
      description: "Banco transacional principal do ERP",
      serviceType: "Banco de dados",
      dashboardEnabled: true,
      critical: true,
      displayOrder: 2,
      presentation,
      enabled: true,
      createdAt,
      updatedAt,
    },
    {
      id: uid(903),
      resourceType: "host",
      source: "zabbix",
      zabbixHostKey: "linux-api-fiscal",
      selectorType: null,
      selectorValue: null,
      displayName: "API Fiscal · NFC-e / NF-e",
      description: "Emissão, contingência e autorização Sefaz",
      serviceType: "API Fiscal",
      dashboardEnabled: true,
      critical: true,
      displayOrder: 3,
      presentation,
      enabled: true,
      createdAt,
      updatedAt,
    },
    {
      id: uid(904),
      resourceType: "docker_container",
      source: "zabbix",
      zabbixHostKey: "linux-whatsapp-evo",
      selectorType: "exact_name",
      selectorValue: "evolution-api-v2",
      displayName: "Hub WhatsApp · Evolution API",
      description: "Orquestração de sessões e webhooks WhatsApp",
      serviceType: "Mensageria",
      dashboardEnabled: true,
      critical: false,
      displayOrder: 4,
      presentation: containerPresentation,
      enabled: true,
      createdAt,
      updatedAt,
    },
  ];
}

export function buildDemoConfiguredResources(): ConfiguredResource[] {
  const hosts = buildDemoHosts();
  const containers = buildDemoContainers();
  return buildDemoResourceConfigs().map((config) => {
    if (config.resourceType === "host") {
      const target = hosts.find((h) => h.hostKey === config.zabbixHostKey) ?? null;
      return {
        id: config.id,
        config,
        resolved: Boolean(target),
        resolution: target ? "resolved" : "missing",
        resource: target,
        metrics: target?.metrics ?? {},
      };
    }
    const target =
      containers.find(
        (c) => c.hostKey === config.zabbixHostKey && c.name === config.selectorValue
      ) ?? null;
    return {
      id: config.id,
      config,
      resolved: Boolean(target),
      resolution: target ? "resolved" : "missing",
      resource: target,
      metrics: target?.metrics ?? {},
      linkedVmName: "Hub WhatsApp · Evolution Cluster",
    };
  });
}

export function buildDemoProblems(): Problem[] {
  return [
    {
      id: "prob-evo-cpu",
      resourceDisplayName: "Hub WhatsApp · Evolution Cluster",
      resource: { type: "vm", hostKey: "ASGARD", reference: "qemu/104" },
      description: "Consumo de CPU acima de 60% na fila de reconexão de sessões Evolution",
      displayDescription: "Consumo de CPU acima de 60% na fila de reconexão de sessões Evolution",
      severity: 2,
      visualState: "warning",
      startedAt: nowIso(-1_800_000),
    },
    {
      id: "prob-pbs-storage",
      resourceDisplayName: "ASGARD · pbs-backup",
      resource: { type: "host", hostKey: "ASGARD", reference: null },
      description: "Volume de retenção pbs-backup acima de 60% de ocupação após janela noturna",
      displayDescription: "Volume de retenção pbs-backup acima de 60% de ocupação após janela noturna",
      severity: 1,
      visualState: "info",
      startedAt: nowIso(-7_200_000),
    },
  ];
}

export function buildDemoExternalServices(): ExternalServicePublic[] {
  const createdAt = nowIso(-86_400_000 * 45);
  const updatedAt = nowIso(-60_000);
  const checkedAt = nowIso(-15_000);
  const items = [
    { id: uid(201), name: "Retaguarda ERP · Web & API", desc: "Acesso principal dos clientes e sincronização de pedidos", type: "ERP Core", url: "https://erp.softcomtecnologia.com.br/health", latency: 42, reason: 0, avail: 1439, total: 1440, critical: true, warn: [] as number[] },
    { id: uid(202), name: "API Fiscal · NFC-e / NF-e", desc: "Autorização de documentos fiscais eletrônicos e contingência", type: "Fiscal", url: "https://fiscal.softcomtecnologia.com.br/v1/health", latency: 68, reason: 0, avail: 1438, total: 1440, critical: true, warn: [14] },
    { id: uid(203), name: "PDV Sync & Caixas", desc: "Sincronização de caixas, tabelas de preço e fechamento", type: "PDV", url: "https://pdv-sync.softcomtecnologia.com.br/health", latency: 54, reason: 0, avail: 1440, total: 1440, critical: true, warn: [] as number[] },
    { id: uid(204), name: "Sefaz Autorizador · Monitor", desc: "Tempo de resposta percebido no lote de autorização Sefaz", type: "Sefaz", url: "https://sefaz-monitor.softcomtecnologia.com.br/status", latency: 410, reason: 1, avail: 1418, total: 1440, critical: false, warn: [32, 33, 38, 39] },
    { id: uid(205), name: "Portal do Contador", desc: "Download de lotes XML, SPED e relatórios contábeis", type: "Portal", url: "https://contador.softcomtecnologia.com.br/health", latency: 35, reason: 0, avail: 1440, total: 1440, critical: false, warn: [] as number[] },
    { id: uid(206), name: "Softcom Pay · PIX & TEF", desc: "Liquidação instantânea de QR Code PIX e conciliação TEF", type: "Pagamentos", url: "https://pay.softcomtecnologia.com.br/v1/health", latency: 49, reason: 0, avail: 1439, total: 1440, critical: true, warn: [] as number[] },
  ];

  return items.map((item, idx) => ({
    id: item.id,
    revision: 1,
    secretConfigured: false,
    createdAt,
    updatedAt,
    displayName: item.name,
    description: item.desc,
    serviceType: item.type,
    enabled: true,
    dashboardEnabled: true,
    critical: item.critical,
    displayOrder: idx + 1,
    method: "GET",
    url: item.url,
    successMode: "http_status",
    expectedStatuses: [200],
    jsonPointer: null,
    expectedValue: null,
    bodyTemplate: null,
    authMode: "none",
    headerName: null,
    timeoutMs: 5000,
    progressStartedAt: createdAt,
    uptime: {
      reason: item.reason,
      latencyMs: item.latency,
      checkedAt,
      uptime24h: { available: item.avail, total: item.total },
      strip: makeStrip(40, item.warn),
    },
  }));
}

export function buildDemoProbeCards(): ProbeCard[] {
  return buildDemoExternalServices().map((service) => ({
    id: service.id,
    displayName: service.displayName,
    description: service.description,
    serviceType: service.serviceType,
    displayOrder: service.displayOrder,
    critical: service.critical,
    dashboardEnabled: service.dashboardEnabled,
    paused: !service.enabled,
    progressStartedAt: service.progressStartedAt,
    reason: service.uptime?.reason ?? 0,
    latencyMs: service.uptime?.latencyMs ?? 45,
    checkedAt: service.uptime?.checkedAt ?? nowIso(-15_000),
    httpStatus: 200,
    certNotAfter: nowIso(86_400_000 * 68),
    uptime24h: service.uptime?.uptime24h ?? { available: 1439, total: 1440 },
    strip: service.uptime?.strip ?? makeStrip(40),
  }));
}

export function buildDemoExternalServiceHistory(id: string, range: "24h" | "7d" | "30d") {
  const service = buildDemoExternalServices().find((s) => s.id === id) ?? buildDemoExternalServices()[0];
  const baseLatency = service.uptime?.latencyMs ?? 50;
  const stepMs = range === "24h" ? 36 * 60_000 : range === "7d" ? 4 * 3600_000 : 18 * 3600_000;
  const points = Array.from({ length: 40 }, (_, index) => {
    const wave = Math.round(Math.sin(index * 0.45) * (baseLatency * 0.16));
    return {
      checkedAt: nowIso(-(40 - index) * stepMs),
      reason: service.uptime?.strip[index] ?? 0,
      latencyMs: Math.max(12, baseLatency + wave),
    };
  });
  return {
    serviceId: id,
    range,
    points,
    summary: {
      currentLatencyMs: baseLatency,
      averageLatencyMs: baseLatency,
      uptime24h: service.uptime?.uptime24h ?? { available: 1439, total: 1440 },
      uptime7d: { available: 10072, total: 10080 },
      uptime30d: { available: 43165, total: 43200 },
    },
  };
}

export function buildDemoStandaloneVpsList(): StandaloneVpsCard[] {
  const createdAt = nowIso(-86_400_000 * 60);
  const updatedAt = nowIso(-120_000);
  const checkedAt = nowIso(-18_000);
  const nodes = [
    { id: uid(301), name: "VPS Edge · São Paulo 01", provider: "Hetzner Cloud", ip: "177.54.144.21", domain: "edge-sp01.softcom.cloud", cpu: 28.4, mem: 54.2, disk: 41.0, latency: 18, warn: [] as number[] },
    { id: uid(302), name: "VPS Edge · Fortaleza 02", provider: "DigitalOcean", ip: "143.198.112.40", domain: "edge-for02.softcom.cloud", cpu: 34.8, mem: 61.5, disk: 48.2, latency: 11, warn: [] as number[] },
    { id: uid(303), name: "VPS Webhook · Meta Cloud 03", provider: "AWS Lightsail", ip: "54.233.88.19", domain: "webhook-meta.softcom.cloud", cpu: 19.2, mem: 42.0, disk: 33.4, latency: 26, warn: [] as number[] },
    { id: uid(304), name: "VPS Gateway · Evolution 04", provider: "Vultr", ip: "45.76.210.92", domain: "evo-gw04.softcom.cloud", cpu: 66.5, mem: 74.8, disk: 59.1, latency: 72, warn: [29, 30] },
  ];
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    provider: node.provider,
    ip: node.ip,
    domain: node.domain,
    managerUrl: `https://${node.domain}:9443`,
    baseUrl: `https://${node.domain}:8443`,
    monitorConfigured: true,
    enabled: true,
    monitorPaused: false,
    dashboardEnabled: true,
    timeoutMs: 5000,
    revision: 1,
    monitorState: "up",
    apiKey: "demo-vps-key-redacted",
    progressStartedAt: createdAt,
    reason: 0,
    latencyMs: node.latency,
    cpuPercent: node.cpu,
    memoryPercent: node.mem,
    diskPercent: node.disk,
    checkedAt,
    strip: makeStrip(40, node.warn),
    createdAt,
    updatedAt,
  }));
}

export function buildDemoStandaloneVpsHighlights(): StandaloneVpsHighlight[] {
  return buildDemoStandaloneVpsList().map((item) => ({
    id: item.id,
    name: item.name,
    provider: item.provider,
    ip: item.ip,
    enabled: item.enabled,
    monitorConfigured: item.monitorConfigured,
    monitorPaused: item.monitorPaused,
    monitorState: item.monitorState,
    cpuPercent: item.cpuPercent,
    memoryPercent: item.memoryPercent,
    diskPercent: item.diskPercent,
    checkedAt: item.checkedAt,
    strip: item.strip,
  }));
}

export function buildDemoStandaloneVpsDetail(
  id: string,
  range: "24h" | "7d" | "30d" = "24h"
): StandaloneVpsDetail {
  const list = buildDemoStandaloneVpsList();
  const card = list.find((item) => item.id === id) ?? list[0];
  const checkedAt = card.checkedAt ?? nowIso(-18_000);
  const stepMs = range === "24h" ? 36 * 60_000 : range === "7d" ? 4 * 3600_000 : 18 * 3600_000;
  return {
    ...card,
    range,
    stacks: [
      {
        id: uid(351),
        vpsId: card.id,
        name: "traefik-edge-proxy",
        link: `https://${card.domain}:9443`,
        notes: "Ingress TLS, roteamento HTTP/3 e proteção de borda",
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      },
      {
        id: uid(352),
        vpsId: card.id,
        name: "pulse-vps-agent",
        link: null,
        notes: "Agente de telemetria leve do Softcom Pulse (/ping/latency e /status)",
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      },
    ],
    result: {
      reason: 0,
      latencyMs: card.latencyMs,
      cpuPercent: card.cpuPercent,
      memoryPercent: card.memoryPercent,
      diskPercent: card.diskPercent,
      checkedAt,
      cpu: {
        cores: 4,
        speed: "3.20 GHz",
        coresLoad: [
          { core: "CPU 0", load: card.cpuPercent ?? 25 },
          { core: "CPU 1", load: Math.max(8, (card.cpuPercent ?? 25) - 4) },
          { core: "CPU 2", load: Math.min(95, (card.cpuPercent ?? 25) + 5) },
          { core: "CPU 3", load: Math.max(10, (card.cpuPercent ?? 25) - 2) },
        ],
      },
      memory: {
        total: "8,0 GB",
        used: "4,6 GB",
        free: "3,4 GB",
      },
      disks: [
        {
          device: "/dev/sda1",
          type: "ext4",
          mount: "/",
          size: "160 GB",
          used: "72 GB",
          available: "88 GB",
          use: card.diskPercent,
        },
      ],
    },
    samples: Array.from({ length: 40 }, (_, index) => ({
      checkedAt: nowIso(-(40 - index) * stepMs),
      reason: card.strip[index] ?? 0,
      latencyMs: Math.max(8, (card.latencyMs ?? 20) + Math.round(Math.sin(index * 0.4) * 4)),
      cpuPercent: Number(Math.max(5, (card.cpuPercent ?? 28) + Math.sin(index * 0.35) * 6).toFixed(1)),
      memoryPercent: Number(Math.max(20, (card.memoryPercent ?? 54) + Math.cos(index * 0.25) * 3).toFixed(1)),
      diskPercent: card.diskPercent,
    })),
  };
}

export function buildDemoSignalTargets() {
  const createdAt = nowIso(-86_400_000 * 30);
  const updatedAt = nowIso(-60_000);
  const checkedAt = nowIso(-12_000);
  return [
    {
      id: uid(401),
      displayName: "Softcom Signal · Produção",
      description: "Pipeline oficial de eventos, webhooks e mensageria assíncrona",
      baseUrl: "https://api-signal-squad-ia-01.hostsoftcom.cloud",
      enabled: true,
      dashboardEnabled: true,
      critical: true,
      displayOrder: 1,
      timeoutMs: 5000,
      revision: 1,
      state: 0,
      latencyMs: 38,
      httpStatus: 200,
      liveOk: true,
      readyStatus: "ok" as const,
      workerStatus: "ok",
      activeInstances: 6,
      outboxPending: 4,
      inboxPending: 2,
      outboxDead: 0,
      inboxDead: 0,
      oldestOutboxSeconds: 3,
      oldestInboxSeconds: 2,
      checks: { database: "ok", redis: "ok", broker: "ok", workers: "ok" },
      strip: makeStrip(40),
      uptime24h: { available: 1440, total: 1440 },
      uptime7d: { available: 10078, total: 10080 },
      uptime30d: { available: 43190, total: 43200 },
      checkedAt,
      links: [
        {
          id: uid(451),
          role: "manager",
          label: "API & Orquestrador Signal",
          hostKey: "ASGARD",
          vmKey: "qemu/105",
          parentHostKey: "ASGARD",
          inventoryStatus: "ready" as const,
          inventoryName: "Softcom Signal · Workers & Filas",
          inventoryAvailability: "running",
          cpuUsagePercent: 19.8,
          memoryUsagePercent: 67.5,
          createdAt,
          updatedAt,
        },
        {
          id: uid(452),
          role: "worker",
          label: "Redis & Filas de Eventos",
          hostKey: "ASGARD",
          vmKey: "qemu/106",
          parentHostKey: "ASGARD",
          inventoryStatus: "ready" as const,
          inventoryName: "Redis Cluster · Sessões & Filas",
          inventoryAvailability: "running",
          cpuUsagePercent: 14.2,
          memoryUsagePercent: 70.0,
          createdAt,
          updatedAt,
        },
      ],
      services: [],
      createdAt,
      updatedAt,
    },
    {
      id: uid(402),
      displayName: "Softcom Signal · Homologação",
      description: "Ambiente de validação de integrações e parceiros",
      baseUrl: "https://hml-signal.hostsoftcom.cloud",
      enabled: true,
      dashboardEnabled: true,
      critical: false,
      displayOrder: 2,
      timeoutMs: 5000,
      revision: 1,
      state: 0,
      latencyMs: 51,
      httpStatus: 200,
      liveOk: true,
      readyStatus: "ok" as const,
      workerStatus: "ok",
      activeInstances: 2,
      outboxPending: 0,
      inboxPending: 0,
      outboxDead: 0,
      inboxDead: 0,
      oldestOutboxSeconds: 0,
      oldestInboxSeconds: 0,
      checks: { database: "ok", redis: "ok", broker: "ok" },
      strip: makeStrip(40),
      uptime24h: { available: 1439, total: 1440 },
      uptime7d: { available: 10075, total: 10080 },
      uptime30d: { available: 43180, total: 43200 },
      checkedAt,
      links: [],
      services: [],
      createdAt,
      updatedAt,
    },
  ];
}

export function buildDemoSignalOverviewCards(): SignalOverviewCard[] {
  return buildDemoSignalTargets().map((item) => ({
    id: item.id,
    displayName: item.displayName,
    description: item.description,
    critical: item.critical,
    displayOrder: item.displayOrder,
    enabled: item.enabled,
    state: item.state,
    latencyMs: item.latencyMs,
    readyStatus: item.readyStatus,
    workerStatus: item.workerStatus,
    activeInstances: item.activeInstances,
    strip: item.strip,
    uptime24h: item.uptime24h,
    checkedAt: item.checkedAt,
  }));
}

export function buildDemoSignalHistory(id: string, range: "24h" | "7d" | "30d" = "24h") {
  const target = buildDemoSignalTargets().find((t) => t.id === id) ?? buildDemoSignalTargets()[0];
  const stepMs = range === "24h" ? 36 * 60_000 : range === "7d" ? 4 * 3600_000 : 18 * 3600_000;
  return {
    targetId: target.id,
    range,
    points: Array.from({ length: 40 }, (_, index) => ({
      checkedAt: nowIso(-(40 - index) * stepMs),
      state: 0,
      latencyMs: Math.max(18, (target.latencyMs ?? 38) + Math.round(Math.sin(index * 0.4) * 7)),
      readyStatus: "ok",
      workerStatus: "ok",
    })),
  };
}

export function buildDemoPresentation(): { data: PresentationDocument; updatedAt: string } {
  const screens: PresentationDocument["screens"] = [
    {
      id: uid(1),
      name: "Visão geral",
      enabled: true,
      layout: "overview",
      overviewGrid: "default",
      blocks: defaultDashboardBlocks.map((block, index) => ({
        id: uid(100 + index),
        ...block,
        enabled: true,
        options: effectiveOptions({ type: block.type }),
      })),
    },
    {
      id: uid(2),
      name: "Painel completo · Wall",
      enabled: true,
      layout: "wall",
      overviewGrid: "default",
      blocks: defaultDashboardBlocks.map((block, index) => ({
        id: uid(200 + index),
        ...block,
        enabled: true,
        options: effectiveOptions({ type: block.type }),
      })),
    },
  ];
  return {
    data: {
      schemaVersion: 2,
      revision: 1,
      defaultTvMode: false,
      displayScalePercent: 100,
      showStatusBanner: true,
      idlePresentation: { enabled: false, afterMinutes: 5, requestFullscreen: true },
      rotation: { intervalSeconds: 20, autoStart: false },
      screens,
    },
    updatedAt: nowIso(-300_000),
  };
}

export function buildDemoOverview(screenId?: string): ReadResult<Overview> {
  const { data: document } = buildDemoPresentation();
  const screen = document.screens.find((s) => s.enabled && (!screenId || s.id === screenId)) ?? document.screens[0];
  const hosts = buildDemoHosts();
  const asgard = hosts[0];
  const containers = buildDemoContainers();
  const resources = buildDemoConfiguredResources();
  const problems = buildDemoProblems();
  const probeCards = buildDemoProbeCards();
  const vpsHighlights = buildDemoStandaloneVpsHighlights();
  const signalCards = buildDemoSignalOverviewCards();
  const primarySignal = buildDemoSignalTargets()[0];
  const lastUpdated = nowIso(-10_000);

  const summary: Summary = {
    hostsKnown: hosts.length,
    hostsReachable: hosts.length,
    vms: asgard.vms.length,
    containersRunning: containers.length,
    containersStopped: 0,
    containersTotal: containers.length,
    problems: problems.length,
    criticalAffected: 0,
    jobsWaiting: (primarySignal.outboxPending ?? 0) + (primarySignal.inboxPending ?? 0),
    jobsWaitingOldestSeconds: Math.max(primarySignal.oldestOutboxSeconds ?? 0, primarySignal.oldestInboxSeconds ?? 0),
  };

  const asgardSummary = { host: asgard, vms: asgard.vms };
  const signalFlow: SignalFlowBlockData = {
    target: {
      id: primarySignal.id,
      displayName: primarySignal.displayName,
      description: primarySignal.description,
      state: primarySignal.state,
      latencyMs: primarySignal.latencyMs,
      readyStatus: primarySignal.readyStatus,
      workerStatus: primarySignal.workerStatus,
      activeInstances: primarySignal.activeInstances,
      strip: primarySignal.strip,
      checkedAt: primarySignal.checkedAt,
      outboxPending: primarySignal.outboxPending,
      inboxPending: primarySignal.inboxPending,
      outboxDead: primarySignal.outboxDead,
      inboxDead: primarySignal.inboxDead,
      oldestOutboxSeconds: primarySignal.oldestOutboxSeconds,
      oldestInboxSeconds: primarySignal.oldestInboxSeconds,
      checks: primarySignal.checks,
    },
  };

  const availabilityPanel: AvailabilityPanelData = {
    cards: [
      ...probeCards.map((item) => ({ kind: "external_service" as const, item })),
      ...signalCards.map((item) => ({ kind: "signal_target" as const, item })),
      ...vpsHighlights.map((item) => ({ kind: "standalone_vps" as const, item })),
      ...resources.map((item) => ({ kind: "resource" as const, item })),
    ],
  };

  const blocks = screen.blocks
    .filter((block) => block.enabled)
    .map((block) => {
      const data =
        block.type === "summary"
          ? summary
          : block.type === "highlighted_resources"
            ? availabilityPanel
            : block.type === "resource_card"
              ? resources[0] ?? null
              : block.type === "problems"
                ? problems
                : block.type === "host_inventory"
                  ? hosts
                  : block.type === "container_inventory"
                    ? containers
                    : block.type === "uptime_list"
                      ? probeCards
                      : block.type === "signal_flow"
                        ? signalFlow
                        : asgardSummary;
      return {
        blockId: block.id,
        type: block.type,
        options: block.options,
        availability: "ready" as const,
        stale: false,
        lastUpdated,
        data,
      };
    });

  return {
    presentationStatus: "ready",
    availability: "ready",
    stale: false,
    lastUpdated,
    refreshAfterMs: 20_000,
    data: {
      screenId: screen.id,
      presentationRevision: document.revision,
      summary,
      highlightedResources: resources,
      problems,
      asgardSummary,
      externalServices: probeCards,
      uptimeBoard: probeCards,
      standaloneVps: vpsHighlights,
      signalCards,
      blocks,
    },
  };
}

export function buildDemoHistory(
  resource: History["resource"],
  window: History["window"] = "1h"
): ReadResult<History> {
  const stepMs =
    window === "1h"
      ? 120_000
      : window === "24h"
        ? 2_400_000
        : 16_800_000;
  const count = 36;
  const mkPoints = (base: number, amp: number) =>
    Array.from({ length: count }, (_, idx) => {
      const value = Number((base + Math.sin(idx * 0.35) * amp + Math.cos(idx * 0.2) * (amp * 0.4)).toFixed(1));
      return {
        timestamp: nowIso(-(count - idx) * stepMs),
        value: Math.max(0, value),
        min: Math.max(0, Number((value - amp * 0.3).toFixed(1))),
        max: Number((value + amp * 0.3).toFixed(1)),
      };
    });

  return {
    presentationStatus: "ready",
    availability: "ready",
    stale: false,
    lastUpdated: nowIso(-10_000),
    refreshAfterMs: 20_000,
    data: {
      resource,
      window,
      source: window === "7d" ? "trends" : "history",
      series: [
        { key: "cpuUsagePercent", unit: "percent", aggregation: "last_min_max", points: mkPoints(29.4, 8.5) },
        { key: "memoryUsagePercent", unit: "percent", aggregation: "last_min_max", points: mkPoints(58.3, 4.2) },
        { key: "diskUsagePercent", unit: "percent", aggregation: "last_min_max", points: mkPoints(44.4, 1.1) },
        { key: "networkReceiveBitsPerSecond", unit: "bits/s", aggregation: "last_min_max", points: mkPoints(165_000_000, 35_000_000) },
        { key: "networkTransmitBitsPerSecond", unit: "bits/s", aggregation: "last_min_max", points: mkPoints(130_000_000, 28_000_000) },
      ],
    },
  };
}

export function buildDemoVmWorkloads(hostKey: string, vmKey: string): ReadResult<VmWorkloads> {
  const hosts = buildDemoHosts();
  const host = hosts.find((h) => h.hostKey === hostKey) ?? hosts[0];
  const normalizedVmKey = vmKey.includes("/") ? vmKey : `qemu/${vmKey}`;
  const vm =
    host.vms.find((v) => v.vmKey === vmKey || v.vmKey === normalizedVmKey || v.vmId === vmKey) ??
    host.vms[0];
  const containers = vm?.linuxHostKey ? buildDemoContainers(vm.linuxHostKey) : [];
  const configuredServices = buildDemoConfiguredResources().filter(
    (r) => r.config.zabbixHostKey === vm?.linuxHostKey
  );
  return {
    presentationStatus: "ready",
    availability: "ready",
    stale: false,
    lastUpdated: nowIso(-10_000),
    refreshAfterMs: 20_000,
    data: {
      vm,
      association: vm?.linuxHostKey ? "linked" : "unlinked",
      containers,
      configuredServices,
    },
  };
}

export function buildDemoTemplates(): ReadResult<Template[]> {
  const observedAt = nowIso(-10_000);
  const evidence = {
    source: "zabbix" as const,
    observedAt,
    basis: "item" as const,
    validUntil: nowIso(3_600_000),
  };
  const templates: Template[] = vmBlueprints
    .filter((bp) => bp.isTemplate)
    .map((bp) => ({
      templateKey: `qemu/${bp.vmId}`,
      hostKey: "ASGARD",
      templateId: bp.vmId,
      technicalName: bp.name,
      displayName: bp.displayName,
      virtualizationType: "qemu",
      role: bp.name.includes("worker") ? "worker" : "manager",
      roleSource: "name_convention",
      memoryBytes: metric(bp.ramTotalGb * 1024 ** 3, "bytes", observedAt),
      virtualCpuCount: metric(bp.vcpu, "count", observedAt),
      diskBytes: metric(bp.diskTotalGb * 1024 ** 3, "bytes", observedAt),
      operatingSystem: "Ubuntu 24.04 LTS",
      state: "stopped",
      evidence,
      configuration: null,
    }));
  return {
    presentationStatus: "ready",
    availability: "ready",
    stale: false,
    lastUpdated: observedAt,
    refreshAfterMs: 20_000,
    data: templates,
  };
}

export function buildDemoMonitoringScope() {
  const hosts = buildDemoHosts();
  const asgard = hosts[0];
  return {
    data: {
      asgardHostKey: "ASGARD",
      revision: 1,
      hostKeys: hosts.map((h) => h.hostKey),
      vmLinks: asgard.vms
        .filter((vm) => vm.linuxHostKey)
        .map((vm) => ({
          hostKey: vm.linuxHostKey!,
          parentHostKey: "ASGARD",
          vmId: vm.vmKey,
        })),
      hosts: hosts.map((h) => {
        const vm = asgard.vms.find((v) => v.linuxHostKey === h.hostKey);
        return {
          hostKey: h.hostKey,
          displayName: h.displayName ?? h.name,
          role: h.role === "hypervisor" ? ("hypervisor" as const) : ("agent" as const),
          linkedVm: vm
            ? {
                parentHostKey: "ASGARD",
                vmId: vm.vmKey,
                vmName: vm.displayName ?? vm.name,
              }
            : null,
        };
      }),
      candidates: [],
      unlinkedVms: asgard.vms
        .filter((vm) => !vm.linuxHostKey)
        .map((vm) => ({
          parentHostKey: "ASGARD",
          vmId: vm.vmKey,
          vmKey: vm.vmKey,
          vmName: vm.displayName ?? vm.name,
        })),
      discoveryStatus: "ready" as const,
      discoveryUpdatedAt: nowIso(-15_000),
    },
    availability: "ready" as const,
    stale: false,
    lastUpdated: nowIso(-10_000),
    refreshAfterMs: 20_000,
  };
}
