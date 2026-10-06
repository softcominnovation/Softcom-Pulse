import { AppShell } from "@/components/layout/app-shell";
import { Services } from "@/components/services/services";
import "@/components/dashboard/dashboard.css";
import "@/components/infrastructure/infrastructure.css";

export default function ServicesPage() {
  return <AppShell><Services /></AppShell>;
}
