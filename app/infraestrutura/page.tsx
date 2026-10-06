import { AppShell } from "@/components/layout/app-shell";
import { Infrastructure } from "@/components/infrastructure/infrastructure";
import "@/components/dashboard/dashboard.css";
import "@/components/infrastructure/infrastructure.css";

export default function InfrastructurePage() {
  return <AppShell><Infrastructure /></AppShell>;
}
