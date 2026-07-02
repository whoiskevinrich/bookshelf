import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body copy explaining the consequence of confirming. */
  message: string;
  confirmLabel?: string;
  /** When true the confirm button uses the destructive (red) styling. */
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Generic in-app confirmation modal (portal). Use instead of `window.confirm`. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  destructive = false,
  pending = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-body"
        className="w-full max-w-sm rounded-xl bg-paper-50 p-6 shadow-xl dark:bg-slate-800"
      >
        <h2
          id="confirm-dialog-title"
          className="mb-3 truncate text-base font-semibold text-slate-900 dark:text-white"
        >
          {title}
        </h2>
        <p id="confirm-dialog-body" className="mb-4 text-sm text-slate-600 dark:text-zinc-400">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <Button autoFocus variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "danger" : "app"}
            size="sm"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
