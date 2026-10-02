"use client";

import { useRef, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type ConfirmationDialogProps = {
  trigger: ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  errorMessage?: string;
};

export function ConfirmationDialog({ trigger, title, description, confirmLabel, destructive = false, onConfirm, errorMessage = "Não foi possível concluir. Tente novamente." }: ConfirmationDialogProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  function changeOpen(value: boolean) {
    if (pending.current) return;
    setError("");
    setOpen(value);
  }

  async function confirm() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      setError(errorMessage);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent hideClose={busy} aria-busy={busy} onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <DialogBody><DialogDescription>{description}</DialogDescription>{error && <p role="alert" className="mt-4 text-destructive">{error}</p>}</DialogBody>
        <DialogFooter>
          <Button ref={cancelRef} onClick={() => changeOpen(false)} disabled={busy}>Cancelar</Button>
          <Button variant={destructive ? "destructive" : "primary"} onClick={confirm} disabled={busy}>{busy ? "Aguarde…" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
