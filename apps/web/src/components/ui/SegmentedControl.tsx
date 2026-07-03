export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  /** Accessible name for the group (screen readers). */
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}

/**
 * A small two-or-more option toggle styled as a segmented control. The selected
 * option is marked with both a filled background AND a check icon, so the state
 * never relies on color alone.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border border-paper-400 dark:border-slate-700 bg-paper-200 dark:bg-slate-800 p-0.5"
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`flex min-h-11 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0 ${
              selected
                ? "bg-paper-50 dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <svg
              viewBox="0 0 16 16"
              className={`w-3 h-3 transition-opacity ${selected ? "opacity-100" : "opacity-0"}`}
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3.5 8.5l3 3 6-7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
