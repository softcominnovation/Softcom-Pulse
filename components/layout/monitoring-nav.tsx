"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Server, Layers, Box, SlidersHorizontal, AppWindow, Cloud, Settings } from "lucide-react";
import { isPublicPath } from "@/lib/public/paths";
import { useCanEdit } from "@/store/auth.store";

export function MonitoringNav() {
  const path = usePathname();
  const editor = useCanEdit();
  if (isPublicPath(path)) {
    const links = [
      { href: "/monitor", label: "Visão geral", icon: LayoutGrid, active: path === "/monitor" },
      { href: "/monitor/infraestrutura", label: "Infraestrutura", icon: Server, active: path === "/monitor/infraestrutura" || path.startsWith("/monitor/hosts/") },
      { href: "/monitor/vps", label: "VPS", icon: Cloud, active: path === "/monitor/vps" || path.startsWith("/monitor/vps/") },
      { href: "/monitor/servicos", label: "Serviços", icon: Box, active: path === "/monitor/servicos" },
      { href: "/monitor/aplicacoes", label: "Aplicações", icon: AppWindow, active: path === "/monitor/aplicacoes" },
      { href: "/monitor/recursos", label: "Recursos", icon: SlidersHorizontal, active: path === "/monitor/recursos" },
    ];
    return <nav className="monitoring-nav" aria-label="Navegação principal">
      {links.map(item => <Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined}><item.icon aria-hidden="true" />{item.label}</Link>)}
    </nav>;
  }
  const links = [
    { href: "/", label: "Visão geral", icon: LayoutGrid, active: path === "/", admin: false },
    { href: "/infraestrutura", label: "Infraestrutura", icon: Server, active: path === "/infraestrutura" || path.startsWith("/hosts/"), admin: false },
    { href: "/asgard", label: "Asgard & VMs", icon: Layers, active: path === "/asgard", admin: false },
    { href: "/admin/vps", label: "VPS", icon: Cloud, active: path === "/admin/vps" || path.startsWith("/admin/vps/"), admin: true },
    { href: "/servicos", label: "Serviços", icon: Box, active: path === "/servicos", admin: false },
    { href: "/admin/aplicacoes", label: "Aplicações", icon: AppWindow, active: path === "/admin/aplicacoes", admin: true },
    { href: "/admin/recursos", label: "Recursos", icon: SlidersHorizontal, active: path === "/admin/recursos", admin: true },
    { href: "/admin/configuracoes", label: "Configurações", icon: Settings, active: path === "/admin/configuracoes", admin: true, editorOnly: true },
  ];
  return <nav className="monitoring-nav" aria-label="Navegação principal">
    {links.filter(item => editor || !item.editorOnly).map(item => <Link key={item.href} href={item.href} className={item.admin ? "admin-nav-link" : undefined} aria-current={item.active ? "page" : undefined}><item.icon aria-hidden="true" />{item.label}</Link>)}
  </nav>;
}
