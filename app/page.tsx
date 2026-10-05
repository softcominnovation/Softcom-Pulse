import { AppShell } from "@/components/layout/app-shell";
import { Dashboard } from "@/components/dashboard/dashboard";
import "@/components/dashboard/dashboard.css";

export default function HomePage() {
  return (
    <AppShell dashboard>
      <Dashboard />
    </AppShell>
  );
}
