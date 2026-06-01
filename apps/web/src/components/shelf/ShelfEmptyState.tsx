interface ShelfEmptyStateProps {
  onAdd: () => void;
}

export function ShelfEmptyState({ onAdd }: ShelfEmptyStateProps) {
  return (
    <div className="text-center py-20">
      <p className="text-4xl mb-6">📚</p>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">
        Your shelf is empty — let&apos;s fix that.
      </h2>
      <p className="text-sm text-gray-500 mb-8">
        Add the books you own, and the ones you&apos;re dreaming of reading next.
      </p>
      <button
        onClick={onAdd}
        className="text-sm bg-gray-900 text-white px-5 py-2.5 rounded-lg hover:bg-gray-700 transition-colors"
      >
        Add your first book →
      </button>
    </div>
  );
}
