interface ShelfErrorStateProps {
  message?: string;
  onRetry: () => void;
  isRetrying?: boolean;
}

export function ShelfErrorState({
  message = "Couldn't load your shelf.",
  onRetry,
  isRetrying,
}: ShelfErrorStateProps) {
  return (
    <div className="text-center py-16">
      <p className="text-slate-500 dark:text-slate-400 mb-1">{message}</p>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Check your connection or try again.
      </p>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        className="text-sm bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 disabled:opacity-40 transition-colors"
      >
        {isRetrying ? "Retrying…" : "Try again"}
      </button>
    </div>
  );
}
