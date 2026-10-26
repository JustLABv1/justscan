'use client';
import { Button, Modal, useOverlayState } from '@/components/ui';
import { AlertCircleIcon } from 'hugeicons-react';
import { useId, useRef, useState } from 'react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
}

interface ConfirmDialogUIProps extends ConfirmOptions {
  state: ReturnType<typeof useOverlayState>;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

function ConfirmDialogUI({
  state,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
  loading,
}: ConfirmDialogUIProps) {
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const iconTone =
    variant === 'danger'
      ? 'bg-destructive/10 text-destructive'
      : variant === 'warning'
        ? 'bg-warning/10 text-warning-foreground'
        : 'bg-muted text-muted-foreground';

  return (
    <Modal state={state}>
      <Modal.Backdrop isDismissable={false}>
        <Modal.Container size="sm" className="sm:max-w-md" placement="center">
          <Modal.Dialog
            role="alertdialog"
            aria-describedby={descriptionId}
            className="overflow-hidden"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancelRef.current?.focus();
            }}
            onEscapeKeyDown={() => {
              if (!loading) onCancel();
            }}
          >
            <Modal.Body className="p-6">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${iconTone}`}
                >
                  <AlertCircleIcon size={18} />
                </span>
                <div className="min-w-0 space-y-2">
                  <Modal.Heading className="text-base font-semibold leading-6">
                    {title}
                  </Modal.Heading>
                  <p id={descriptionId} className="text-sm leading-6 text-muted-foreground">
                    {message}
                  </p>
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer className="flex flex-row justify-end gap-2 border-t bg-muted/20 px-6 py-4">
              <Button ref={cancelRef} onPress={onCancel} variant="outline" isDisabled={loading}>
                {cancelLabel}
              </Button>
              <Button
                isDisabled={loading}
                isPending={loading}
                onPress={onConfirm}
                variant={variant === 'danger' ? 'destructive' : 'primary'}
                className={
                  variant === 'danger'
                    ? 'bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90'
                    : undefined
                }
              >
                {confirmLabel}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/**
 * Hook that provides a `confirm()` function returning a Promise<boolean>,
 * and a `dialog` JSX element to render in your component tree.
 *
 * Usage:
 *   const { confirm, dialog } = useConfirmDialog();
 *   // ...
 *   const ok = await confirm({ title: '…', message: '…', variant: 'danger' });
 *   if (!ok) return;
 *   // perform action
 *   // ...
 *   return <>{content}{dialog}</>;
 */
export function useConfirmDialog() {
  const state = useOverlayState();
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [confirming, setConfirming] = useState(false);

  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setOpts(options);
      setConfirming(false);
      state.open();
    });
  }

  function handleConfirm() {
    resolveRef.current?.(true);
    resolveRef.current = null;
    state.close();
    setConfirming(false);
  }

  function handleCancel() {
    resolveRef.current?.(false);
    resolveRef.current = null;
    state.close();
    setConfirming(false);
  }

  const dialog = opts ? (
    <ConfirmDialogUI
      state={state}
      title={opts.title}
      message={opts.message}
      confirmLabel={opts.confirmLabel}
      cancelLabel={opts.cancelLabel}
      variant={opts.variant}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      loading={confirming}
    />
  ) : null;

  return { confirm, dialog };
}
