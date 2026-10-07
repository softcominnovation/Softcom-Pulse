"use client";

import { displayName } from "@/lib/monitoring/display-names";

import { useSearchParams } from "next/navigation";
import { historyRangeSchema } from "@/lib/config/resources";
import type { VirtualMachine } from "@/lib/monitoring/contracts";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReadNotice } from "@/components/infrastructure/data";
import { useVmWorkloads } from "./data";
import { ContainerInventory } from "./container-inventory";

export function VmWorkloadsDialog({ vm, onClose, restoreFocus }: { vm: VirtualMachine | null; onClose: () => void; restoreFocus: () => void }) {
  return <Dialog open={!!vm} onOpenChange={open => { if (!open) onClose(); }}>{vm && <DialogContent className="workloads-dialog" onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}><DialogHeader><DialogTitle>Serviços e containers de {displayName(vm)}</DialogTitle><DialogDescription>VM {vm.vmId ?? vm.vmKey} · Hipervisor {vm.parentHostKey} · Zabbix</DialogDescription></DialogHeader><DialogBody><WorkloadsContent key={`${vm.parentHostKey}:${vm.vmKey}`} vm={vm} /></DialogBody></DialogContent>}</Dialog>;
}
function WorkloadsContent({ vm }: { vm: VirtualMachine }) {
  const query = useSearchParams(), range = historyRangeSchema.catch("24h").parse(query.get("range") ?? "24h");
  const poll = useVmWorkloads(vm.parentHostKey, vm.vmKey), result = poll.data;
  return <div className="vm-workloads"><ReadNotice result={result} failed={poll.failed} refresh={poll.refresh} label="serviços e containers da VM" />
    {!result && !poll.failed && <p role="status">Carregando serviços e containers…</p>}
    {result && (result.data.association === "unlinked" ? <p className="service-note">Sem host monitorado associado; não é possível consultar containers desta VM.</p> : result.data.association === "host_unavailable" ? <p className="service-note">O host associado está indisponível nesta coleta. Atualize para tentar novamente.</p> : <><p className="service-note">Host associado: {result.data.vm.linuxHostKey}</p><ContainerInventory vmContext={{ parentHostKey: vm.parentHostKey, vmKey: vm.vmKey, range }} containers={result.data.containers} configuredServices={result.data.configuredServices} stale={poll.failed || result.stale} availability={result.availability} /></>)}
  </div>;
}
