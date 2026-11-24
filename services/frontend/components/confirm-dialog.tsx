'use client';

import { AlertDialog } from '@/components/ui/alert-dialog';
import { AlertCircleIcon } from 'hugeicons-react';
import { useEffect, useRef, useState } from 'react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
}

/** A destructive question whose Cancel answer receives initial focus. */
function ConfirmDialogUI({
  options,
  open,
  onAnswer,
}: {
  options: ConfirmOptions;
  open: boolean;
  onAnswer: (confirmed: boolean) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const tone =
    options.variant === 'danger' || options.variant === undefined
      ? 'destructive'
      : options.variant === 'warning'
        ? 'warning'
        : 'neutral';

  return (
    <AlertDialog
      open={open}
      dismissible={false}
      onOpenChange={(next) => {
        if (!next) onAnswer(false);
      }}
    >
      <AlertDialog.Content tone={tone} initialFocus={cancelRef}>
        <AlertDialog.Media>
          <AlertCircleIcon size={24} />
        </AlertDialog.Media>
        <AlertDialog.Title>{options.title}</AlertDialog.Title>
        <AlertDialog.Description>{options.message}</AlertDialog.Description>
        <AlertDialog.Footer>
          <AlertDialog.Cancel ref={cancelRef}>{options.cancelLabel ?? 'Cancel'}</AlertDialog.Cancel>
          <AlertDialog.Action onClick={() => onAnswer(true)}>
            {options.confirmLabel ?? 'Confirm'}
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog>
  );
}

/**
 * `confirm()` resolves true only for the explicit confirming answer. Escape,
 * Cancel, replacement by another question and unmounting resolve false.
 * Render `dialog` beside the page, then await `confirm({ title, message })`.
 */
export function useConfirmDialog() {
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(
    () => () => {
      resolveRef.current?.(false);
      resolveRef.current = null;
    },
    []
  );

  function confirm(next: ConfirmOptions): Promise<boolean> {
    // Never strand an earlier caller if two actions ask a question together.
    resolveRef.current?.(false);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setOptions(next);
      setOpen(true);
    });
  }

  function answer(confirmed: boolean) {
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
    setOpen(false);
  }

  return {
    confirm,
    dialog: options ? <ConfirmDialogUI options={options} open={open} onAnswer={answer} /> : null,
  };
}
