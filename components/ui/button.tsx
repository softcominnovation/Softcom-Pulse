import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-control border px-[13px] py-2 text-xs font-[550] transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[19px] [&_svg]:shrink-0 [&_svg]:stroke-[1.7]",
  {
    variants: {
      variant: {
        default: "border-border bg-secondary text-secondary-foreground hover:border-[var(--pulse-hover-border)] hover:bg-accent",
        primary: "border-primary bg-primary text-primary-foreground hover:brightness-95",
        destructive: "border-destructive bg-[var(--pulse-bad-bg)] text-destructive hover:brightness-110",
        ghost: "border-primary bg-transparent text-primary hover:bg-[var(--pulse-active)]",
      },
      size: { default: "", icon: "size-9 shrink-0 p-2" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({ className, variant, size, asChild = false, type, ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp type={asChild ? type : type ?? "button"} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
