"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Copy, HelpCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { chromeFullscreenPolicyCommand } from "@/lib/client/chrome-fullscreen-policy";

const chromePolicyUrl = "chrome://policy";
const command = chromeFullscreenPolicyCommand();
type Authorization = "checking" | "granted" | "denied" | "unknown" | "unsupported";
const statusText: Record<Authorization, string> = {
  checking: "Verificando autorização neste navegador…",
  granted: "Tela cheia automática autorizada neste navegador.",
  denied: "Tela cheia automática ainda não autorizada neste navegador.",
  unknown: "Este navegador não permite consultar a autorização automática.",
  unsupported: "Tela cheia indisponível neste navegador ou nesta janela.",
};

function CopyValue({ label, value, rows = 2 }: { label: string; value: string; rows?: number }) {
  const id = useId(), field = useRef<HTMLTextAreaElement>(null), [feedback, setFeedback] = useState("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setFeedback("Copiado."); }
    catch { field.current?.focus(); field.current?.select(); setFeedback("Cópia automática indisponível. O texto foi selecionado; use a opção Copiar do dispositivo."); }
  };
  return <div className="fullscreen-help-copy">
    <label htmlFor={id}>{label}</label>
    <div><textarea id={id} ref={field} value={value} rows={rows} readOnly spellCheck={false} /><Button type="button" aria-label={`Copiar ${label.toLocaleLowerCase("pt-BR")}`} onClick={() => { void copy(); }}><Copy aria-hidden="true" />Copiar</Button></div>
    <small role="status">{feedback}</small>
  </div>;
}

function PermissionStatus() {
  const [authorization, setAuthorization] = useState<Authorization>("checking"), [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false, generation = 0, permission: globalThis.PermissionStatus | undefined;
    const changed = () => { if (!disposed && permission) setAuthorization(permission.state === "granted" ? "granted" : "denied"); };
    const check = async () => {
      const current = ++generation;
      permission?.removeEventListener("change", changed); permission = undefined;
      if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) { setAuthorization("unsupported"); return; }
      try {
        const result = await navigator.permissions.query({ name: "fullscreen" as PermissionName, allowWithoutGesture: true } as PermissionDescriptor);
        if (disposed || current !== generation) return;
        permission = result; permission.addEventListener("change", changed); changed();
      } catch { if (!disposed && current === generation) setAuthorization("unknown"); }
    };
    const visible = () => { if (!document.hidden) void check(); };
    void check();
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; permission?.removeEventListener("change", changed); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [revision]);
  return <div className="fullscreen-help-status">
    <p role="status">{statusText[authorization]}</p>
    <Button type="button" onClick={() => { setAuthorization("checking"); setRevision(value => value + 1); }}><RefreshCw aria-hidden="true" />Verificar autorização</Button>
  </div>;
}

export function FullscreenHelp() {
  const [open, setOpen] = useState(false), [origin, setOrigin] = useState("");
  return <Dialog open={open} onOpenChange={value => { if (value) setOrigin(window.location.origin); setOpen(value); }}>
    <div className="admin-actions"><DialogTrigger asChild><Button type="button"><HelpCircle aria-hidden="true" />Como autorizar tela cheia automática</Button></DialogTrigger></div>
    <DialogContent className="fullscreen-help">
      <DialogHeader><DialogTitle>Tela cheia automática no Chrome</DialogTitle><DialogDescription>Configure os três endereços do Pulse neste computador. A verificação abaixo corresponde ao ambiente aberto.</DialogDescription></DialogHeader>
      <DialogBody className="fullscreen-help-body">
        <PermissionStatus />
        <p>A página “Tela cheia automática” do Chrome apenas lista os sites: ela não oferece um botão para autorizar o Pulse. A liberação precisa ser configurada no computador do telão.</p>
        <CopyValue label="Endereço do Pulse neste ambiente" value={origin} />
        <section className="fullscreen-help-policy" aria-label="Configuração no Windows">
          <h3>Configurar uma vez no Windows</h3>
          <p>No computador do telão, abra o PowerShell como administrador, usando o mesmo usuário do Windows que utiliza o Chrome. Copie e execute o comando abaixo. Ele cadastra localhost, desenvolvimento e produção de uma vez, preservando os outros sites e sem duplicar entradas. O Chrome poderá indicar que é gerenciado por uma organização.</p>
          <CopyValue label="Comando de configuração do Chrome no Windows" value={command} rows={7} />
          <p>O Pulse não executa esse comando: copiar não aplica a autorização.</p>
        </section>
        <p>Depois de executar, cole o endereço abaixo em uma nova aba do Chrome e clique em “Recarregar políticas”. Confira se <strong>AutomaticFullscreenAllowedForUrls</strong> contém os três endereços do comando, sem erro. Volte ao Pulse e clique em “Verificar autorização”.</p>
        <CopyValue label="Página para verificar as políticas do Chrome" value={chromePolicyUrl} />
        <details className="fullscreen-help-policy"><summary>Se a política não for aceita ou o computador não usar Windows</summary>
          <p>Se a elevação exigir outra conta de usuário, solicite ao responsável a configuração de <strong>AutomaticFullscreenAllowedForUrls</strong> para o usuário do telão e os três endereços do comando. Bloqueios e políticas de máquina ou da organização podem prevalecer; o comando não os remove. Se o Chrome não carregar a política, será necessário aplicá-la pelo gerenciamento da organização.</p>
          <a href="https://chromeenterprise.google/policies/#AutomaticFullscreenAllowedForUrls" target="_blank" rel="noopener noreferrer">Documentação oficial do Chrome (abre em nova aba)</a>
        </details>
        <p>O comando inclui somente http://localhost:3000, https://dev-pulse.softcomtecnologia.com e https://pulse.softcomtecnologia.com. Outros endereços ou portas não são adicionados automaticamente.</p>
        <p>Depois da liberação, volte aqui e verifique a autorização. Salve a entrada por inatividade e a opção de tela cheia, volte ao dashboard e aguarde o tempo configurado. Salvar no Pulse não concede a permissão do Chrome.</p>
      </DialogBody>
      <DialogFooter><Button type="button" onClick={() => setOpen(false)}>Concluir</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
