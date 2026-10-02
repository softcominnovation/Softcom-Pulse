import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return <input type={type} className={cn("flex min-h-9 w-full min-w-0 rounded-control border border-input bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground hover:border-[var(--pulse-hover-border)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive", className)} {...props} />;
}
