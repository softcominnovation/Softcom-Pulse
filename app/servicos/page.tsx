import { AppShell } from "@/components/layout/app-shell";
import { Services } from "@/components/services/services";
import "@/components/dashboard/dashboard.css";
import "@/components/dashboard/availability.css";
import "@/components/infrastructure/infrastructure.css";
import "@/components/admin/admin.css";

export default function ServicesPage() {
  return <AppShell><Services /></AppShell>;
}
