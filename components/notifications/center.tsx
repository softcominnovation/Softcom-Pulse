"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconBell } from "@tabler/icons-react";
import { api } from "@/lib/client/api";
import { useCanEdit } from "@/store/auth.store";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useNotificationCenter } from "./provider";
import { notificationMessages, type NotificationSnapshot, type NotificationIncidentView } from "@/lib/notifications/contracts";

const date = (value: string) => new Date(value).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" });
const statuses = { active: "Em andamento", resolved: "Resolvido", cancelled: "Acompanhamento encerrado" };
const severities = { critical: "Crítica", warning: "Atenção", info: "Informação" };

export function NotificationBell({ publicRead }: { publicRead: boolean }) {
  const center = useNotificationCenter(), editor = useCanEdit();
  const bell = useRef<HTMLButtonElement>(null);
  const open = center.open;
  const setOpen = center.setOpen;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !event.shiftKey || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setOpen(!open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);
  const shortcut = "Ctrl+Shift+K";
  return <>
    <Button ref={bell} size="icon-sm" variant="ghost" title={center.available ? `Central de notificações (${shortcut})` : `Central aguardando sincronização (${shortcut})`} aria-keyshortcuts="Control+Shift+K" aria-label={`Notificações: ${center.counts.unreadCount} não lidas, ${center.counts.activeCount} incidentes atuais${center.available ? "" : ", sincronização indisponível"}`} onClick={() => center.setOpen(true)} className="relative">
      <IconBell className="size-4" aria-hidden />
      {center.counts.unreadCount > 0 && <span className="absolute -end-1 -top-1 rounded-full bg-destructive px-1 text-[10px] text-destructive-foreground">{center.counts.unreadCount > 99 ? "99+" : center.counts.unreadCount}</span>}
    </Button>
    <Sheet open={center.open} onOpenChange={center.setOpen}><SheetContent finalFocus={bell} data-state={center.open ? "open" : "closed"}>
      <SheetHeader><SheetTitle>Notificações</SheetTitle><SheetDescription>{center.counts.unreadCount} não lidas · {center.counts.activeCount} incidentes atuais</SheetDescription></SheetHeader>
      {!center.available && <p role="status" className="px-4 pb-3 text-xs text-muted-foreground">Sincronização indisponível. As últimas informações podem estar desatualizadas.</p>}
      {center.open && <NotificationList key={center.scopeKey} editor={editor && !publicRead} publicRead={publicRead} revision={center.revision} refresh={center.refresh} />}
    </SheetContent></Sheet>
  </>;
}

function NotificationList({ editor, publicRead, revision, refresh }: { editor: boolean; publicRead: boolean; revision: string; refresh: () => void }) {
  const [tab, setTab] = useState<"all" | "unread" | "incidents">("unread");
  const [data, setData] = useState<NotificationSnapshot | null>(null), [error, setError] = useState("");
  const [detail, setDetail] = useState<string | null>(null), [severity, setSeverity] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false), [refreshKey, setRefreshKey] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const abort = new AbortController(), run = ++generation.current;
    const path = tab === "incidents" ? "/monitoring/notifications/incidents" : "/monitoring/notifications";
    void api.get<NotificationSnapshot>(path, { signal: abort.signal, params: { ...(tab === "incidents" ? {} : { read: tab }), severity: severity || undefined, targetRef: target || undefined } }).then(response => {
      if (run === generation.current) { setData(response.data); setError(""); }
    }).catch(() => { if (!abort.signal.aborted) setError("Não foi possível atualizar a central. Tente novamente."); });
    return () => abort.abort();
  }, [tab, revision, refreshKey, severity, target]);
  async function more() {
    if (!data?.nextPageCursor || busy) return;
    const run = generation.current; setBusy(true);
    try {
      const response = await api.get<NotificationSnapshot>(tab === "incidents" ? "/monitoring/notifications/incidents" : "/monitoring/notifications", { params: { cursor: data.nextPageCursor, ...(tab === "incidents" ? {} : { read: tab }), severity: severity || undefined, targetRef: target || undefined } });
      if (run === generation.current) setData(current => current && BigInt(current.streamRevision) <= BigInt(response.data.streamRevision) ? { ...response.data, events: [...new Map([...current.events, ...response.data.events].map(event => [event.id, event])).values()], incidents: [...new Map([...current.incidents, ...response.data.incidents].map(incident => [incident.id, incident])).values()] } : current);
    } catch { setError("Não foi possível carregar mais registros."); } finally { setBusy(false); }
  }
  async function mark(body: { ids: string[] } | { allThrough: string }) {
    if (busy) return; setBusy(true);
    try {
      await api.post("/monitoring/notifications/read", body);
      // The write receipt is not a feed cursor. The provider keeps consuming its own stream.
      refresh(); setRefreshKey(key => key + 1); setError("");
    } catch { setError("Não foi possível registrar a leitura compartilhada."); } finally { setBusy(false); }
  }
  function show(id: string) { setDetail(id); }
  return <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
    <div className="flex flex-wrap gap-2" aria-label="Filtrar notificações">{([['unread', 'Não lidas'], ['incidents', 'Incidentes atuais'], ['all', 'Histórico']] as const).map(([value, label]) => <Button key={value} size="sm" variant={tab === value ? "secondary" : "ghost"} aria-pressed={tab === value} onClick={() => { setDetail(null); setData(null); setTab(value); }}>{label}</Button>)}</div>
    <label className="flex items-center gap-2 text-xs">Severidade<select className="min-w-0 rounded-md border bg-background p-2" value={severity} onChange={event => { setSeverity(event.target.value); setData(null); }}><option value="">Todas</option><option value="critical">Crítica</option><option value="warning">Atenção</option><option value="info">Informação</option></select></label>
    {target && <Button size="sm" variant="ghost" onClick={() => { setTarget(""); setData(null); }}>Limpar filtro de serviço</Button>}
    {publicRead && <p className="text-xs text-muted-foreground">Leitura compartilhada. <Link href="/admin/configuracoes" className="underline">Entrar na área privada</Link> para gerenciar.</p>}
    {editor && data && <Button size="sm" variant="outline" disabled={busy || !data.counts.unreadCount} onClick={() => void mark({ allThrough: data.syncCursor })}>Marcar notificações existentes como lidas</Button>}
    {error && <p role="status" className="text-sm text-muted-foreground">{error} <Button size="sm" onClick={() => setRefreshKey(key => key + 1)}>Recarregar</Button></p>}
    <div className="min-h-0 flex-1 overflow-y-auto space-y-2" aria-live="off">
      {detail ? <><Button size="sm" onClick={() => setDetail(null)}>Voltar à lista</Button><IncidentDetail key={detail} id={detail} revision={revision} /></> : <>
        {!data && !error && <p className="text-muted-foreground">Carregando notificações…</p>}
        {data && !data.events.length && !data.incidents.length && <p className="text-muted-foreground">Nenhum registro neste filtro.</p>}
        {data?.events.map(event => <article key={event.id} className="rounded-xl border p-3 space-y-2">
          <div className="flex items-center justify-between gap-2"><h3 className="min-w-0 break-words font-semibold">{event.displayName}</h3>{!event.readAt && <span className="shrink-0 text-xs text-primary">Não lida</span>}</div>
          <p>{notificationMessages[event.messageCode]}</p><p className="text-xs text-muted-foreground">{date(event.createdAt)} · {severities[event.severity]} · {statuses[event.incidentStatus]}</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => show(event.incidentId)}>Ver incidente</Button><Button size="sm" variant="ghost" onClick={() => { setTarget(event.targetRef); setData(null); }}>Filtrar serviço</Button>{editor && !event.readAt && <Button size="sm" disabled={busy} onClick={() => void mark({ ids: [event.id] })}>Marcar como lida</Button>}</div>
        </article>)}
        {data?.incidents.map(incident => <article key={incident.id} className="rounded-xl border p-3 space-y-2"><h3 className="break-words font-semibold">{incident.displayName}</h3><p>{notificationMessages[incident.messageCode]}</p><p className="text-xs text-muted-foreground">{severities[incident.severity]} · Desde {date(incident.openedAt)}</p><Button size="sm" variant="ghost" onClick={() => void show(incident.id)}>Ver incidente</Button></article>)}
        {data?.nextPageCursor && <Button disabled={busy} onClick={() => void more()}>Carregar mais</Button>}
      </>}
    </div>
    {data?.sources?.some(source => source.status !== "receiving") && <p className="text-xs text-muted-foreground">Algumas fontes aguardam observações recentes: {data.sources.filter(source => source.status !== "receiving").map(source => source.source === "zabbix" ? "Zabbix" : source.source === "probe" ? "Aplicações" : source.source === "vps" ? "VPS" : "Signal").join(", ")}. Isso não indica queda dos serviços.</p>}
    <p className="text-xs text-muted-foreground">Marcar como lida vale para todas as telas. O incidente só é resolvido quando o monitor confirma a recuperação.</p>
  </div>;
}

type Detail = NotificationSnapshot & { incident: NotificationIncidentView; targetHref: string | null };
function IncidentDetail({ id, revision }: { id: string; revision: string }) {
  const [detail, setDetail] = useState<Detail | null>(null), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0), generation = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const abort = new AbortController(), run = ++generation.current;
    void api.get<Detail>(`/monitoring/notifications/incidents/${id}`, { signal: abort.signal }).then(response => {
      if (generation.current === run) { setDetail(response.data); setError(false); }
    }).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => { abort.abort(); generation.current = run + 1; };
  }, [id, revision, retry]);
  const loaded = !!detail;
  useEffect(() => { if (loaded) heading.current?.focus(); }, [id, loaded]);
  async function more() {
    if (!detail?.nextPageCursor || busy) return;
    const run = generation.current; setBusy(true);
    try {
      const { data } = await api.get<Detail>(`/monitoring/notifications/incidents/${id}`, { params: { cursor: detail.nextPageCursor } });
      if (generation.current === run) setDetail(current => current ? { ...data, events: [...new Map([...current.events, ...data.events].map(event => [event.id, event])).values()] } : data);
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <article className="rounded-xl border p-3 space-y-2">
    {error && <p role="status">Não foi possível atualizar o incidente. <Button size="sm" onClick={() => setRetry(value => value + 1)}>Recarregar</Button></p>}
    {!detail && !error && <p>Carregando incidente…</p>}
    {detail && <><h3 ref={heading} tabIndex={-1} className="font-semibold">{detail.incident.displayName}</h3><p>{notificationMessages[detail.incident.messageCode]}</p><p>{statuses[detail.incident.status]}</p><p className="text-xs text-muted-foreground">Observado: {date(detail.incident.openedAt)} · Confirmado: {date(detail.incident.confirmedAt)}</p>{!detail.events.length && <p>Condição preexistente, acompanhada sem aviso retroativo.</p>}{detail.events.map(event => <p key={event.id} className="text-xs">{date(event.createdAt)} · {notificationMessages[event.messageCode]} · {event.readAt ? "Lida" : "Não lida"}</p>)}{detail.nextPageCursor && <Button size="sm" disabled={busy} onClick={() => void more()}>Mais eventos do incidente</Button>}{detail.targetHref && <Link className="inline-block underline" href={detail.targetHref}>Ver serviço</Link>}</>}
  </article>;
}
