"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notificationDateError, type NotificationDateRange } from "@/lib/notifications/history-range";

export function NotificationHistoryDateRange({ value, today, onApply }: { value: NotificationDateRange; today: string; onApply: (range: NotificationDateRange | null) => void }) {
  const id = useId(), fromInput = useRef<HTMLInputElement>(null), toInput = useRef<HTMLInputElement>(null);
  const [from, setFrom] = useState(value.from), [to, setTo] = useState(value.to ?? "");
  const [error, setError] = useState<ReturnType<typeof notificationDateError>>(null);
  return <form noValidate onSubmit={event => {
    event.preventDefault();
    const invalid = notificationDateError(from, to, today); setError(invalid);
    if (invalid) { (invalid.field === "from" ? fromInput : toInput).current?.focus(); return; }
    onApply({ from, ...(to ? { to } : {}) });
  }} className="space-y-2 rounded-xl border p-3">
    <fieldset className="grid min-w-0 grid-cols-2 gap-2"><legend className="mb-2 text-xs font-semibold">Período do histórico</legend>
      <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-from`} className="text-xs">Data inicial</Label><Input ref={fromInput} id={`${id}-from`} type="date" required max={today} value={from} onChange={event => { setFrom(event.target.value); setError(null); }} aria-invalid={error?.field === "from"} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`} className="text-xs md:text-xs" /></div>
      <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-to`} className="text-xs">Data final (opcional)</Label><Input ref={toInput} id={`${id}-to`} type="date" min={from || undefined} max={today} value={to} onChange={event => { setTo(event.target.value); setError(null); }} aria-invalid={error?.field === "to"} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`} className="text-xs md:text-xs" /></div>
    </fieldset>
    <p id={`${id}-help`} className="text-xs text-muted-foreground">Sem data final, consulta apenas o dia inicial. Horário de Fortaleza · UTC−3.</p>
    {error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error.message}</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" variant="outline">Filtrar período</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setFrom(today); setTo(""); setError(null); onApply(null); }}>Hoje</Button></div>
  </form>;
}
