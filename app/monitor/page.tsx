import { headers } from "next/headers";
import { PublicMonitor } from "@/components/dashboard/public-monitor";
import { compatibleAssetUrl } from "@/lib/server/monitor-compat/assets";
import { initialPublicMonitorZoom } from "@/lib/server/monitor-compat/settings";
import "@/components/dashboard/dashboard.css";

export default async function PublicHomePage() {
  const zoom = await initialPublicMonitorZoom((await headers()).get("host") ?? "");
  return (
    <>
      <script src={compatibleAssetUrl("monitor-compat-bootstrap.js")} async />
      <noscript><meta httpEquiv="refresh" content="0;url=/monitor?compat=1" /></noscript>
      <PublicMonitor initialZoomPercent={zoom} />
    </>
  );
}
