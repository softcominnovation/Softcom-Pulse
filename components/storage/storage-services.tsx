"use client";
import { useEffect, useRef, useState } from "react";
import { IconDatabase, IconSettings } from "@tabler/icons-react";
import { useCanEdit } from "@/store/auth.store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { StorageView } from "@/lib/storage/contracts";
import { useStorages } from "./data";
import { StoragePanel } from "./storage-panel";
import { StorageEditor } from "./storage-form";
const noStorages: StorageView[] = [];

export function StorageServices() {
  const poll = useStorages(), editor = useCanEdit();
  const [query, setQuery] = useState(""), [editing, setEditing] = useState<StorageView | null>(null);
  const items = poll.data?.data.items ?? noStorages;
  const located = useRef(false);
  const failed = poll.failed || poll.data?.data.status === "failed" || poll.data?.data.status === "no_data";
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("storage");
    if (!located.current && key && items.some(item => item.storageKey === key)) { document.getElementById(`storage-${key}`)?.scrollIntoView({ block: "center" }); located.current = true; }
  }, [items]);
  const action = (item: StorageView) => editor ? <Button size="sm" aria-label={`Configurar Storage ${item.displayName}`} onClick={() => setEditing(item)}><IconSettings aria-hidden="true" />{item.configId ? "Editar configuração" : "Configurar Storage"}</Button> : null;
  return <section id="storages" className="dashboard-panel storage-services-panel" aria-labelledby="storages-heading"><div className="panel-heading storage-services-heading"><IconDatabase aria-hidden="true" /><h2 id="storages-heading">Storages</h2>{items.length > 1 && <input aria-label="Buscar Storage" className="rounded-md border border-input bg-background px-3 py-2" placeholder="Buscar Storage…" value={query} onChange={event => setQuery(event.target.value)} />}</div>
    <div className="storage-services-content">
    {failed && <div className="admin-notice" role="alert"><p>A descoberta de Storages está indisponível ou ainda não foi publicada. Últimas leituras, quando existentes, permanecem identificadas.</p><Button onClick={poll.refresh}>Tentar novamente</Button></div>}
    {!poll.data && !poll.failed && <p className="panel-empty">Carregando Storages…</p>}
    {poll.data && !failed && !items.length && <p className="panel-empty">Nenhum Storage identificado pela tag role=storage</p>}
    <div className="storage-services-grid">{items.filter(item => `${item.technicalName} ${item.displayName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item => <div id={`storage-${item.storageKey}`} key={item.storageKey}><StoragePanel item={item} stale={poll.failed || poll.data?.stale} actions={action(item)} /></div>)}</div>
    {editor && !!poll.data?.data.orphans.length && <details className="mt-4"><summary>Configurações sem Storage na descoberta atual ({poll.data.data.orphans.length})</summary><div className="storage-services-grid">{poll.data.data.orphans.map(item => <StoragePanel key={item.storageKey} item={item} actions={action(item)} />)}</div></details>}
    </div>
    <Dialog open={!!editing} onOpenChange={value => { if (!value) setEditing(null); }}><DialogContent size="lg"><DialogHeader><DialogTitle>Configuração de Storage</DialogTitle><DialogDescription>Nome, apresentação, capacidade monitorada e rede.</DialogDescription></DialogHeader><DialogBody>{editing && <StorageEditor key={editing.storageKey} item={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); poll.refresh(); }} />}</DialogBody></DialogContent></Dialog>
  </section>;
}
