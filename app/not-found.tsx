import { AppShell } from "@/components/layout/app-shell";
import { NotFoundView } from "@/components/not-found-view";
import "@/components/dashboard/dashboard.css";

export default function NotFound() {
  return (
    <AppShell publicRead nav={false}>
      <NotFoundView />
    </AppShell>
  );
}
