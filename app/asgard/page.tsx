import { AppShell } from "@/components/layout/app-shell";
import { AsgardDetails } from "@/components/dashboard/asgard-details";
import "@/components/dashboard/dashboard.css";

export default async function AsgardPage({ searchParams }: { searchParams: Promise<{ hostKey?: string | string[] }> }) {
  const { hostKey } = await searchParams;
  return <AppShell><AsgardDetails hostKey={typeof hostKey === "string" ? hostKey : undefined} /></AppShell>;
}
