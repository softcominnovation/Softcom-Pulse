import { AppShell } from "@/components/layout/app-shell";
import { VpsAdmin } from "@/components/admin/vps-admin";
import "@/components/dashboard/dashboard.css";
import "@/components/dashboard/availability.css";
import "@/components/admin/admin.css";

export default function VpsPage() { return <AppShell><VpsAdmin /></AppShell>; }
