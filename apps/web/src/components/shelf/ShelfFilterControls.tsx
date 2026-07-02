import { useState } from "react";
import { Button } from "../ui/Button";
import { inputClass } from "../../lib/form-styles";
import type { ShelfEntry, ShelfFilter, SmartShelfWithCount, TagCount } from "../../lib/api-client";

// ── Facet model ──────────────────────────────────────────────────────────────

export type SystemFacet = "owned" | "want" | "reading" | "finished" | "unread";

const FACETS: { value: SystemFacet; label: string }[] = [
  { value: "owned", label: "Owned" },
  { value: "want", label: "Want" },
  { value: "reading", label: "Reading" },
  { value: "finished", label: "Read" },
  { value: "unread", label: "Unread" },
];

export function facetLabel(facet: SystemFacet): string {
  return FACETS.find((f) => f.value === facet)?.label ?? facet;
}

function facetToFilter(facet: SystemFacet): ShelfFilter {
  switch (facet) {
    case "owned":
      return { owned: true };
    case "want":
      return { want: true };
    case "reading":
      return { readingStatus: "reading" };
    case "finished":
      return { readingStatus: "finished" };
    case "unread":
      return { readingStatus: "unread" };
  }
}

/** Combine a system facet + a tag into a single filter (null when neither is set). */
export function buildFilter(facet: SystemFacet | null, tag: string | null): ShelfFilter | null {
  if (!facet && !tag) return null;
  return { ...(facet ? facetToFilter(facet) : {}), ...(tag ? { tag } : {}) };
}

/** Map a saved smart-shelf rule back to the active {facet, tag} UI state. */
export function ruleToActive(rule: ShelfFilter): { facet: SystemFacet | null; tag: string | null } {
  let facet: SystemFacet | null = null;
  if (rule.owned) facet = "owned";
  else if (rule.want) facet = "want";
  else if (rule.readingStatus === "reading") facet = "reading";
  else if (rule.readingStatus === "finished") facet = "finished";
  else if (rule.readingStatus === "unread") facet = "unread";
  return { facet, tag: rule.tag ?? null };
}

/** Narrow an untrusted string (e.g. a URL query param) to a known SystemFacet, or null. */
export function parseFacet(raw: string | null | undefined): SystemFacet | null {
  return raw && FACETS.some((f) => f.value === raw) ? (raw as SystemFacet) : null;
}

/**
 * Reading List membership (ADR-021): a book is on the reading list if it's
 * currently being read, or it's owned and not yet finished (the "read next from
 * what I own" queue). Deliberately excludes wishlist-only books so it never
 * overlaps the Wishlist view.
 */
export function isReadingListEntry(entry: Pick<ShelfEntry, "owned" | "readingStatus">): boolean {
  if (entry.readingStatus === "reading") return true;
  return entry.owned && entry.readingStatus !== "finished";
}

// ── Shared chip styles ───────────────────────────────────────────────────────

const chipBase =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors";
const chipSelected = "bg-slate-900 text-white dark:bg-white dark:text-slate-900";
const chipUnselected =
  "border border-paper-400 text-slate-600 hover:border-paper-500 dark:border-slate-700 dark:text-slate-300";

function XIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

// ── Facet bar ────────────────────────────────────────────────────────────────

export function FacetBar({
  facet,
  onSelect,
}: {
  facet: SystemFacet | null;
  onSelect: (f: SystemFacet | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by status"
      className="flex flex-wrap items-center gap-2 overflow-x-auto"
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={facet === null}
        className={`${chipBase} ${facet === null ? chipSelected : chipUnselected}`}
      >
        All
      </button>
      {FACETS.map((f) => (
        <button
          key={f.value}
          type="button"
          onClick={() => onSelect(facet === f.value ? null : f.value)}
          aria-pressed={facet === f.value}
          className={`${chipBase} ${facet === f.value ? chipSelected : chipUnselected}`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

// ── Tag browse (on-demand; nothing pre-listed beyond top matches) ────────────

export function TagBrowsePanel({
  tags,
  activeTag,
  onPick,
}: {
  tags: TagCount[];
  activeTag: string | null;
  onPick: (tag: string) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const matches = tags.filter((t) => (query ? t.tag.includes(query) : true)).slice(0, 24);

  return (
    <div className="rounded-xl border border-paper-300 dark:border-slate-700 p-4 space-y-3">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter by tag…"
        className={`w-full text-sm ${inputClass}`}
        aria-label="Filter by tag"
      />
      {tags.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Add tags to your books (from a book&apos;s page) to browse by tag.
        </p>
      ) : matches.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">No tags match “{q}”.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {matches.map((t) => (
            <button
              key={t.tag}
              type="button"
              onClick={() => onPick(t.tag)}
              aria-pressed={activeTag === t.tag}
              className={`${chipBase} ${activeTag === t.tag ? chipSelected : chipUnselected}`}
            >
              {t.tag}
              <span
                className={
                  activeTag === t.tag ? "opacity-80" : "text-slate-400 dark:text-slate-500"
                }
              >
                {t.count}
              </span>
            </button>
          ))}
          {tags.length > matches.length && (
            <span className="self-center text-xs text-slate-400 dark:text-slate-500">
              type to find more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Active-filter bar (with save-as-smart-shelf) ─────────────────────────────

export function ActiveFilterBar({
  facet,
  tag,
  count,
  onRemoveFacet,
  onRemoveTag,
  onClear,
  onSave,
  canSave,
}: {
  facet: SystemFacet | null;
  tag: string | null;
  count: number;
  onRemoveFacet: () => void;
  onRemoveTag: () => void;
  onClear: () => void;
  onSave: () => void;
  canSave: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Active filters"
      className="flex flex-wrap items-center gap-2 rounded-xl bg-paper-200 dark:bg-slate-800/50 p-3"
    >
      {facet && (
        <span className={`${chipBase} ${chipSelected}`}>
          {facetLabel(facet)}
          <button
            type="button"
            onClick={onRemoveFacet}
            aria-label={`Remove ${facetLabel(facet)} filter`}
            className="grid h-5 w-5 place-items-center rounded-full hover:bg-white/20"
          >
            <XIcon />
          </button>
        </span>
      )}
      {tag && (
        <span className={`${chipBase} ${chipSelected}`}>
          #{tag}
          <button
            type="button"
            onClick={onRemoveTag}
            aria-label={`Remove tag ${tag} filter`}
            className="grid h-5 w-5 place-items-center rounded-full hover:bg-white/20"
          >
            <XIcon />
          </button>
        </span>
      )}
      <span className="text-xs text-slate-600 dark:text-slate-400">
        → {count} {count === 1 ? "book" : "books"}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {canSave && (
          <Button variant="secondary" size="sm" onClick={onSave}>
            Save as smart shelf
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}

// ── Reading List bar (named composite view; not a saveable rule) ─────────────

export function ReadingListBar({ count, onClear }: { count: number; onClear: () => void }) {
  return (
    <div
      role="group"
      aria-label="Reading list"
      className="flex flex-wrap items-center gap-2 rounded-xl bg-paper-200 dark:bg-slate-800/50 p-3"
    >
      <span className={`${chipBase} ${chipSelected}`}>Reading list</span>
      <span className="text-xs text-slate-600 dark:text-slate-400">
        → {count} {count === 1 ? "book" : "books"}
      </span>
      <div className="ml-auto">
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}

// ── Smart shelves group ──────────────────────────────────────────────────────

function SparkleIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        d="M8 1.5l1.4 3.6L13 6.5l-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7.25v3.25" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Small info affordance with a hover/focus tooltip. */
function InfoTooltip({ label, text }: { label: string; text: string }) {
  return (
    <span className="group/tip relative inline-flex">
      <button
        type="button"
        aria-label={label}
        className="grid h-5 w-5 place-items-center rounded-full text-slate-400 transition-colors hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:hover:text-slate-200 dark:focus:ring-slate-300"
      >
        <InfoIcon />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-60 rounded-lg border border-paper-400 bg-paper-50 p-3 text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-600 shadow-lg group-hover/tip:block group-focus-within/tip:block dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
      >
        {text}
      </span>
    </span>
  );
}

export function SmartShelvesGroup({
  shelves,
  onApply,
  onDelete,
}: {
  shelves: SmartShelfWithCount[];
  onApply: (shelf: SmartShelfWithCount) => void;
  onDelete: (shelf: SmartShelfWithCount) => void;
}) {
  if (shelves.length === 0) return null;
  return (
    <section className="rounded-xl border border-paper-300 dark:border-slate-700 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
        <SparkleIcon />
        <span className="font-semibold uppercase tracking-wide text-xs">Smart shelves</span>
        <InfoTooltip
          label="About smart shelves"
          text="Smart shelves are saved filters — they update automatically as your books change. Create one by applying a status or tag filter, then choosing “Save as smart shelf”. You can keep up to 50."
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {shelves.map((s) => (
          <span key={s.smartShelfId} className={`${chipBase} ${chipUnselected}`}>
            <button
              type="button"
              onClick={() => onApply(s)}
              className="flex items-center gap-1.5"
              aria-label={`Open smart shelf ${s.name} (${s.count} books)`}
            >
              {s.name}
              <span className="text-slate-400 dark:text-slate-500">{s.count}</span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(s)}
              aria-label={`Delete smart shelf ${s.name}`}
              className="grid h-5 w-5 place-items-center rounded-full text-slate-400 hover:bg-paper-300 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"
            >
              <XIcon />
            </button>
          </span>
        ))}
      </div>
    </section>
  );
}
