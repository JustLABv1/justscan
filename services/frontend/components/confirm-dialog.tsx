'use client';
import { Button, Modal, useOverlayState } from '@heroui/react';
import { AlertCircleIcon } from 'hugeicons-react';
import { useRef, useState } from 'react';

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
  const iconColor = variant === 'danger' ? '#f87171' : variant === 'warning' ? '#fbbf24' : '#a78bfa';
  const iconBg =
    variant === 'danger'
      ? 'rgba(239,68,68,0.12)'
      : variant === 'warning'
      ? 'rgba(245,158,11,0.12)'
      : 'rgba(124,58,237,0.12)';
  const iconBorder =
    variant === 'danger'
      ? 'rgba(239,68,68,0.25)'
      : variant === 'warning'
      ? 'rgba(245,158,11,0.25)'
      : 'rgba(124,58,237,0.25)';
  const confirmClassName = variant === 'danger' ? 'btn-danger' : variant === 'warning' ? 'btn-warning' : 'btn-primary';

  return (
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container size="sm" placement="center">
          <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
            <Modal.Body className="px-6 pt-6 pb-2">
              <div className="flex flex-col items-center text-center gap-4">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ background: iconBg, border: `1px solid ${iconBorder}` }}
                >
                  <AlertCircleIcon size={22} color={iconColor} />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h3>
                  <p className="text-sm text-zinc-500 leading-relaxed">{message}</p>
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer className="px-6 py-5 flex gap-3 justify-center" style={{ borderTop: 'none' }}>
              <Button className="btn-secondary flex-1" onPress={onCancel}>
                {cancelLabel}
              </Button>
              <Button className={`${confirmClassName} flex-1`} isDisabled={loading} onPress={onConfirm}>
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
