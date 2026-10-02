import Image from "next/image";
import { getPublicConfig } from "@/lib/server/public-config";
import { ConnectionCheck } from "@/components/connection-check";

export default function HomePage() {
  const { appName, softcomUrl } = getPublicConfig();
  return (
    <div className="flex min-h-dvh flex-col px-4 sm:px-8">
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 items-center py-12">
        <section aria-labelledby="welcome-title" className="w-full rounded-panel border border-border bg-card p-6 sm:p-10">
          <Image src="/logo.png" alt="" width={72} height={72} priority className="mb-6" />
          <p className="mb-3 text-[11px] font-semibold tracking-[.14em] text-muted-foreground uppercase">Central de monitoramento</p>
          <h1 id="welcome-title" className="break-words text-[27px] leading-tight font-semibold tracking-[-1px]">{appName}</h1>
          <p className="mt-3 text-muted-foreground">O acesso à central está sendo preparado.</p>
          <ConnectionCheck />
        </section>
      </main>
      <footer className="py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} <a href={softcomUrl} className="rounded-control underline-offset-4 hover:text-foreground hover:underline">Softcom Tecnologia</a>
      </footer>
    </div>
  );
}
