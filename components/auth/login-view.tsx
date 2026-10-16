"use client";

import Image, { getImageProps } from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import {
  IconActivityHeartbeat,
  IconArrowUpRight,
  IconBrandWhatsapp,
  IconServer,
  IconShieldCheck,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { usePublicConfig } from "@/app/providers";
import { loginSchema, type LoginInput } from "@/lib/auth/contracts";
import { messageOf } from "@/lib/client/auth-session";
import { getAuthController, useAuthStore } from "@/store/auth.store";
import { Brand } from "@/components/brand";
import { AuthGate } from "./auth-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import "./login-view.css";

function CorporateSignature({ desktop = false }: { desktop?: boolean }) {
  const { softcomUrl } = usePublicConfig();
  return (
    <a
      href={softcomUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center rounded-control opacity-85 transition-opacity hover:opacity-100"
    >
      <Image
        src="/images/softcom-logo.png"
        alt="Softcom Tecnologia"
        width={1768}
        height={253}
        sizes={desktop ? "140px" : "120px"}
        className={desktop ? "h-auto w-[140px]" : "h-auto w-[120px]"}
      />
    </a>
  );
}

function Copyright() {
  return (
    <p className="text-center text-xs text-muted-foreground">
      © {new Date().getFullYear()} Softcom Tecnologia. Todos os direitos reservados.
    </p>
  );
}

const art = getImageProps({
  src: "/images/login-image.png",
  alt: "",
  width: 320,
  height: 240,
  sizes: "320px",
}).props;

export function LoginView() {
  const router = useRouter();
  const submitting = useRef(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const { issue } = useAuthStore();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", senha: "" },
  });

  async function submit(data: LoginInput) {
    if (submitting.current) return;
    submitting.current = true;
    setPasswordVisible(false);
    try {
      await getAuthController().login(data);
      router.replace("/");
    } catch (error) {
      toast.error(messageOf(error));
    } finally {
      submitting.current = false;
    }
  }

  function fillDemoCredentials() {
    setValue("email", "operacao@softcom.com.br", { shouldValidate: true });
    setValue("senha", "softcom-pulse", { shouldValidate: true });
  }

  return (
    <AuthGate publicOnly>
      <main className="login-layout flex min-h-dvh">
        <div className="login-ambient-grid" aria-hidden="true" />
        <div className="login-orb login-orb-primary" aria-hidden="true" />
        <div className="login-orb login-orb-secondary" aria-hidden="true" />

        <aside
          className="login-art hidden w-1/2 flex-col justify-between p-10 min-[1024px]:flex xl:p-14"
          aria-label="Softcom Pulse"
        >
          <div className="flex items-center justify-between gap-4">
            <Brand size={34} />
            <span className="login-pill">
              <i className="dot good" aria-hidden="true" />
              KOBRA · TELEMETRIA ATIVA
            </span>
          </div>

          <div className="my-auto flex flex-col items-center gap-6 py-6">
            <div className="max-w-md text-center">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                CENTRAL DE OPERAÇÕES SOFTCOM
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-foreground xl:text-[28px]">
                Toda a operação. Um só lugar.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Infraestrutura ASGARD, hipervisores, bancos críticos, sondas HTTP,
                Softcom Signal e instâncias WhatsApp reunidos em tempo real.
              </p>
            </div>

            <div className="login-showcase-card relative flex flex-col items-center gap-4">
              <picture className="pointer-events-none absolute inset-x-0 top-4 mx-auto block aspect-[4/3] w-full max-w-[320px] opacity-0">
                <source media="(min-width: 1024px)" srcSet={art.srcSet} sizes="320px" />
                {/* The transparent fallback prevents a hidden desktop illustration download on mobile. */}
                <img
                  src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
                  alt=""
                  width={320}
                  height={240}
                  className="h-auto w-full object-contain"
                />
              </picture>

              <div className="flex w-full items-center justify-between border-b border-border/60 pb-3 text-xs">
                <span className="inline-flex items-center gap-2 font-medium text-foreground">
                  <IconActivityHeartbeat className="size-4 text-muted-foreground" />
                  Pulso da Operação · Tempo Real
                </span>
                <Badge variant="positive" size="sm">
                  Operacional · 99,96%
                </Badge>
              </div>

              <div className="flex w-full flex-col gap-2.5">
                {[
                  { name: "Retaguarda ERP · Web & API", sub: "Cluster Principal · 42 ms", status: "good", uptime: "99,95%" },
                  { name: "API Fiscal · NFC-e / NF-e", sub: "Autorizador Sefaz · 68 ms", status: "good", uptime: "99,88%" },
                  { name: "Softcom Pay · PIX & TEF", sub: "Liquidação instantânea · 49 ms", status: "good", uptime: "99,96%" },
                  { name: "Hub WhatsApp · Meta & Evolution", sub: "6 instâncias monitoradas · 38 ms", status: "good", uptime: "100%" },
                ].map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/65 px-3.5 py-2.5 backdrop-blur-md"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <i className={`dot ${item.status}`} aria-hidden="true" />
                        <span className="truncate text-xs font-medium text-foreground">
                          {item.name}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate pl-3.5 text-[11px] text-muted-foreground">
                        {item.sub}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-medium text-foreground">
                      {item.uptime}
                    </span>
                  </div>
                ))}
              </div>

              <div className="grid w-full grid-cols-3 gap-2.5 text-left">
                <div className="login-metric-chip">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <IconServer className="size-3.5" />
                    ASGARD
                  </span>
                  <strong className="font-mono text-xs text-foreground">14 VMs ativas</strong>
                </div>
                <div className="login-metric-chip">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <IconBrandWhatsapp className="size-3.5" />
                    WhatsApp
                  </span>
                  <strong className="font-mono text-xs text-foreground">Meta & Evolution</strong>
                </div>
                <div className="login-metric-chip">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <IconShieldCheck className="size-3.5" />
                    Signal
                  </span>
                  <strong className="font-mono text-xs text-foreground">Filas em dia</strong>
                </div>
              </div>
            </div>

            <CorporateSignature desktop />
          </div>

          <Copyright />
        </aside>

        <div className="relative z-10 flex min-h-dvh w-full flex-col min-[1024px]:w-1/2">
          <div className="flex flex-1 items-center justify-center px-6 py-10 max-[520px]:px-4 max-[520px]:py-6">
            <div className="login-glass-card">
              <div className="flex items-center justify-between gap-3">
                <Brand size={36} />
                <Badge variant="neutral" size="sm">
                  Acesso corporativo
                </Badge>
              </div>

              <div className="mt-6">
                <h1 className="text-2xl font-bold tracking-[-0.03em] text-foreground">
                  Entrar
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Acesse a central de monitoramento da Softcom.
                </p>
              </div>

              <form
                onSubmit={(event) => {
                  void handleSubmit(submit)(event);
                }}
                noValidate
                className="mt-6 space-y-4"
                aria-busy={isSubmitting}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-[13px] font-semibold">
                    E-mail
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="voce@softcomtecnologia.com.br"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? "email-error" : undefined}
                    className="min-h-11 bg-background/60 px-3 py-2.5 text-sm leading-5 backdrop-blur-sm"
                    {...register("email")}
                  />
                  {errors.email && (
                    <p id="email-error" role="alert" className="text-xs text-destructive">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="senha" className="text-[13px] font-semibold">
                    Senha
                  </Label>
                  <div className="relative">
                    <Input
                      id="senha"
                      type={passwordVisible ? "text" : "password"}
                      placeholder="••••••••••••"
                      autoComplete="current-password"
                      aria-invalid={!!errors.senha}
                      aria-describedby={errors.senha ? "senha-error" : undefined}
                      className="min-h-11 bg-background/60 py-2.5 pl-3 pr-12 text-sm leading-5 backdrop-blur-sm"
                      {...register("senha")}
                    />
                    <button
                      type="button"
                      aria-label={passwordVisible ? "Ocultar senha" : "Mostrar senha"}
                      title={passwordVisible ? "Ocultar senha" : "Mostrar senha"}
                      aria-pressed={passwordVisible}
                      aria-controls="senha"
                      disabled={isSubmitting}
                      onClick={() => setPasswordVisible((value) => !value)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-control text-muted-foreground transition-colors hover:text-foreground aria-pressed:text-foreground disabled:opacity-50"
                    >
                      {passwordVisible ? (
                        <EyeOff className="pointer-events-none size-5 shrink-0" aria-hidden="true" />
                      ) : (
                        <Eye className="pointer-events-none size-5 shrink-0" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {errors.senha && (
                    <p id="senha-error" role="alert" className="text-xs text-destructive">
                      {errors.senha.message}
                    </p>
                  )}
                </div>

                {issue && !isSubmitting && (
                  <p role="alert" className="text-sm text-destructive">
                    {issue}
                  </p>
                )}

                <Button
                  variant="primary"
                  type="submit"
                  disabled={isSubmitting}
                  className="min-h-11 w-full text-sm font-semibold"
                >
                  {isSubmitting && (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  )}
                  {isSubmitting ? "Entrando…" : "Entrar"}
                </Button>
              </form>

              <div className="login-quick-demo">
                <button
                  type="button"
                  onClick={fillDemoCredentials}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Preencher acesso demo
                </button>
                <Link
                  href="/monitor"
                  className="inline-flex items-center gap-1 text-xs font-medium text-foreground no-underline hover:underline"
                >
                  Painel público
                  <IconArrowUpRight className="size-3.5" />
                </Link>
              </div>

              <div className="mt-6 flex justify-center min-[1024px]:hidden">
                <CorporateSignature />
              </div>
            </div>
          </div>
          <footer className="px-4 pb-6 min-[1024px]:hidden">
            <Copyright />
          </footer>
        </div>
      </main>
    </AuthGate>
  );
}
