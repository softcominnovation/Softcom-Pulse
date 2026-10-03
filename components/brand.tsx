"use client";

import Image from "next/image";
import { usePublicConfig } from "@/app/providers";
import { cn } from "@/lib/utils";

export function Brand({ size = 37, stacked = false, large = false }: { size?: number; stacked?: boolean; large?: boolean }) {
  const { appName } = usePublicConfig();
  const defaultName = appName.toLowerCase() === "softcom pulse";
  return (
    <div className={cn("flex min-w-0 items-center gap-3", stacked && "flex-col text-center")}>
      <Image src="/logo.png" alt="" width={size} height={size} className="shrink-0" />
      <p className={cn("break-words", large || !stacked ? "text-[23px] font-[650] tracking-[-.8px]" : "text-lg font-semibold")}>
        {defaultName && (large || !stacked) ? <>softcom <span className="font-[350] text-[#b4c7cc]">pulse</span></> : appName}
      </p>
    </div>
  );
}
