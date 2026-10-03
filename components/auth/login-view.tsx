"use client";

import Image, { getImageProps } from "next/image";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { usePublicConfig } from "@/app/providers";
import { loginSchema, type LoginInput } from "@/lib/auth/contracts";
import { messageOf } from "@/lib/client/auth-session";
import { getAuthController, useAuthStore } from "@/store/auth.store";
import { Brand } from "@/components/brand";
import { AuthGate } from "./auth-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function CorporateSignature({ desktop = false }: { desktop?: boolean }) {
  const { softcomUrl } = usePublicConfig();
  return (
    <a href={softcomUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-control">
      <Image src="/images/softcom-logo.png" alt="Softcom Tecnologia" width={1768} height={253} sizes={desktop ? "140px" : "120px"} className={desktop ? "h-auto w-[140px]" : "h-auto w-[120px]"} />
    </a>
  );
}
function Copyright() {
  return <p className="text-center text-xs text-muted-foreground">© {new Date().getFullYear()} Softcom Tecnologia. Todos os direitos reservados.</p>;
}
const art = getImageProps({ src: "/images/login-image.png", alt: "", width: 320, height: 240, sizes: "320px" }).props;

export function LoginView() {
  const router = useRouter();
  const submitting = useRef(false);
  const { issue } = useAuthStore();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", senha: "" } });
  async function submit(data: LoginInput) {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await getAuthController().login(data);
      router.replace("/");
    } catch (error) { toast.error(messageOf(error)); }
    finally { submitting.current = false; }
  }
  return (
    <AuthGate publicOnly>
      <main className="login-layout flex min-h-dvh">
        <aside className="login-art hidden w-1/2 flex-col border-r bg-card p-12 min-[1024px]:flex" aria-label="Softcom Pulse">
          <div className="flex flex-1 flex-col items-center justify-center gap-8 py-8">
            <div>
              <Brand size={64} stacked large />
              <p className="mt-1 text-center text-base text-muted-foreground">Central de monitoramento</p>
            </div>
            <picture className="block aspect-[4/3] w-full max-w-[320px]">
              <source media="(min-width: 1024px)" srcSet={art.srcSet} sizes="320px" />
              {/* The transparent fallback prevents a hidden desktop illustration download on mobile. */}
              <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="" width={320} height={240} className="h-auto w-full object-contain" />
            </picture>
            <CorporateSignature desktop />
          </div>
          <Copyright />
        </aside>
        <div className="flex min-h-dvh w-full flex-col min-[1024px]:w-1/2">
          <div className="flex flex-1 items-center justify-center px-8 py-12 max-[520px]:px-4 max-[520px]:py-8">
            <div className="w-full max-w-96">
              <Brand size={48} stacked />
              <div className="mt-6">
                <h1 className="text-xl font-semibold">Entrar</h1>
                <p className="mt-1 text-sm text-muted-foreground">Acesse a central de monitoramento da Softcom.</p>
              </div>
              <form onSubmit={event => { void handleSubmit(submit)(event); }} noValidate className="mt-6 space-y-4" aria-busy={isSubmitting}>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-[13px] font-semibold">E-mail</Label>
                  <Input id="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} className="min-h-11 px-3 py-2.5 text-sm leading-5" {...register("email")} />
                  {errors.email && <p id="email-error" role="alert" className="text-xs text-destructive">{errors.email.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="senha" className="text-[13px] font-semibold">Senha</Label>
                  <Input id="senha" type="password" autoComplete="current-password" aria-invalid={!!errors.senha} aria-describedby={errors.senha ? "senha-error" : undefined} className="min-h-11 px-3 py-2.5 text-sm leading-5" {...register("senha")} />
                  {errors.senha && <p id="senha-error" role="alert" className="text-xs text-destructive">{errors.senha.message}</p>}
                </div>
                {issue && !isSubmitting && <p role="alert" className="text-sm text-destructive">{issue}</p>}
                <Button variant="primary" type="submit" disabled={isSubmitting} className="min-h-11 w-full text-sm font-semibold">
                  {isSubmitting && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                  {isSubmitting ? "Entrando…" : "Entrar"}
                </Button>
              </form>
              <div className="mt-6 flex justify-center min-[1024px]:hidden"><CorporateSignature /></div>
            </div>
          </div>
          <footer className="px-4 pb-6 min-[1024px]:hidden"><Copyright /></footer>
        </div>
      </main>
    </AuthGate>
  );
}
