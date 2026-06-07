import { Button } from "../ui/Button";

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
      <Button variant="app" onClick={onRetry} disabled={isRetrying}>
        {isRetrying ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}
