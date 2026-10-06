"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Server, Layers, Box } from "lucide-react";

export function MonitoringNav() {
  const path = usePathname();
  return <nav className="monitoring-nav" aria-label="Navegação principal">
    {[{ href: "/", label: "Visão geral", icon: LayoutGrid, active: path === "/" }, { href: "/servicos", label: "Serviços", icon: Box, active: path === "/servicos" }, { href: "/infraestrutura", label: "Infraestrutura", icon: Server, active: path === "/infraestrutura" || path.startsWith("/hosts/") }, { href: "/asgard", label: "Asgard & VMs", icon: Layers, active: path === "/asgard" }].map(item => <Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined}><item.icon aria-hidden="true" />{item.label}</Link>)}
  </nav>;
}
