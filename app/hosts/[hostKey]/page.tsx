import { AppShell } from "@/components/layout/app-shell";
import { HostDetails } from "@/components/infrastructure/host-details";
import "@/components/dashboard/dashboard.css";
import "@/components/infrastructure/infrastructure.css";

export default async function HostPage({ params, searchParams }: { params: Promise<{ hostKey: string }>; searchParams: Promise<{ range?: string | string[] }> }) {
  const { hostKey } = await params, { range } = await searchParams;
  return <AppShell><HostDetails hostKey={hostKey} range={range} /></AppShell>;
}
