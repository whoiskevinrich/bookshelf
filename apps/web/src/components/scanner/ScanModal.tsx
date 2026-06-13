import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isValidIsbn } from "../../lib/isbn";
import { getBookByIsbn, type BookSearchResult, type ShelfStatus } from "../../lib/api-client";
import { useAddToShelf, useRemoveFromShelf } from "../../hooks/useShelf";
import { useBarcodeScanner } from "../../hooks/useBarcodeScanner";
import { useScannerPreferences } from "../../context/ScannerPreferencesContext";
import { BookCover } from "../BookCover";
import { Button } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import { inputClass, labelClass } from "../../lib/form-styles";

type View = "scanning" | "manual" | "looking-up" | "confirm" | "not-found" | "added";

interface AddedItem {
  isbn: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  status: ShelfStatus;
}

// Elements the focus trap can land on.
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
// How long the continuous-scan success pill stays up.
const FLASH_MS = 2600;

/** Strip separators so a scanned or typed ISBN is bare digits (+ trailing X). */
function normalizeIsbn(raw: string): string {
  return raw.replace(/[-\s]/g, "");
}

function buildAddedItem(
  isbn: string,
  status: ShelfStatus,
  book: BookSearchResult | null,
): AddedItem {
  return {
    isbn,
    status,
    title: book?.title ?? `ISBN ${isbn}`,
    authors: book?.authors ?? [],
    coverUrl: book?.coverUrl ?? null,
  };
}

export function ScanModal({ onClose }: { onClose: () => void }) {
  const { postScanBehavior, scanMode, setPostScanBehavior, setScanMode } = useScannerPreferences();
  const addMutation = useAddToShelf();
  const removeMutation = useRemoveFromShelf();

  const [view, setView] = useState<View>("scanning");
  const [pendingIsbn, setPendingIsbn] = useState<string | null>(null);
  const [foundBook, setFoundBook] = useState<BookSearchResult | null>(null);
  const [added, setAdded] = useState<AddedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Transient success banner shown after each continuous-scan add.
  const [flash, setFlash] = useState<{ item: AddedItem; key: number } | null>(null);
  const addedIsbns = useRef<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashKey = useRef(0);
  // Bumped whenever we abandon the current decode (cancel / resume / add) so a
  // late lookup result can't overwrite the view the user has moved on to.
  const runId = useRef(0);
  // True while a decoded barcode is being handled — drops re-entrant decodes
  // from the 250ms loop before the `active` gate has re-rendered to false.
  const processing = useRef(false);

  function resumeScanning() {
    runId.current += 1; // invalidate any in-flight lookup so it can't reopen a sheet
    setFoundBook(null);
    setPendingIsbn(null);
    setError(null);
    setView("scanning");
  }

  function recordAdded(item: AddedItem) {
    addedIsbns.current.add(item.isbn);
    setAdded((prev) => [item, ...prev]);
  }

  function flashSuccess(item: AddedItem) {
    flashKey.current += 1;
    setFlash({ item, key: flashKey.current });
    if (typeof navigator.vibrate === "function") navigator.vibrate(40);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }

  async function beginLookup(isbn: string) {
    const id = runId.current;
    setPendingIsbn(isbn);
    setError(null);
    setView("looking-up");
    try {
      const book = await getBookByIsbn(isbn);
      if (id !== runId.current) return; // cancelled or superseded while awaiting
      setFoundBook(book);
      setView(book ? "confirm" : "not-found");
    } catch (err) {
      if (import.meta.env.DEV) console.error(`[ScanModal] ISBN lookup failed for ${isbn}`, err);
      if (id !== runId.current) return;
      setFoundBook(null);
      setError("Lookup failed — you can add it by hand.");
      setView("not-found");
    }
  }

  async function commitAdd(isbn: string, status: ShelfStatus, book: BookSearchResult | null) {
    setBusy(true);
    setError(null);
    try {
      await addMutation.mutateAsync({ isbn, status, ...(book ? { book } : {}) });
      const item = buildAddedItem(isbn, status, book);
      recordAdded(item);
      if (scanMode === "single") {
        setView("added");
        if (typeof navigator.vibrate === "function") navigator.vibrate(40);
      } else {
        flashSuccess(item);
        resumeScanning();
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error(`[ScanModal] add to shelf failed for ${isbn}`, err);
      setError("Couldn't add that book — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function autoAdd(isbn: string) {
    setPendingIsbn(isbn);
    let book: BookSearchResult | null = null;
    try {
      book = await getBookByIsbn(isbn);
    } catch (err) {
      // Add with a bare ISBN if the metadata lookup fails — but log it so a
      // systemic lookup outage isn't masked as a shelf full of unknown books.
      if (import.meta.env.DEV)
        console.error(`[ScanModal] metadata lookup failed for ${isbn}; adding bare ISBN`, err);
      book = null;
    }
    await commitAdd(isbn, "owned", book);
  }

  // Called by the decode loop for every recognized barcode.
  function handleDecode(raw: string) {
    if (processing.current) return; // a decode is already being handled
    const isbn = normalizeIsbn(raw);
    if (!isValidIsbn(isbn)) return; // ignore misreads
    if (scanMode === "continuous" && addedIsbns.current.has(isbn)) return; // already added
    processing.current = true;
    const job = postScanBehavior === "autoAddOwned" ? autoAdd(isbn) : beginLookup(isbn);
    void job.finally(() => {
      processing.current = false;
    });
  }

  function manualLookup(value: string) {
    const isbn = normalizeIsbn(value);
    if (!isValidIsbn(isbn)) {
      setError("Enter a valid 10- or 13-digit ISBN.");
      return;
    }
    void beginLookup(isbn);
  }

  function undo(isbn: string) {
    const snapshot = added.find((a) => a.isbn === isbn);
    addedIsbns.current.delete(isbn);
    setAdded((prev) => prev.filter((a) => a.isbn !== isbn));
    setFlash((f) => (f?.item.isbn === isbn ? null : f));
    if (view === "added") resumeScanning();
    // Confirm the removal actually lands; if it fails, restore the row so the
    // modal's state doesn't silently diverge from the server's shelf.
    void (async () => {
      try {
        await removeMutation.mutateAsync(isbn);
      } catch (err) {
        if (import.meta.env.DEV) console.error(`[ScanModal] undo (remove) failed for ${isbn}`, err);
        if (snapshot) {
          addedIsbns.current.add(isbn);
          setAdded((prev) => (prev.some((a) => a.isbn === isbn) ? prev : [snapshot, ...prev]));
        }
      }
    })();
  }

  const { videoRef, status, retry } = useBarcodeScanner({
    onDecode: handleDecode,
    active: view === "scanning" && !busy,
  });

  // Scroll lock + Escape-to-close + Tab focus trap for the modal's lifetime.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus({ preventScroll: true });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [onClose]);

  // Move focus to each new view's primary control as the flow advances.
  useEffect(() => {
    const el = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    el?.focus({ preventScroll: true });
  }, [view, status]);

  const cameraUnavailable = status === "denied" || status === "no-camera" || status === "error";
  const showFooter = status === "scanning" && view === "scanning";

  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="dark fixed inset-0 z-50 flex flex-col bg-slate-950 text-white outline-none"
      role="dialog"
      aria-modal="true"
      aria-label="Scan a book"
    >
      <header className="flex items-center justify-between px-4 py-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scanner"
          className="-ml-2 flex h-11 w-11 items-center justify-center text-slate-300 hover:text-white transition-colors"
        >
          <XIcon />
        </button>
        <span className="text-sm font-medium">Scan a book</span>
        <span className="w-11" aria-hidden="true" />
      </header>

      <div className="relative flex-1 overflow-hidden">
        {(status === "starting" || status === "scanning") && (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}

        {status === "starting" && (
          <CenteredOverlay>
            <Spinner label="Starting camera…" />
          </CenteredOverlay>
        )}

        {status === "scanning" && view === "scanning" && <Reticle />}

        {/* Loud per-scan feedback for the continuous "sweep a shelf" flow. */}
        {flash && view === "scanning" && (
          <>
            <div
              key={flash.key}
              aria-hidden="true"
              className="animate-success-flash pointer-events-none absolute inset-0 ring-4 ring-inset ring-emerald-400/70"
            />
            <div className="absolute inset-x-0 top-4 flex justify-center px-4">
              <div className="animate-fade-up flex max-w-full items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-300">
                <CheckIcon />
                <span className="truncate">Added “{flash.item.title}”</span>
                <button
                  type="button"
                  onClick={() => undo(flash.item.isbn)}
                  className="ml-1 underline underline-offset-2 hover:no-underline"
                >
                  Undo
                </button>
              </div>
            </div>
          </>
        )}

        {view === "looking-up" && (
          <CenteredOverlay>
            <div className="flex flex-col items-center gap-5">
              <Spinner label="Looking up…" />
              <button
                type="button"
                onClick={resumeScanning}
                className="flex min-h-11 items-center px-4 text-sm text-slate-300 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </CenteredOverlay>
        )}

        {cameraUnavailable && (
          <ManualPanel
            heading="Camera unavailable"
            subheading={
              status === "denied"
                ? "Allow camera access in your browser, or enter the ISBN printed below the barcode."
                : "No camera available. Enter the 13-digit ISBN printed below the barcode."
            }
            error={error}
            busy={busy}
            onLookup={manualLookup}
            {...(status === "denied" ? { onRetry: retry } : {})}
          />
        )}

        {view === "manual" && (
          <ManualPanel
            heading="Enter ISBN"
            subheading="Type the ISBN printed just below the barcode."
            error={error}
            busy={busy}
            onLookup={manualLookup}
            onBackToCamera={resumeScanning}
          />
        )}

        {view === "confirm" && foundBook && pendingIsbn && (
          <ConfirmSheet
            book={foundBook}
            isbn={pendingIsbn}
            busy={busy}
            error={error}
            onAdd={(s) => void commitAdd(pendingIsbn, s, foundBook)}
            onScanAgain={resumeScanning}
          />
        )}

        {view === "not-found" && pendingIsbn && (
          <ManualPanel
            heading="Couldn't find that book"
            subheading="Double-check the ISBN, or add it without details."
            initialIsbn={pendingIsbn}
            error={error}
            busy={busy}
            onLookup={manualLookup}
            onAddAnyway={(s) => void commitAdd(pendingIsbn, s, null)}
            {...(status === "scanning" ? { onBackToCamera: resumeScanning } : {})}
          />
        )}

        {view === "added" && added[0] && (
          <AddedSheet
            item={added[0]}
            busy={removeMutation.isPending}
            onUndo={undo}
            onScanAnother={resumeScanning}
            onDone={onClose}
          />
        )}

        <div role="status" aria-live="polite" className="sr-only">
          {view === "confirm" && foundBook ? `Found ${foundBook.title}` : ""}
          {view === "not-found" ? "No matching book found" : ""}
          {view === "added" && added[0] ? `Added ${added[0].title}` : ""}
          {flash ? `Added ${flash.item.title}` : ""}
        </div>
      </div>

      {showFooter && (
        <footer className="space-y-3 border-t border-white/10 bg-slate-950/90 px-4 py-3">
          {scanMode === "continuous" && added.length > 0 && (
            <ContinuousList added={added} onUndo={undo} />
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <SegmentedControl
              label="After scanning"
              value={postScanBehavior}
              onChange={setPostScanBehavior}
              options={[
                { value: "confirm", label: "Confirm" },
                { value: "autoAddOwned", label: "Auto-add" },
              ]}
            />
            <SegmentedControl
              label="Scan mode"
              value={scanMode}
              onChange={setScanMode}
              options={[
                { value: "single", label: "Single" },
                { value: "continuous", label: "Continuous" },
              ]}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setView("manual");
            }}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 text-sm text-slate-300 hover:text-white"
          >
            <KeyboardIcon className="h-4 w-4" />
            Enter ISBN manually
          </button>
        </footer>
      )}
    </div>,
    document.body,
  );
}

// ── Presentational pieces ────────────────────────────────────────────────────

function Reticle() {
  const bracket = "absolute w-6 h-6 border-white";
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative" style={{ width: 240, height: 150 }}>
          <div
            className="absolute inset-0 rounded-2xl"
            style={{ boxShadow: "0 0 0 2000px rgba(2,6,23,0.55)" }}
          />
          <span
            className={`${bracket} left-0 top-0 rounded-tl-2xl border-l-[3px] border-t-[3px]`}
          />
          <span
            className={`${bracket} right-0 top-0 rounded-tr-2xl border-r-[3px] border-t-[3px]`}
          />
          <span
            className={`${bracket} bottom-0 left-0 rounded-bl-2xl border-b-[3px] border-l-[3px]`}
          />
          <span
            className={`${bracket} bottom-0 right-0 rounded-br-2xl border-b-[3px] border-r-[3px]`}
          />
          <div
            className="animate-scan-line absolute left-[8%] right-[8%] top-1/2 h-0.5 bg-emerald-400"
            style={{ boxShadow: "0 0 8px #34d399" }}
          />
        </div>
      </div>
      <p className="absolute inset-x-0 bottom-6 text-center text-sm text-slate-200">
        Point at the barcode on the back cover
      </p>
    </div>
  );
}

function CenteredOverlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 p-6">
      {children}
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3" role="status" aria-label={label}>
      <svg
        className="h-8 w-8 animate-spin text-white/80"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path
          d="M22 12a10 10 0 0 0-10-10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <p className="text-sm text-slate-300">{label}</p>
    </div>
  );
}

function ConfirmSheet({
  book,
  isbn,
  busy,
  error,
  onAdd,
  onScanAgain,
}: {
  book: BookSearchResult;
  isbn: string;
  busy: boolean;
  error: string | null;
  onAdd: (status: ShelfStatus) => void;
  onScanAgain: () => void;
}) {
  return (
    <div
      className="animate-fade-up absolute inset-x-0 bottom-0 outline-none"
      data-autofocus
      tabIndex={-1}
    >
      <div className="m-3 rounded-2xl border border-white/10 bg-slate-900 p-4">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
          <CheckIcon /> Barcode found · {isbn}
        </p>
        <div className="mb-4 flex gap-3">
          <BookCover
            coverUrl={book.coverUrl}
            title={book.title}
            authors={book.authors}
            className="h-20 w-14 flex-shrink-0 rounded"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium leading-tight">{book.title}</p>
            {book.authors.length > 0 && (
              <p className="mt-0.5 text-xs text-slate-400">{book.authors.join(", ")}</p>
            )}
            {book.publishedYear && (
              <p className="mt-0.5 text-xs text-slate-400">{book.publishedYear}</p>
            )}
          </div>
        </div>
        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
        <div className="mb-1 flex gap-2">
          <Button variant="app" className="flex-1" disabled={busy} onClick={() => onAdd("owned")}>
            Add owned
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            disabled={busy}
            onClick={() => onAdd("want")}
          >
            Add to wishlist
          </Button>
        </div>
        <button
          type="button"
          onClick={onScanAgain}
          className="flex min-h-11 w-full items-center justify-center text-xs text-slate-400 hover:text-white"
        >
          Scan again
        </button>
      </div>
    </div>
  );
}

function AddedSheet({
  item,
  busy,
  onUndo,
  onScanAnother,
  onDone,
}: {
  item: AddedItem;
  busy: boolean;
  onUndo: (isbn: string) => void;
  onScanAnother: () => void;
  onDone: () => void;
}) {
  return (
    <div
      className="animate-fade-up absolute inset-x-0 bottom-0 outline-none"
      data-autofocus
      tabIndex={-1}
    >
      <div className="m-3 rounded-2xl border border-white/10 bg-slate-900 p-4">
        <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-emerald-400">
          <CheckIcon /> Added to {item.status === "owned" ? "your shelf" : "wishlist"}
        </p>
        <div className="mb-4 flex gap-3">
          <BookCover
            coverUrl={item.coverUrl}
            title={item.title}
            authors={item.authors}
            className="h-20 w-14 flex-shrink-0 rounded"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium leading-tight">{item.title}</p>
            {item.authors.length > 0 && (
              <p className="mt-0.5 text-xs text-slate-400">{item.authors.join(", ")}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="app" className="flex-1" onClick={onScanAnother}>
            Scan another
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Done
          </Button>
        </div>
        <button
          type="button"
          onClick={() => onUndo(item.isbn)}
          disabled={busy}
          className="mt-1 flex min-h-11 w-full items-center justify-center text-xs text-slate-400 hover:text-white disabled:opacity-40"
        >
          Undo
        </button>
      </div>
    </div>
  );
}

function ManualPanel({
  heading,
  subheading,
  initialIsbn = "",
  error,
  busy,
  onLookup,
  onAddAnyway,
  onRetry,
  onBackToCamera,
}: {
  heading: string;
  subheading: string;
  initialIsbn?: string;
  error: string | null;
  busy: boolean;
  onLookup: (value: string) => void;
  onAddAnyway?: (status: ShelfStatus) => void;
  onRetry?: () => void;
  onBackToCamera?: () => void;
}) {
  const [value, setValue] = useState(initialIsbn);
  return (
    <div className="absolute inset-0 overflow-y-auto bg-slate-950">
      <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5">
          <KeyboardIcon className="h-6 w-6 text-slate-300" />
        </div>
        <h2 className="mt-3 text-base font-medium">{heading}</h2>
        <p className="mt-1.5 text-sm text-slate-400">{subheading}</p>

        <form
          className="mt-6 w-full text-left"
          onSubmit={(e) => {
            e.preventDefault();
            onLookup(value);
          }}
        >
          <label className={labelClass} htmlFor="manual-isbn">
            ISBN
          </label>
          <input
            id="manual-isbn"
            data-autofocus
            className={inputClass}
            // ISBN-10 can end in "X", so allow text (a numeric keypad hides X).
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="978…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          <Button
            type="submit"
            variant="app"
            className="mt-3 w-full"
            disabled={busy || !value.trim()}
          >
            Look up
          </Button>
        </form>

        {onAddAnyway && (
          <div className="mt-3 flex w-full gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={busy}
              onClick={() => onAddAnyway("owned")}
            >
              Add owned
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              disabled={busy}
              onClick={() => onAddAnyway("want")}
            >
              Add to wishlist
            </Button>
          </div>
        )}

        {(onRetry || onBackToCamera) && (
          <div className="mt-3 flex justify-center gap-4">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="flex min-h-11 items-center px-3 text-sm text-slate-400 hover:text-white"
              >
                Try camera again
              </button>
            )}
            {onBackToCamera && (
              <button
                type="button"
                onClick={onBackToCamera}
                className="flex min-h-11 items-center px-3 text-sm text-slate-400 hover:text-white"
              >
                Back to camera
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ContinuousList({ added, onUndo }: { added: AddedItem[]; onUndo: (isbn: string) => void }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-slate-400">Added this session</span>
        <span className="text-xs font-medium">{added.length}</span>
      </div>
      <ul className="max-h-40 space-y-1 overflow-y-auto">
        {added.map((item) => (
          <li key={item.isbn} className="flex items-center gap-2.5">
            <BookCover
              coverUrl={item.coverUrl}
              title={item.title}
              authors={item.authors}
              className="h-10 w-7 flex-shrink-0 rounded"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs">{item.title}</p>
              <p className="text-xs text-slate-400">
                {item.status === "owned" ? "Owned" : "Wishlist"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onUndo(item.isbn)}
              className="flex min-h-11 items-center px-3 text-xs text-slate-400 hover:text-white"
            >
              Undo
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" />
      <path
        d="M5 8.5l2 2 4-4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function KeyboardIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M7 10h.01M11 10h.01M15 10h.01M7 13h.01M15 13h.01M9 16h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
