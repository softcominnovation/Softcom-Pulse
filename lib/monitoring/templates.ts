import type { TemplateConfig } from "../config/templates.ts";
import type { Metric, VirtualMachine } from "./contracts.ts";

export type Template = {
  templateKey: string; hostKey: string; templateId: string | null; technicalName: string; displayName: string;
  virtualizationType: "qemu" | "lxc" | null; role: "worker" | "manager"; roleSource: "configuration" | "name_convention";
  memoryBytes: Metric | null; virtualCpuCount: Metric | null; diskBytes: Metric | null; operatingSystem: string | null;
  state: VirtualMachine["state"]; evidence: VirtualMachine["evidence"]; configuration: TemplateConfig | null;
};
