"use client";

import { useState } from "react";
import { Field, Check, ReadError, errorText, useAdminRead, useMutation } from "@/components/admin/shared";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { webhookKeySchema, webhookSettingsSchema, webhookWriteSchema, type WebhookSettings } from "@/lib/notifications/webhook";

const path = "/settings/notifications/webhook";

function WebhookForm({ saved, refresh }: { saved: WebhookSettings; refresh: () => void }) {
  const [url, setUrl] = useState(saved.url ?? "");
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [active, setActive] = useState(saved.active);
  const [error, setError] = useState("");
  const mutation = useMutation();
  const address = URL.canParse(url.trim()) ? new URL(url.trim()) : null;
  const validUrl = address?.protocol === "https:" && !address.username && !address.password && !address.search && !address.hash;
  const values = { expectedRevision: saved.revision, active, url: url.trim() || null, apiKey: removeKey ? null : key || undefined };
  const hasKey = !removeKey && (key ? webhookKeySchema.safeParse(key).success : saved.hasApiKey);
  const complete = validUrl && hasKey;
  const valid = webhookWriteSchema.safeParse(values).success && (!url.trim() || validUrl) && (!active || complete);

  async function save() {
    if (!valid) return;
    try {
      const response = await mutation.run(signal => api.put(path, values, { signal }));
      if (!response) return;
      setKey("");
      toast({ message: "Configuração de notificações externas salva.", state: "success" });
      refresh();
    } catch (cause) { setError(errorText(cause)); }
  }
  return <form className="admin-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <fieldset disabled={mutation.busy} className="admin-fields">
      <Field label="URL de destino" hint="Endereço HTTPS que receberá o POST dos erros críticos.">
        <input type="url" value={url} maxLength={2048} onChange={event => setUrl(event.target.value)} />
      </Field>
      <Field label="API key" hint={saved.hasApiKey ? "Chave cadastrada. Preencha apenas para substituí-la." : "Enviada ao destino no header api_key."}>
        <input type="password" autoComplete="new-password" value={key} maxLength={2048} disabled={removeKey} onChange={event => setKey(event.target.value)} />
      </Field>
      {saved.hasApiKey && <Check label="Remover chave cadastrada"><input type="checkbox" checked={removeKey} disabled={active}
        onChange={event => { setKey(""); setRemoveKey(event.target.checked); }} /></Check>}
      <Check label="Ativar envio externo"><input type="checkbox" checked={active} disabled={!active && !complete}
        onChange={event => setActive(event.target.checked)} /></Check>
    </fieldset>
    {error && <p role="alert" className="admin-error">{error}</p>}
    <div className="admin-actions">
      <Button type="submit" variant="primary" disabled={!valid || mutation.busy}>Salvar envio externo</Button>
      {error && <Button type="button" onClick={refresh}>Recarregar versão salva</Button>}
    </div>
  </form>;
}

export function WebhookSettingsPanel() {
  const { data, failed, loading, refresh } = useAdminRead(path, value => webhookSettingsSchema.parse(value));
  return <section className="dashboard-panel" aria-label="Notificações externas">
    <div className="panel-heading"><h2>Notificações externas</h2></div>
    <div className="admin-form"><p>Envie erros críticos de recursos críticos ao serviço cadastrado.</p>
      {failed ? <ReadError refresh={refresh}>Não foi possível carregar o envio externo.</ReadError>
        : loading || !data ? <p>Carregando configuração…</p> : <WebhookForm key={data.revision} saved={data} refresh={refresh} />}
    </div>
  </section>;
}
