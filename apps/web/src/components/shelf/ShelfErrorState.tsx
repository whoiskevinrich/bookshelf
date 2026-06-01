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
      <p className="text-gray-500 mb-1">{message}</p>
      <p className="text-sm text-gray-400 mb-6">Check your connection or try again.</p>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
      >
        {isRetrying ? "Retrying…" : "Try again"}
      </button>
    </div>
  );
}
