export interface ToastData {
  kind: 'info' | 'success' | 'error';
  message: string;
}

interface Props {
  /** Null hides the toast. */
  toast: ToastData | null;
  onDismiss: () => void;
  /** Tooltip / a11y title for the dismiss affordance. */
  dismissTitle?: string;
}

/**
 * Click-to-dismiss toast. Styling comes from `@cookievault/ui/toast.css`
 * (themed via the host app's --accent / --success / --danger). `error`
 * toasts get role=alert, others role=status.
 */
export function Toast({ toast, onDismiss, dismissTitle }: Props) {
  if (!toast) return null;
  return (
    <div
      className={`toast ${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onClick={onDismiss}
      title={dismissTitle}
    >
      {toast.message}
    </div>
  );
}
