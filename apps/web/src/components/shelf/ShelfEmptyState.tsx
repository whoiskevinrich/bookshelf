interface ShelfEmptyStateProps {
  onAdd: () => void;
}

export function ShelfEmptyState({ onAdd }: ShelfEmptyStateProps) {
  return (
    <div className="text-center py-20">
      <p className="text-4xl mb-6">📚</p>
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
        Your shelf is empty — let&apos;s fix that.
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
        Add the books you own, and the ones you&apos;re dreaming of reading next.
      </p>
      <button
        onClick={onAdd}
        className="text-sm bg-slate-900 text-white px-5 py-2.5 rounded-lg hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 transition-colors"
      >
        Add your first book →
      </button>
    </div>
  );
}
