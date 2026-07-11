/**
 * Edition grouping (BOOKSHELF-68 / BOOKSHELF-90). Relating the editions of one
 * *work* — the hardcover, paperback, audiobook, each a different ISBN — is done
 * with a **derived work key** rather than a stored `WORK#` entity or provider
 * work id. Two entries group when they share `deriveWorkKey(metadata)`, computed
 * at read time from the shared `BOOK#<isbn>` cache. This mirrors ADR-019's
 * derive-don't-store posture: no new item type, no GSI, no migration.
 *
 * The known weakness of a fuzzy key is imperfect precision, so grouping is made
 * **visible and one-click reversible** at the API/UX layer (an override `workKey`
 * attribute on the entry) — never silent. See `docs/specs/edition-grouping.md`.
 */

/** Per-user, per-edition format label. User-supplied (Google Books gives no reliable format). */
export type EditionFormat = "hardcover" | "paperback" | "ebook" | "audiobook";

const EDITION_FORMATS: readonly EditionFormat[] = ["hardcover", "paperback", "ebook", "audiobook"];

export function isValidFormat(v: unknown): v is EditionFormat {
  return typeof v === "string" && (EDITION_FORMATS as readonly string[]).includes(v);
}

/**
 * Max length of the stored `workKey` override (free-text-cap convention, matching
 * NOTES_MAX_LENGTH et al.). Derived keys are far shorter; the cap only bounds the
 * solo/merge sentinels the server writes.
 */
export const WORK_KEY_MAX = 200;

/**
 * The solo sentinel written when a user ungroups an edition: a value that can only
 * ever match itself. A derived key always contains a `|` separator (title|author);
 * this sentinel never does, so it can never collide with a real derived key.
 */
export function soloWorkKey(isbn: string): string {
  return `solo:${isbn}`;
}

/**
 * Normalize a work title for grouping. Deliberately conservative — it errs toward
 * *under*-merging (leaving editions ungrouped) rather than false merges, since the
 * notify-and-ungroup loop is the safety net for what it does merge.
 *
 * - lowercase, trim, collapse internal whitespace;
 * - strip a single leading article (`the ` / `a ` / `an `);
 * - drop a trailing `: subtitle` segment (so `Dune: Book One` ↔ `Dune`; note
 *   `Foundation` vs `Foundation and Empire` keep distinct main titles — no merge).
 */
function normalizeTitle(title: string): string {
  let t = title.trim().toLowerCase().replace(/\s+/g, " ");
  // Drop a trailing subtitle after the first colon (keep the main title only).
  const colon = t.indexOf(":");
  if (colon > 0) t = t.slice(0, colon).trim();
  // Strip a single leading article.
  t = t.replace(/^(the|a|an) /, "");
  return t.trim();
}

/** Normalize an author name: lowercase, strip punctuation, collapse whitespace. */
function normalizeAuthor(author: string): string {
  return author
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The work key an entry groups under, derived from its book metadata. Returns
 * `null` when the title or the primary author is missing/blank — a title-only key
 * over-merges (many unrelated books share a title), so such entries stay solo and
 * are never auto-grouped (see spec + acceptance criteria).
 *
 * Takes a minimal shape (not the full `BookMetadata`) so this module has no
 * dependency on the DynamoDB layer.
 */
export function deriveWorkKey(
  meta: {
    title?: string | null;
    authors?: string[] | null;
  } | null,
): string | null {
  if (!meta) return null;
  const title = normalizeTitle(meta.title ?? "");
  const primaryAuthor = normalizeAuthor(meta.authors?.[0] ?? "");
  if (title.length === 0 || primaryAuthor.length === 0) return null;
  return `${title}|${primaryAuthor}`;
}
