"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { IconX } from "@tabler/icons-react";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  render,
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger> & { render?: React.ReactElement }) {
  if (render) {
    return (
      <DialogPrimitive.Trigger data-slot="dialog-trigger" asChild {...props}>
        {React.cloneElement(render, {}, children)}
      </DialogPrimitive.Trigger>
    );
  }
  return (
    <DialogPrimitive.Trigger data-slot="dialog-trigger" asChild={asChild} {...props}>
      {children}
    </DialogPrimitive.Trigger>
  );
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  render,
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close> & { render?: React.ReactElement }) {
  if (render) {
    return (
      <DialogPrimitive.Close data-slot="dialog-close" asChild {...props}>
        {React.cloneElement(render, {}, children)}
      </DialogPrimitive.Close>
    );
  }
  return (
    <DialogPrimitive.Close data-slot="dialog-close" asChild={asChild} {...props}>
      {children}
    </DialogPrimitive.Close>
  );
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/55 backdrop-blur-md",
        className,
      )}
      {...props}
    />
  );
}

const dialogContentVariants = cva(
  "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100%-2rem)] w-[540px] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl border border-border bg-popover text-sm text-popover-foreground shadow-[0_28px_72px_-20px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.06)] outline-none [&:not(:has([data-slot=dialog-body]))]:gap-4 [&:not(:has([data-slot=dialog-body]))]:px-7 [&:not(:has([data-slot=dialog-body]))]:pt-7 [&:not(:has([data-slot=dialog-body]))]:pb-5",
  {
    variants: {
      size: {
        default: "",
        sm: "sm:max-w-lg",
        md: "sm:max-w-2xl",
        lg: "sm:max-w-3xl",
        xl: "sm:max-w-4xl",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

function DialogContent({
  className,
  children,
  hideClose = false,
  showCloseButton = true,
  size,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  hideClose?: boolean;
  showCloseButton?: boolean;
} & VariantProps<typeof dialogContentVariants>) {
  const showClose = !hideClose && showCloseButton;
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(dialogContentVariants({ size }), className)}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            aria-label="Fechar diálogo"
            className="absolute end-4 top-4 inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-foreground/5 text-muted-foreground transition-[background-color,color,scale,box-shadow] duration-150 ease-out hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <IconX className="size-4" aria-hidden="true" />
            <span className="sr-only">Fechar</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex shrink-0 flex-col gap-1 border-b border-border/70 px-6 py-5 pr-14 [div[data-slot=dialog-content]:not(:has([data-slot=dialog-body]))_&]:border-b-0 [div[data-slot=dialog-content]:not(:has([data-slot=dialog-body]))_&]:px-0 [div[data-slot=dialog-content]:not(:has([data-slot=dialog-body]))_&]:py-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("min-h-0 overflow-y-auto px-6 py-5 text-[13px] leading-[1.7]", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2.5 border-t border-border/70 px-6 py-4 sm:flex-row sm:justify-end [div[data-slot=dialog-content]:not(:has([data-slot=dialog-body]))_&]:mt-2 [div[data-slot=dialog-content]:not(:has([data-slot=dialog-body]))_&]:border-t-0 [div[data-slot=dialog-content]:not(:has([data-slot=dialog-body]))_&]:px-0 [div[data-slot=dialog-content]:not(:has([data-slot=dialog-body]))_&]:py-0",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg bg-foreground/5 px-3 text-sm text-foreground hover:bg-foreground/10">
          Fechar
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("break-words text-lg leading-tight font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      role="alertdialog"
      data-slot="alert-dialog-content"
      className={cn(className)}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: React.ComponentProps<typeof DialogClose> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <DialogClose
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  );
}

function AlertDialogAction({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button data-slot="alert-dialog-action" className={cn(className)} {...props} />;
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  Dialog as AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  DialogDescription as AlertDialogDescription,
  DialogFooter as AlertDialogFooter,
  DialogHeader as AlertDialogHeader,
  DialogOverlay as AlertDialogOverlay,
  DialogPortal as AlertDialogPortal,
  DialogTitle as AlertDialogTitle,
  DialogTrigger as AlertDialogTrigger,
};
