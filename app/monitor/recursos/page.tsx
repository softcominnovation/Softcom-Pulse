import { AppShell } from "@/components/layout/app-shell";
import { ResourcesAdmin } from "@/components/admin/resources";
import "@/components/dashboard/dashboard.css";
import "@/components/infrastructure/infrastructure.css";
import "@/components/admin/admin.css";

export default async function PublicResourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AppShell publicRead><ResourcesAdmin selection={await searchParams} /></AppShell>;
}
