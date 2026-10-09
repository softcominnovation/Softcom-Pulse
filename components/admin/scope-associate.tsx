"use client";

import { useMemo } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import type { VirtualMachine } from "@/lib/monitoring/contracts";
import { Button } from "@/components/ui/button";
import { PlaceLink } from "@/components/layout/place-link";
import { useCanEdit } from "@/store/auth.store";
import { errorText, useAdminRead, useMutation } from "./shared";

const documentSchema = z.object({
  data: z.object({
    revision: z.number().int(),
    candidates: z.array(z.object({
      hostKey: z.string(),
      displayName: z.string(),
      suggestedVm: z.object({
        parentHostKey: z.string(),
        vmId: z.string(),
        vmKey: z.string(),
        vmName: z.string(),
        match: z.enum(["exact_name", "tags"]),
      }).nullable(),
    })),
  }),
});

export function VmAgentAssociateNotice({ vm }: { vm: VirtualMachine }) {
  const canEdit = useCanEdit();
  const document = useAdminRead("/settings/monitoring-scope", data => documentSchema.parse(data));
  const mutation = useMutation();
  const candidate = useMemo(() => {
    const list = document.data?.data.candidates ?? [];
    return list.find(item => item.suggestedVm?.vmKey === vm.vmKey)
      ?? list.find(item => item.suggestedVm?.parentHostKey === vm.parentHostKey && item.suggestedVm.vmName === vm.name)
      ?? list.find(item => item.hostKey === vm.name);
  }, [document.data, vm]);

  if (!candidate?.suggestedVm) return null;

  const associate = async () => {
    const revision = document.data?.data.revision;
    if (revision == null) return;
    try {
      await mutation.run(async signal => {
        await api.post("/settings/monitoring-scope/links", {
          hostKey: candidate.hostKey,
          parentHostKey: candidate.suggestedVm!.parentHostKey,
          vmId: candidate.suggestedVm!.vmId,
          expectedRevision: revision,
        }, { signal });
      });
      toast.success("Escopo atualizado. A coleta inclui este Agent no próximo ciclo.");
      document.refresh();
    } catch (error) { toast.error(errorText(error)); }
  };

  return <p className="admin-notice" role="status">
    Agent disponível para associação: <strong>{candidate.displayName}</strong>
    {canEdit
      ? <> · <Button type="button" variant="primary" disabled={mutation.busy} onClick={() => { void associate(); }}>Associar</Button></>
      : <> · Peça a um editor para associar em <PlaceLink href="/admin/recursos">Admin → Recursos</PlaceLink>.</>}
  </p>;
}
