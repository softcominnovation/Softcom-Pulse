import { AppShell } from "@/components/layout/app-shell";
import { Dashboard } from "@/components/dashboard/dashboard";
import { compatibleAssetUrl } from "@/lib/server/monitor-compat/assets";
import "@/components/dashboard/dashboard.css";

export default function PublicHomePage() {
  return (
    <>
      <script src={compatibleAssetUrl("monitor-compat-bootstrap.js")} defer />
      <noscript><meta httpEquiv="refresh" content="0;url=/monitor?compat=1" /></noscript>
    <AppShell dashboard publicRead>
      <Dashboard initialTvMode />
    </AppShell>
    </>
  );
}
