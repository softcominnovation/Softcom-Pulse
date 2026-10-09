import { AppShell } from "@/components/layout/app-shell";
import { VpsDetail } from "@/components/admin/vps-detail";
import "@/components/dashboard/dashboard.css";
import "@/components/dashboard/availability.css";
import "@/components/admin/admin.css";

export default async function PublicVpsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell publicRead><VpsDetail key={id} id={id} /></AppShell>;
}
