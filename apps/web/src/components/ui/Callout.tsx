import type { ReactNode } from "react";

interface CalloutProps {
  /** Optional bold heading line. */
  title?: string;
  /** Body content. */
  children: ReactNode;
  /** Optional leading icon (rendered in muted slate; pass `aria-hidden`). */
  icon?: ReactNode;
  /** Optional actions row (use `<Button>`); rendered under the body. */
  actions?: ReactNode;
  /** When provided, renders a dismiss button that calls this on activation. */
  onDismiss?: () => void;
  /** Accessible label for the dismiss button. */
  dismissLabel?: string;
  className?: string;
}

/**
 * Informational container for low-urgency, supporting messages — tips and
 * "you can also do X over there" pointers. See `docs/design-system.md`.
 *
 * NOT for form validation feedback — those stay inline with the red/green
 * semantic tokens. Ambient, never modal or blocking.
 */
export function Callout({
  title,
  children,
  icon,
  actions,
  onDismiss,
  dismissLabel = "Dismiss",
  className = "",
}: CalloutProps) {
  return (
    <div
      role="note"
      className={`relative rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/50 ${className}`}
    >
      <div className={`flex gap-4 ${onDismiss ? "pr-8" : ""}`}>
        {icon && <div className="shrink-0 text-slate-500 dark:text-slate-400">{icon}</div>}
        <div className="min-w-0 flex-1">
          {title && (
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
          )}
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{children}</div>
          {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
