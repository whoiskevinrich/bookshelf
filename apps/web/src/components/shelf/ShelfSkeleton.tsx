function SkeletonCard() {
  return (
    <div className="flex gap-3">
      <div className="w-12 h-[72px] flex-shrink-0 rounded shimmer" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-3 shimmer rounded w-3/4" />
        <div className="h-3 shimmer rounded w-1/2" />
      </div>
    </div>
  );
}

function SkeletonSection() {
  return (
    <section>
      <div className="h-3 shimmer rounded w-24 mb-4" />
      <div className="grid sm:grid-cols-2 gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </section>
  );
}

interface ShelfSkeletonProps {
  sections?: number;
}

export function ShelfSkeleton({ sections = 2 }: ShelfSkeletonProps) {
  return (
    <div className="space-y-10" role="status" aria-label="Loading books">
      {Array.from({ length: sections }, (_, i) => (
        <SkeletonSection key={i} />
      ))}
    </div>
  );
}
