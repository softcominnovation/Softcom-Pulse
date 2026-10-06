import { AppShell } from "@/components/layout/app-shell";
import { AsgardDetails } from "@/components/dashboard/asgard-details";
import "@/components/dashboard/dashboard.css";
import "@/components/infrastructure/infrastructure.css";

export default async function AsgardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AppShell><AsgardDetails query={await searchParams} /></AppShell>;
}
