import { useQuery } from "@tanstack/react-query";

/**
 * The in-app "What's New" feed (BOOKSHELF-75). Consumes the static asset at
 * `/whats-new.json`, generated at build time from `Release-Note:` commit
 * trailers (BOOKSHELF-74, `scripts/gen-whats-new.mjs`).
 *
 * This is a public static asset, NOT an authed API route, so it's fetched
 * directly — not through `lib/api-client.ts`. A missing/404/broken file is
 * treated as an empty feed and must never break the header (spec P0-3).
 */
export interface WhatsNewEntry {
  /** Short commit SHA — stable + unique; the seen-tracking key. */
  id: string;
  /** `YYYY-MM-DD` — the date-grouping key. */
  date: string;
  /** The one human sentence shown in the feed. */
  note: string;
}

export interface WhatsNewFeed {
  /** `YYYY-MM-DD` of the newest entry, or null when the feed is empty. */
  generatedAt: string | null;
  /** Newest-first. */
  entries: WhatsNewEntry[];
}

const EMPTY_FEED: WhatsNewFeed = { generatedAt: null, entries: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Defensively narrow untrusted JSON to the feed shape, dropping bad entries. */
function normalizeFeed(data: unknown): WhatsNewFeed {
  if (!isRecord(data) || !Array.isArray(data.entries)) return EMPTY_FEED;

  const entries: WhatsNewEntry[] = data.entries.filter(
    (entry): entry is WhatsNewEntry =>
      isRecord(entry) &&
      typeof entry.id === "string" &&
      typeof entry.date === "string" &&
      typeof entry.note === "string" &&
      entry.note.length > 0,
  );

  const generatedAt = typeof data.generatedAt === "string" ? data.generatedAt : null;
  return { generatedAt, entries };
}

async function fetchWhatsNew(): Promise<WhatsNewFeed> {
  try {
    const res = await fetch("/whats-new.json", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return EMPTY_FEED;
    return normalizeFeed((await res.json()) as unknown);
  } catch {
    // Network error, missing global fetch (tests), or malformed JSON — the feed
    // is best-effort. Degrade to empty rather than surfacing an error.
    return EMPTY_FEED;
  }
}

/**
 * Reads the What's New feed. Never rejects — a failed fetch resolves to an
 * empty feed. The asset is generated at build time, so it's stable for the
 * session (`staleTime: Infinity` — no refetching).
 */
export function useWhatsNew(): WhatsNewFeed {
  const { data } = useQuery({
    queryKey: ["whats-new"],
    queryFn: fetchWhatsNew,
    staleTime: Infinity,
  });
  return data ?? EMPTY_FEED;
}
