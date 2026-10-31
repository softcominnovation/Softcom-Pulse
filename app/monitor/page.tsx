import { AppShell } from "@/components/layout/app-shell";
import { Dashboard } from "@/components/dashboard/dashboard";
import "@/components/dashboard/dashboard.css";

export default function PublicHomePage() {
  return (
    <>
      <script src="/monitor-compat-bootstrap.js" defer />
      <noscript><meta httpEquiv="refresh" content="0;url=/monitor?compat=1" /></noscript>
      <AppShell dashboard publicRead>
        <Dashboard />
      </AppShell>
    </>
  );
}
