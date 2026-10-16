import { AppShell } from "@/components/layout/app-shell";
import { WhatsAppInstances } from "@/components/whatsapp/whatsapp-instances";
import "@/components/dashboard/dashboard.css";

export default function PublicWhatsAppPage() {
  return (
    <AppShell publicRead>
      <WhatsAppInstances publicRead />
    </AppShell>
  );
}
