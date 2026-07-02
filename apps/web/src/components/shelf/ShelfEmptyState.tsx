import { Button } from "../ui/Button";

interface ShelfEmptyStateProps {
  onAdd: () => void;
  heading?: string;
  body?: string;
  cta?: string;
}

export function ShelfEmptyState({
  onAdd,
  heading = "Your shelf is empty — let’s fix that.",
  body = "Add the books you own, and the ones you’re dreaming of reading next.",
  cta = "Add your first book →",
}: ShelfEmptyStateProps) {
  return (
    <div className="text-center py-20">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mx-auto text-slate-300 dark:text-slate-600 mb-6"
        aria-hidden="true"
      >
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">{heading}</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-8">{body}</p>
      <Button variant="app" onClick={onAdd}>
        {cta}
      </Button>
    </div>
  );
}
