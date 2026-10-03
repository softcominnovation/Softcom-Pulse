"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { getAuthController, useAuthStore } from "@/store/auth.store";
import { Button } from "@/components/ui/button";

export function AuthGate({ children, publicOnly = false }: { children: ReactNode; publicOnly?: boolean }) {
  const { status, issue } = useAuthStore();
  const router = useRouter();
  const redirect = status === "anonymous" && !publicOnly ? "/login" : status === "authenticated" && publicOnly ? "/" : null;
  useEffect(() => { if (redirect) router.replace(redirect); }, [redirect, router]);
  if (status === "loading" || redirect) return (
    <main className="grid min-h-dvh place-items-center px-4">
      <p role="status" className="flex items-center gap-3 text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-5 animate-spin" />Verificando sessão…</p>
    </main>
  );
  if (status === "unavailable") return (
    <main className="grid min-h-dvh place-items-center p-4">
      <section className="w-full max-w-md rounded-panel border bg-card p-6">
        <h1 className="text-xl font-semibold">Não foi possível validar sua sessão</h1>
        <p role="alert" className="mt-3 text-muted-foreground">{issue}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="primary" className="min-h-11" onClick={() => { getAuthController().store.setState({ status: "loading" }); void getAuthController().validate(); }}>Tentar novamente</Button>
          <Button className="min-h-11" onClick={() => { void getAuthController().logout(); }}>Voltar ao login</Button>
        </div>
      </section>
    </main>
  );
  return children;
}
