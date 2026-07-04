import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWhatsNew, type WhatsNewEntry } from "../hooks/useWhatsNew";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { SparkleIcon } from "./icons/SparkleIcon";

const LAST_SEEN_KEY = "whats-new:last-seen-id";

/** Consecutive-date groups, order preserved (feed is already newest-first). */
export interface WhatsNewGroup {
  date: string;
  entries: WhatsNewEntry[];
}

export function groupByDate(entries: WhatsNewEntry[]): WhatsNewGroup[] {
  const groups: WhatsNewGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.date === entry.date) last.entries.push(entry);
    else groups.push({ date: entry.date, entries: [entry] });
  }
  return groups;
}

/**
 * How many entries are newer than the last-seen marker.
 * - `""` (first visit, marker not yet established) → 0, so the dot never nags a
 *   brand-new visitor (spec Q2, lean "mark all seen").
 * - marker not found (pruned from the feed) → treat every entry as new.
 * - otherwise → the entries ahead of the marker in feed order.
 */
export function unseenCount(entries: WhatsNewEntry[], lastSeenId: string): number {
  if (lastSeenId === "") return 0;
  const index = entries.findIndex((entry) => entry.id === lastSeenId);
  return index === -1 ? entries.length : index;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function WhatsNewPanelInner() {
  const { entries } = useWhatsNew();
  // `""` is the "no marker yet" sentinel; a real value is a stored entry id.
  const [lastSeenId, setLastSeenId] = useLocalStorage<string>(
    LAST_SEEN_KEY,
    "",
    (raw) => raw || null,
  );

  const [open, setOpen] = useState(false);
  // Entries that were unseen at the moment the panel was opened — drives the
  // "New" pills for this viewing. Snapshotted (not live) so the pills stay put
  // while the panel is open even though we immediately persist the marker.
  const [pilledIds, setPilledIds] = useState<ReadonlySet<string>>(() => new Set());

  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const newestId = entries[0]?.id ?? null;
  const unseen = unseenCount(entries, lastSeenId);
  const groups = useMemo(() => groupByDate(entries), [entries]);

  // First visit with content: establish the marker at the newest entry so the
  // dot only ever fires for genuinely new entries (never on the first load).
  useEffect(() => {
    if (lastSeenId === "" && newestId) setLastSeenId(newestId);
  }, [lastSeenId, newestId, setLastSeenId]);

  // Esc closes and restores focus to the toggle.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Outside click closes.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Move focus into the panel on open (it holds no interactive children in P0).
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  function openPanel() {
    // Snapshot the currently-unseen ids for this session's "New" pills, then
    // persist the newest id so the dot — and next open's pills — clear.
    setPilledIds(new Set(entries.slice(0, unseen).map((entry) => entry.id)));
    if (newestId) setLastSeenId(newestId);
    setOpen(true);
  }

  function toggle() {
    if (open) setOpen(false);
    else openPanel();
  }

  return (
    // Not a positioning context: the popover anchors to the header (the nearest
    // positioned ancestor) so it aligns to the header's padding edge and uses
    // the full width to its left — otherwise, anchored to this right-edge icon,
    // a 320px panel overflows the left of a narrow phone screen.
    <div>
      <button
        ref={btnRef}
        type="button"
        aria-label={unseen > 0 ? `What's New, ${unseen} new` : "What's New"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className="relative p-2 -m-2 rounded text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
      >
        <SparkleIcon />
        {unseen > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 block h-2 w-2 rounded-full bg-c-coral-500 dark:bg-c-coral-300 ring-2 ring-paper-100 dark:ring-slate-900"
          />
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="What's New"
          tabIndex={-1}
          className="absolute right-4 sm:right-6 top-full mt-2 z-50 w-80 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto rounded-2xl border border-paper-300 dark:border-slate-800 bg-paper-50 dark:bg-slate-900 shadow-lg outline-none animate-fade-up"
        >
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">What's New</h2>
          </div>

          {groups.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-slate-600 dark:text-slate-400">
              No updates yet — check back soon.
            </p>
          ) : (
            <div className="pb-2">
              {groups.map((group) => (
                <section key={group.date} className="px-4 py-2">
                  <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    {formatDate(group.date)}
                  </h3>
                  <ul className="space-y-1.5">
                    {group.entries.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200"
                      >
                        <span className="flex-1">{entry.note}</span>
                        {pilledIds.has(entry.id) && (
                          <span className="mt-0.5 shrink-0 rounded-full border border-c-coral-300 bg-c-coral-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide text-c-coral-800 dark:border-c-coral-800 dark:bg-c-coral-900/30 dark:text-c-coral-300">
                            New
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Guards the header against any failure in the What's New feature — a broken
 * feed, a render throw — by falling back to an inert sparkle icon. The header
 * must never break because of What's New (spec P0-3, app async rule).
 */
class WhatsNewErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <span className="block p-2 -m-2 text-slate-400 dark:text-slate-600" aria-hidden="true">
          <SparkleIcon />
        </span>
      );
    }
    return this.props.children;
  }
}

/** Sparkle button + date-grouped What's New popover with an unseen dot. */
export function WhatsNewPanel() {
  return (
    <WhatsNewErrorBoundary>
      <WhatsNewPanelInner />
    </WhatsNewErrorBoundary>
  );
}
