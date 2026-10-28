"use client";
// Não remover codigo da rota de WhatsApp, ela será usada futuramente #rota-whatsApp
import {
  IconActivityHeartbeat,
  IconApps,
  IconBox,
  IconBrandWhatsapp,
  IconCloud,
  IconLayersSubtract,
  IconLayoutGrid,
  IconServer,
  IconSettings,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isPublicPath } from "@/lib/public/paths";
import { useCanEdit } from "@/store/auth.store";

export function MonitoringNav() {
  const path = usePathname() ?? "/";
  const editor = useCanEdit();

  if (isPublicPath(path)) {
    const links = [
      {
        href: "/monitor",
        label: "Visão geral",
        icon: IconLayoutGrid,
        active: path === "/monitor",
      },
      {
        href: "/monitor/infraestrutura",
        label: "Infraestrutura",
        icon: IconServer,
        active:
          path === "/monitor/infraestrutura" || path.startsWith("/monitor/hosts/"),
      },
      {
        href: "/monitor/vps",
        label: "VPS",
        icon: IconCloud,
        active: path === "/monitor/vps" || path.startsWith("/monitor/vps/"),
      },
      {
        href: "/monitor/servicos",
        label: "Serviços",
        icon: IconBox,
        active: path === "/monitor/servicos",
      },
      // {
      //   href: "/monitor/whatsapp",
      //   label: "WhatsApp",
      //   icon: IconBrandWhatsapp,
      //   active: path === "/monitor/whatsapp" || path.startsWith("/monitor/whatsapp/"),
      // },
      {
        href: "/monitor/aplicacoes",
        label: "Aplicações",
        icon: IconApps,
        active: path === "/monitor/aplicacoes",
      },
    ];
    return (
      <nav
        className="monitoring-nav pulse-view-tabs"
        aria-label="Navegação principal"
      >
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            data-sound="tap"
          >
            <item.icon aria-hidden="true" />
            {item.label}
          </Link>
        ))}
      </nav>
    );
  }

  const links = [
    {
      href: "/",
      label: "Visão geral",
      icon: IconLayoutGrid,
      active: path === "/",
      admin: false,
    },
    {
      href: "/infraestrutura",
      label: "Infraestrutura",
      icon: IconServer,
      active: path === "/infraestrutura" || path.startsWith("/hosts/"),
      admin: false,
    },
    {
      href: "/asgard",
      label: "Asgard & VMs",
      icon: IconLayersSubtract,
      active: path === "/asgard",
      admin: false,
    },
    {
      href: "/admin/vps",
      label: "VPS",
      icon: IconCloud,
      active: path === "/admin/vps" || path.startsWith("/admin/vps/"),
      admin: true,
    },
    {
      href: "/servicos",
      label: "Serviços",
      icon: IconBox,
      active: path === "/servicos",
      admin: false,
    },
    // {
    //   href: "/whatsapp",
    //   label: "WhatsApp",
    //   icon: IconBrandWhatsapp,
    //   active: path === "/whatsapp" || path.startsWith("/whatsapp/"),
    //   admin: false,
    // },
    {
      href: "/admin/aplicacoes",
      label: "Aplicações",
      icon: IconApps,
      active: path === "/admin/aplicacoes",
      admin: true,
    },
    {
      href: "/admin/recursos",
      label: "Recursos",
      icon: IconActivityHeartbeat,
      active: path === "/admin/recursos",
      admin: true,
    },
    {
      href: "/admin/configuracoes",
      label: "Configurações",
      icon: IconSettings,
      active: path === "/admin/configuracoes",
      admin: true,
      editorOnly: true,
    },
  ];

  return (
    <nav
      className="monitoring-nav pulse-view-tabs"
      aria-label="Navegação principal"
    >
      {links
        .filter((item) => editor || !item.editorOnly)
        .map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={item.admin ? "admin-nav-link" : undefined}
            aria-current={item.active ? "page" : undefined}
            data-sound="tap"
          >
            <item.icon aria-hidden="true" />
            {item.label}
          </Link>
        ))}
    </nav>
  );
}
