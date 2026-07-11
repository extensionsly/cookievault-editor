import { useEffect, useRef, type ReactNode } from 'react';

export interface ConfirmDialogProps {
  /** When true the modal is shown. */
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible, brandable replacement for the native blocking `confirm()`.
 *
 * Uses a real `<dialog>` so it gets the platform focus trap, Escape-to-close,
 * and focus restoration for free; we move focus to the confirm button on open.
 *
 * Styling is intentionally NOT bundled here — the host app supplies the
 * `.confirm-dialog` rules so each extension keeps its own accent colour
 * (editor blue / guardian green) while sharing one component + a11y contract.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      confirmRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog ref={dialogRef} className="confirm-dialog" onClose={onCancel}>
      <h2>{title}</h2>
      <p>{message}</p>
      <footer>
        <button type="button" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          ref={confirmRef}
          className={danger ? 'danger' : 'primary'}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </footer>
    </dialog>
  );
}
