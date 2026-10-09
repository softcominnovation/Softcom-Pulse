import { AppShell } from "@/components/layout/app-shell";
import { ApplicationsAdmin } from "@/components/admin/applications";
import "@/components/dashboard/dashboard.css";
import "@/components/dashboard/availability.css";
import "@/components/admin/admin.css";

export default function PublicApplicationsPage() { return <AppShell publicRead><ApplicationsAdmin /></AppShell>; }
