'use client';
import { Modal, useOverlayState } from '@heroui/react';
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
  const confirmStyle =
    variant === 'danger'
      ? { background: 'linear-gradient(135deg,#dc2626,#b91c1c)', boxShadow: '0 0 16px rgba(220,38,38,0.35)' }
      : variant === 'warning'
      ? { background: 'linear-gradient(135deg,#d97706,#b45309)', boxShadow: '0 0 16px rgba(217,119,6,0.35)' }
      : { background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35)' };

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
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-2.5 text-sm rounded-xl font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
                style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                disabled={loading}
                className="flex-1 px-4 py-2.5 text-sm rounded-xl font-semibold text-white disabled:opacity-60 flex items-center justify-center gap-2 transition-all hover:opacity-90"
                style={confirmStyle}
              >
                {loading && (
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                {confirmLabel}
              </button>
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
