"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import { isPublicPath, toPublicHref } from "@/lib/public/paths";

export function usePlaceHref() {
  const path = usePathname();
  return (href: string) => isPublicPath(path) ? toPublicHref(href) : href;
}

export function PlaceLink({ href, hideWhenClosed = false, children, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string; hideWhenClosed?: boolean; children: ReactNode }) {
  const next = usePlaceHref()(href);
  if (!next) return hideWhenClosed ? null : <span>{children}</span>;
  return <Link href={next} {...props}>{children}</Link>;
}
