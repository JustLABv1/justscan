'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { OverlayPortalContext } from './overlay-portal';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;
export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className
      )}
      {...props}
    />
  );
}
export function DialogContent({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const contentRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      setContainer(node);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref]
  );
  return (
    <OverlayPortalContext.Provider value={container}>
      <DialogPrimitive.Content
        ref={contentRef}
        data-slot="dialog-content"
        aria-describedby={undefined}
        className={cn(
          'relative z-50 flex max-h-[90dvh] w-full flex-col rounded-xl border border-border bg-background text-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className
        )}
        {...props}
      />
    </OverlayPortalContext.Provider>
  );
}
export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg font-semibold leading-none', className)}
      {...props}
    />
  );
}
export const DialogDescription = DialogPrimitive.Description;
