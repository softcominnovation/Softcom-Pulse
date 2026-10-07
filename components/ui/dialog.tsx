"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, hideClose = false, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--pulse-backdrop)] backdrop-blur-[4px]" />
      <DialogPrimitive.Content className={cn("fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100%-32px)] w-[540px] max-w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-dialog border border-[var(--pulse-dialog-border)] bg-popover text-popover-foreground shadow-[0_25px_100px_#0008]", className)} {...props}>
        {children}
        {!hideClose && <DialogPrimitive.Close asChild><Button variant="default" size="icon" aria-label="Fechar diálogo" className="absolute top-4 right-4"><X aria-hidden="true" /></Button></DialogPrimitive.Close>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("shrink-0 border-b px-6 py-[22px] pr-16", className)} {...props} />;
}

export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-h-0 overflow-y-auto px-6 py-[22px] text-[13px] leading-[1.7]", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 flex-col-reverse gap-3 border-t px-6 py-4 sm:flex-row sm:justify-end", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("break-words text-xl leading-tight font-semibold", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-muted-foreground", className)} {...props} />;
}
