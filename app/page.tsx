import { AppShell } from "@/components/layout/app-shell";

export default function HomePage() {
  return (
    <AppShell>
      <h1 className="text-[29px] font-semibold tracking-[-1px]">Dashboard</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">Bem-vindo à central de monitoramento. Os indicadores estarão disponíveis aqui após a configuração do monitoramento.</p>
    </AppShell>
  );
}
