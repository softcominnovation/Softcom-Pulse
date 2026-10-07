import type { TemplateConfig } from "../config/templates.ts";
import { templateConfigSchema } from "../config/templates.ts";
import { metricSchema, vmSchema } from "./contracts.ts";
import { z } from "zod";
import type { Metric, VirtualMachine } from "./contracts.ts";

export type Template = {
  templateKey: string; hostKey: string; templateId: string | null; technicalName: string; displayName: string;
  virtualizationType: "qemu" | "lxc" | null; role: "worker" | "manager"; roleSource: "configuration" | "name_convention";
  memoryBytes: Metric | null; virtualCpuCount: Metric | null; diskBytes: Metric | null; operatingSystem: string | null;
  state: VirtualMachine["state"]; evidence: VirtualMachine["evidence"]; configuration: TemplateConfig | null;
};

export const templateSchema = z.object({
  templateKey: z.string(), hostKey: z.string(), templateId: z.string().nullable(), technicalName: z.string(), displayName: z.string(),
  virtualizationType: z.enum(["qemu", "lxc"]).nullable(), role: z.enum(["worker", "manager"]), roleSource: z.enum(["configuration", "name_convention"]),
  memoryBytes: metricSchema.nullable(), virtualCpuCount: metricSchema.nullable(), diskBytes: metricSchema.nullable(), operatingSystem: z.string().nullable(),
  state: vmSchema.shape.state, evidence: vmSchema.shape.evidence, configuration: templateConfigSchema.nullable(),
});
