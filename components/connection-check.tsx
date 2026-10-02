"use client";

import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/client/api";
import type { HealthResponse } from "@/lib/health";
import { Button } from "@/components/ui/button";

export function ConnectionCheck() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function check() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const { data } = await api.get<HealthResponse>("/health");
      setMessage(data.status === "ok" ? "Conexão disponível." : "Conexão temporariamente indisponível.");
    } catch {
      setMessage("Conexão temporariamente indisponível. Tente novamente.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-8">
      <Button onClick={check} disabled={busy} aria-busy={busy}>
        <RefreshCw aria-hidden="true" className={busy ? "animate-spin motion-reduce:animate-none" : ""} />
        {busy ? "Verificando…" : "Verificar conexão"}
      </Button>
      <p role="status" className="mt-3 min-h-5 text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
