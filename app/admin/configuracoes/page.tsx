import { AppShell } from "@/components/layout/app-shell";
import { EditorGate } from "@/components/admin/editor-gate";
import { PresentationAdmin } from "@/components/admin/presentation";
import { VmsAdmin } from "@/components/admin/vms";
import { TemplatesAdmin } from "@/components/admin/templates";
import { EvidenceClock } from "@/components/infrastructure/data";
import "@/components/dashboard/dashboard.css";
import "@/components/infrastructure/infrastructure.css";
import "@/components/admin/admin.css";

export default function SettingsPage() {
  return <AppShell><EvidenceClock><EditorGate><div className="admin-page admin-settings-page"><header className="admin-heading"><h1>Configurações da visualização</h1><p>Organize as telas compartilhadas e os nomes de VMs, hosts, containers e templates.</p></header><PresentationAdmin /><VmsAdmin /><TemplatesAdmin /></div></EditorGate></EvidenceClock></AppShell>;
}
