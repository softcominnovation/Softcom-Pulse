"use client";

import { IconActivityHeartbeat } from "@tabler/icons-react";
import { usePublicConfig } from "@/app/providers";
import { cn } from "@/lib/utils";

export function Brand({
  size = 32,
  stacked = false,
  large = false,
  className,
}: {
  size?: number;
  stacked?: boolean;
  large?: boolean;
  className?: string;
}) {
  const { appName } = usePublicConfig();
  const defaultName = appName.toLowerCase() === "softcom pulse";
  const iconSize = Math.round((size * 24) / 32);
  const radius = Math.round((size * 9) / 32);

  return (
    <div
      className={cn(
        "pulse-brand",
        stacked && "flex-col text-center",
        className
      )}
    >
      <span
        className="pulse-brand-mark"
        style={
          size !== 32
            ? { width: size, height: size, borderRadius: radius }
            : undefined
        }
        aria-hidden="true"
      >
        <IconActivityHeartbeat size={iconSize} />
      </span>
      <strong
        className={cn(
          "break-words",
          large ? "text-[24px] tracking-[-0.9px]" : stacked ? "text-lg" : undefined
        )}
      >
        {defaultName ? (
          <>
            softcom <span>pulse</span>
          </>
        ) : (
          appName
        )}
      </strong>
    </div>
  );
}
