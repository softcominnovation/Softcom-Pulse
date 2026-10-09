import { AppShell } from "@/components/layout/app-shell";
import { Infrastructure } from "@/components/infrastructure/infrastructure";
import "@/components/dashboard/dashboard.css";
import "@/components/infrastructure/infrastructure.css";

export default function PublicInfrastructurePage() {
  return <AppShell publicRead><Infrastructure /></AppShell>;
}
