"use client";

import { cloneElement, useId, useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { isAxiosError } from "axios";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";

export function errorText(error: unknown) {
  const code = isAxiosError(error) ? error.response?.data?.error?.code : "";
  const messages: Record<string, string> = {
    vm_inventory_unavailable: "Aguarde uma descoberta atual para cadastrar o nome desta VM.",
    vm_identity_unverified: "Não foi possível comprovar a identidade da VM.",
    vm_not_found: "A VM não está na descoberta operacional atual.",
    resource_context_changed: "O vínculo da VM ou o container mudou. Volte à VM e selecione o recurso novamente.",
    revision_conflict: "Esta configuração foi alterada em outra sessão. Seu rascunho foi mantido. Recarregue a versão salva e revise antes de tentar novamente.",
    resource_conflict: "Já existe uma configuração para este recurso e seletor.",
    selector_ambiguous: "O seletor encontrou mais de um container. Ajuste-o para identificar um único recurso.",
    resource_not_discovered: "Este recurso não está no inventário atual. Atualize a descoberta e selecione-o novamente.",
    resource_inventory_unavailable: "Não há descoberta atual para confirmar este recurso. Atualize o inventário antes de cadastrar ou trocar o seletor.",
    template_inventory_unavailable: "A descoberta de templates está indisponível ou desatualizada. Aguarde uma leitura atual para criar esta preferência.",
    template_identity_unverified: "A identidade deste template não pôde ser confirmada. Atualize a descoberta.",
    template_not_found: "O template não está mais na descoberta. As preferências existentes continuam preservadas.",
    invalid_resource_reference: "Um recurso individual está desativado, fora do dashboard ou foi removido. Revise os blocos vinculados.",
    invalid_host_reference: "Um host selecionado não pertence ao escopo de monitoramento. Revise o filtro de containers.",
    invalid_request: "Confira os campos preenchidos e os limites indicados no formulário.",
    external_service_limit: "O limite de 100 aplicações cadastradas foi atingido.",
    external_service_not_found: "Esta aplicação não está mais cadastrada. Recarregue a lista.",
  };
  return messages[code] ?? "Não foi possível concluir. Seu rascunho foi mantido; tente novamente.";
}
export function useAdminRead<T>(path: string, parse: (data: unknown) => T) {
  const [state, setState] = useState<{ data: T | null; failed: boolean; loading: boolean }>({ data: null, failed: false, loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api.get(path, { signal: controller.signal }).then(response => {
      const data = parse(response.data);
      if (!controller.signal.aborted) setState({ data, failed: false, loading: false });
    }).catch(() => { if (!controller.signal.aborted) setState(previous => ({ ...previous, failed: true, loading: false })); });
    return () => controller.abort();
  }, [path, parse, revision]);
  return { ...state, refresh: useCallback(() => { setState(previous => ({ ...previous, loading: true })); setRevision(value => value + 1); }, []) };
}
export function useMutation() {
  const pending = useRef<AbortController | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => () => { pending.current?.abort(); }, []);
  async function run<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true);
    try { const result = await action(controller.signal); return controller.signal.aborted ? undefined : result; }
    finally { pending.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  return { run, busy };
}
export function Field({ label, children, hint, error, action }: { label: string; children: ReactNode; hint?: string; error?: string; action?: ReactNode }) {
  const id = useId();
  const control = cloneElement(children as ReactElement<{ id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>, { id, "aria-describedby": hint || error ? `${id}-hint` : undefined, "aria-invalid": !!error });
  return <div className="admin-field"><label htmlFor={id}>{label}</label>{action ? <div className="admin-field-control">{control}{action}</div> : control}{(hint || error) && <small id={`${id}-hint`} className={error ? "admin-error" : undefined}>{error ?? hint}</small>}</div>;
}
export function Check({ label, children }: { label: string; children: ReactNode }) { return <label className="admin-check">{children}<span>{label}</span></label>; }
export function ReadError({ refresh, children }: { refresh: () => void; children: ReactNode }) {
  return <div className="admin-notice" role="alert"><p>{children}</p><Button type="button" onClick={refresh}>Tentar novamente</Button></div>;
}
