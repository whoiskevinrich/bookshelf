import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { extractIsbn13, toIsbn13 } from "../../lib/isbn";
import {
  getBookByIsbn,
  isConflictError,
  type BookSearchResult,
  type Shelf,
  type ShelfStatus,
} from "../../lib/api-client";
import { useAddToShelf, useRemoveFromShelf } from "../../hooks/useShelf";
import { useShelves, useAddBookToShelf } from "../../hooks/useShelves";
import { useBarcodeScanner } from "../../hooks/useBarcodeScanner";
import { useScannerPreferences } from "../../context/ScannerPreferencesContext";
import { getRuntimeConfig } from "../../lib/runtime-config";
import { createOcrScanner, type OcrScanner } from "../../lib/ocr/scanner";
import { track } from "../../lib/analytics";
import { supportsCameraScan } from "../../lib/device";
import { BookCover } from "../BookCover";
import { Button } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import { inputClass, labelClass } from "../../lib/form-styles";
import { ScannerViewfinder } from "./ScannerViewfinder";
import { ScannerModeBar } from "./ScannerModeBar";

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
  const {
    postScanBehavior,
    scanMode,
    ocrInputMode,
    scanDestination,
    scanShelfId,
    setPostScanBehavior,
    setScanMode,
    setOcrInputMode,
    setScanDestination,
    setScanShelfId,
  } = useScannerPreferences();
  const addMutation = useAddToShelf();
  const removeMutation = useRemoveFromShelf();
  const addToShelfMutation = useAddBookToShelf();
  const shelves = useShelves().data ?? [];
  // A remembered shelf id that's since been deleted resolves to "no shelf" for
  // this render/commit without clearing the stored preference (BOOKSHELF-85).
  const activeShelf = scanShelfId ? (shelves.find((s) => s.shelfId === scanShelfId) ?? null) : null;

  const [view, setView] = useState<View>("scanning");
  const [pendingIsbn, setPendingIsbn] = useState<string | null>(null);
  const [foundBook, setFoundBook] = useState<BookSearchResult | null>(null);
  const [added, setAdded] = useState<AddedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{
    item: AddedItem;
    key: number;
    kind: "added" | "duplicate";
  } | null>(null);

  // OCR text-scan state
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrMissHint, setOcrMissHint] = useState<string | null>(null);
  const [showFallbackCallout, setShowFallbackCallout] = useState(false);

  const addedIsbns = useRef<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashKey = useRef(0);
  const runId = useRef(0);
  const processing = useRef(false);
  const ocrScannerRef = useRef<OcrScanner | null>(null);

  const features = getRuntimeConfig().features;

  // ── OCR scanner lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    if (!features.ocrScan) return;
    const scanner = createOcrScanner();
    ocrScannerRef.current = scanner;
    return () => {
      scanner.dispose().catch(() => {});
      ocrScannerRef.current = null;
    };
  }, [features.ocrScan]);

  // ── Miss hint auto-clear ───────────────────────────────────────────────────
  useEffect(() => {
    if (!ocrMissHint) return;
    const id = setTimeout(() => setOcrMissHint(null), 2000);
    return () => clearTimeout(id);
  }, [ocrMissHint]);

  // ── Auto-fallback callout (2.5 s barcode-free in barcode mode) ────────────
  useEffect(() => {
    if (!features.ocrScan || ocrInputMode !== "barcode" || view !== "scanning") {
      setShowFallbackCallout(false);
      return;
    }
    const timer = setTimeout(() => {
      setShowFallbackCallout(true);
      track("scan_text_mode_suggested");
    }, 2500);
    return () => clearTimeout(timer);
  }, [features.ocrScan, ocrInputMode, view]);

  function resumeScanning() {
    runId.current += 1;
    setFoundBook(null);
    setPendingIsbn(null);
    setError(null);
    setView("scanning");
  }

  function recordAdded(item: AddedItem) {
    addedIsbns.current.add(item.isbn);
    setAdded((prev) => [item, ...prev]);
  }

  function showFlash(item: AddedItem, kind: "added" | "duplicate") {
    flashKey.current += 1;
    setFlash({ item, key: flashKey.current, kind });
    if (kind === "added" && typeof navigator.vibrate === "function") navigator.vibrate(40);
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
      if (id !== runId.current) return;
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

  async function commitAdd(
    isbn: string,
    status: ShelfStatus,
    book: BookSearchResult | null,
    // "sheet" adds have a visible confirm/not-found sheet to show errors in;
    // "auto" adds happen mid-scan, so their feedback must go through the flash pill.
    source: "sheet" | "auto" = "sheet",
  ) {
    setBusy(true);
    setError(null);
    try {
      await addMutation.mutateAsync({ isbn, status, ...(book ? { book } : {}) });
      // Shelf membership is additive to status, not an alternative — applies
      // regardless of which status button triggered the add (BOOKSHELF-85).
      if (activeShelf) {
        await addToShelfMutation.mutateAsync({ shelfId: activeShelf.shelfId, isbn });
      }
      const item = buildAddedItem(isbn, status, book);
      recordAdded(item);
      if (scanMode === "single") {
        setView("added");
        if (typeof navigator.vibrate === "function") navigator.vibrate(40);
      } else {
        showFlash(item, "added");
        resumeScanning();
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error(`[ScanModal] add to shelf failed for ${isbn}`, err);
      if (isConflictError(err)) {
        // Already in the library from before this session — remember it so a
        // re-scan of the same barcode doesn't loop through the duplicate again.
        addedIsbns.current.add(isbn);
        if (source === "auto") {
          showFlash(buildAddedItem(isbn, status, book), "duplicate");
          resumeScanning();
        } else {
          setError("That book is already on your shelf.");
        }
      } else {
        setError("Couldn't add that book — try again.");
      }
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
      if (import.meta.env.DEV)
        console.error(`[ScanModal] metadata lookup failed for ${isbn}; adding bare ISBN`, err);
      book = null;
    }
    await commitAdd(isbn, scanDestination, book, "auto");
  }

  function handleDecode(raw: string) {
    if (processing.current) return;
    // extractIsbn13 (not toIsbn13) so a barcode read that merged the EAN-13 with
    // its EAN-2/EAN-5 price add-on still resolves — see BOOKSHELF-50.
    const isbn = extractIsbn13(raw);
    if (!isbn) return;
    if (scanMode === "continuous" && addedIsbns.current.has(isbn)) return;
    setShowFallbackCallout(false);
    processing.current = true;
    const job = postScanBehavior === "autoAddOwned" ? autoAdd(isbn) : beginLookup(isbn);
    void job.finally(() => {
      processing.current = false;
    });
  }

  function manualLookup(value: string) {
    const isbn = toIsbn13(value);
    if (!isbn) {
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

  // ── OCR tap-to-scan ────────────────────────────────────────────────────────

  async function handleOcrScan() {
    if (ocrBusy || !ocrScannerRef.current) return;
    const video = dialogRef.current?.querySelector<HTMLVideoElement>("video");
    if (!video) return;
    setOcrBusy(true);
    setOcrMissHint(null);
    let isbn: string | null = null;
    try {
      isbn = await ocrScannerRef.current.scan(video);
    } finally {
      setOcrBusy(false);
    }
    if (!isbn) {
      setOcrMissHint("Nothing found — try re-aligning");
      track("scan_text_miss");
    } else {
      setShowFallbackCallout(false);
      track("scan_text_success");
      void beginLookup(isbn);
    }
  }

  function handleModeChange(mode: typeof ocrInputMode) {
    setOcrInputMode(mode);
    setOcrMissHint(null);
    setShowFallbackCallout(false);
    if (mode === "text") track("scan_text_mode_activated");
  }

  // ── Barcode scanner (paused in text mode) ──────────────────────────────────
  const { videoRef, status, retry } = useBarcodeScanner({
    onDecode: handleDecode,
    active: view === "scanning" && !busy && ocrInputMode === "barcode",
  });

  // ── Focus trap + Escape + scroll lock ─────────────────────────────────────
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

  useEffect(() => {
    const el = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    el?.focus({ preventScroll: true });
  }, [view, status]);

  // ── Computed display flags ─────────────────────────────────────────────────
  const cameraUnavailable = status === "denied" || status === "no-camera" || status === "error";
  const showFooter = status === "scanning" && view === "scanning";
  // The remembered-destination chip rides over the live viewfinder, in barcode and text modes.
  const showDestinationChip = status === "scanning" && view === "scanning";
  const showModeBar =
    features.ocrScan && supportsCameraScan() && status === "scanning" && view === "scanning";

  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="dark fixed inset-0 z-50 flex flex-col bg-slate-950 text-white outline-none"
      role="dialog"
      aria-modal="true"
      aria-label="Scan a book"
    >
      <header
        className="flex items-center justify-between px-4 py-2"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
      >
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

      <ScannerViewfinder
        videoRef={videoRef}
        showVideo={status === "starting" || status === "scanning"}
        showCameraSpinner={status === "starting"}
        showReticle={status === "scanning" && view === "scanning"}
        mode={ocrInputMode}
        ocrEnabled={features.ocrScan}
        ocrBusy={ocrBusy}
        ocrMissHint={ocrMissHint}
        onOcrScan={() => void handleOcrScan()}
      >
        {/* Remembered scan destination — always visible while the camera is live so a
            silent auto-add can never land somewhere surprising (BOOKSHELF-58). */}
        {showDestinationChip && (
          <DestinationControl
            destination={scanDestination}
            onChange={setScanDestination}
            shelves={shelves}
            shelfId={activeShelf?.shelfId ?? null}
            onShelfChange={setScanShelfId}
          />
        )}

        {/* Mid-scan feedback flash: green for an add, amber for a duplicate */}
        {flash && view === "scanning" && (
          <>
            {flash.kind === "added" && (
              <div
                key={flash.key}
                aria-hidden="true"
                className="animate-success-flash pointer-events-none absolute inset-0 ring-4 ring-inset ring-emerald-400/70"
              />
            )}
            {/* Sits below the destination chip (top-3) so the two never overlap. */}
            <div className="absolute inset-x-0 top-16 flex justify-center px-4">
              <div
                className={`animate-fade-up flex max-w-full items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium ${
                  flash.kind === "added"
                    ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                    : "border-amber-400/40 bg-amber-500/15 text-amber-300"
                }`}
              >
                {flash.kind === "added" ? <CheckIcon /> : <InfoIcon />}
                <span className="truncate">
                  {flash.kind === "added"
                    ? `Added "${flash.item.title}"`
                    : `Already on your shelf — "${flash.item.title}"`}
                </span>
                {flash.kind === "added" && (
                  <button
                    type="button"
                    onClick={() => undo(flash.item.isbn)}
                    className="ml-1 underline underline-offset-2 hover:no-underline"
                  >
                    Undo
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* ISBN lookup in progress */}
        {view === "looking-up" && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 p-6">
            <div className="flex flex-col items-center gap-5">
              <div
                className="flex flex-col items-center gap-3"
                role="status"
                aria-label="Looking up…"
              >
                <svg
                  className="h-8 w-8 animate-spin text-white/80"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeOpacity="0.25"
                    strokeWidth="3"
                  />
                  <path
                    d="M22 12a10 10 0 0 0-10-10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
                <p className="text-sm text-slate-300">Looking up…</p>
              </div>
              <button
                type="button"
                onClick={resumeScanning}
                className="flex min-h-11 items-center px-4 text-sm text-slate-300 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Only while idle-scanning: kept mounted through confirm/added, this panel's
            input stole [data-autofocus] focus from the confirm sheet, so Enter re-ran
            the lookup instead of adding the found book. */}
        {cameraUnavailable && view === "scanning" && (
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
            destination={scanDestination}
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
            destination={scanDestination}
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
          {flash
            ? flash.kind === "added"
              ? `Added ${flash.item.title}`
              : `${flash.item.title} is already on your shelf`
            : ""}
          {showFallbackCallout
            ? "Can't find a barcode? This book may only have a printed ISBN. Try Text mode."
            : ""}
        </div>
      </ScannerViewfinder>

      {showModeBar && (
        <ScannerModeBar
          mode={ocrInputMode}
          onChange={handleModeChange}
          showCallout={showFallbackCallout}
          onCalloutDismiss={() => setShowFallbackCallout(false)}
          onSwitchToText={() => {
            handleModeChange("text");
            track("scan_text_mode_accepted");
          }}
        />
      )}

      {showFooter && (
        <footer
          className="space-y-3 border-t border-white/10 bg-slate-950/90 px-4 py-3"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
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

function ConfirmSheet({
  book,
  isbn,
  destination,
  busy,
  error,
  onAdd,
  onScanAgain,
}: {
  book: BookSearchResult;
  isbn: string;
  destination: ShelfStatus;
  busy: boolean;
  error: string | null;
  onAdd: (status: ShelfStatus) => void;
  onScanAgain: () => void;
}) {
  return (
    <div
      className="animate-fade-up absolute inset-x-0 bottom-0"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
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
        {/* The remembered destination is the emphasised (primary + autofocused) button so
            Enter adds there; tapping the other button is a one-off that leaves the
            remembered default untouched — the chip is the only setter (ADR-026). */}
        <div className="mb-1 flex gap-2">
          <Button
            variant={destination === "owned" ? "app" : "secondary"}
            className="flex-1"
            disabled={busy}
            onClick={() => onAdd("owned")}
            {...(destination === "owned" ? { autoFocus: true } : {})}
          >
            Add owned
          </Button>
          <Button
            variant={destination === "want" ? "app" : "secondary"}
            className="flex-1"
            disabled={busy}
            onClick={() => onAdd("want")}
            {...(destination === "want" ? { autoFocus: true } : {})}
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
      className="animate-fade-up absolute inset-x-0 bottom-0"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
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
          <Button variant="app" className="flex-1" onClick={onScanAnother} autoFocus>
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
  destination = "owned",
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
  destination?: ShelfStatus;
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
      <div
        className="mx-auto flex max-w-sm flex-col items-center px-6 py-10 text-center"
        style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}
      >
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
            {/* Emphasise the remembered destination, matching the confirm sheet. */}
            <Button
              variant={destination === "owned" ? "app" : "secondary"}
              className="flex-1"
              disabled={busy}
              onClick={() => onAddAnyway("owned")}
            >
              Add owned
            </Button>
            <Button
              variant={destination === "want" ? "app" : "secondary"}
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

// ── Destination chip ─────────────────────────────────────────────────────────

const DESTINATION_LABEL: Record<ShelfStatus, string> = { owned: "Owned", want: "Wishlist" };

/**
 * The remembered scan destination, shown as a tappable chip over the live camera.
 * Tapping opens a two-option menu (Owned / Wishlist); choosing one updates the
 * persisted preference. This is the only control that changes the remembered default —
 * per-book confirm-sheet taps don't (ADR-026 / BOOKSHELF-58).
 */
function DestinationControl({
  destination,
  onChange,
  shelves,
  shelfId,
  onShelfChange,
}: {
  destination: ShelfStatus;
  onChange: (value: ShelfStatus) => void;
  shelves: Shelf[];
  shelfId: string | null;
  onShelfChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    // Capture so Escape closes the menu without also closing the whole scanner.
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  function choose(value: ShelfStatus) {
    onChange(value);
    setOpen(false);
  }

  function chooseShelf(value: string | null) {
    onShelfChange(value);
    setOpen(false);
  }

  const label = DESTINATION_LABEL[destination];
  const activeShelfName = shelfId
    ? (shelves.find((s) => s.shelfId === shelfId)?.name ?? null)
    : null;
  const triggerLabel = activeShelfName ? `${label} · ${activeShelfName}` : label;
  const announceLabel = activeShelfName ? `${label} and ${activeShelfName}` : `${label}, no shelf`;

  return (
    <div className="absolute inset-x-0 top-3 z-20 flex justify-center px-4">
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Adding to ${announceLabel}. Change scan destination`}
          className="flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-slate-950/70 px-4 py-2 text-sm backdrop-blur-sm transition-colors hover:border-white/30"
        >
          {destination === "owned" ? <BookIcon /> : <BookmarkIcon />}
          <span>
            Adding to <span className="font-medium">{triggerLabel}</span>
          </span>
          <ChevronIcon open={open} />
        </button>

        {open && (
          <div
            role="menu"
            aria-label="Scan destination"
            className="absolute left-1/2 top-full z-20 mt-2 w-48 -translate-x-1/2 overflow-hidden rounded-xl border border-white/15 bg-slate-900 shadow-lg"
          >
            <DestinationOption
              icon={<BookIcon />}
              label="Owned"
              selected={destination === "owned"}
              onSelect={() => choose("owned")}
            />
            <div className="h-px bg-white/10" />
            <DestinationOption
              icon={<BookmarkIcon />}
              label="Wishlist"
              selected={destination === "want"}
              onSelect={() => choose("want")}
            />
            {shelves.length > 0 && (
              <>
                <div className="h-px bg-white/10" />
                <div
                  role="group"
                  aria-label="Shelf"
                  className="px-3 pt-2 pb-1 text-xs font-medium text-slate-400"
                >
                  Shelf
                </div>
                <DestinationOption
                  icon={<BookmarkIcon />}
                  label="No shelf"
                  selected={shelfId === null}
                  onSelect={() => chooseShelf(null)}
                />
                {shelves.map((shelf) => (
                  <DestinationOption
                    key={shelf.shelfId}
                    icon={<BookmarkIcon />}
                    label={shelf.name}
                    selected={shelfId === shelf.shelfId}
                    onSelect={() => chooseShelf(shelf.shelfId)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        Adding to {announceLabel}
      </span>
    </div>
  );
}

function DestinationOption({
  icon,
  label,
  selected,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex min-h-11 w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm ${
        selected ? "bg-emerald-500/10 text-emerald-300" : "text-slate-200 hover:bg-white/5"
      }`}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="flex-1">{label}</span>
      {selected && <CheckIcon />}
    </button>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0" fill="none" aria-hidden="true">
      <path
        d="M4 4h5a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 4h-5a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0" fill="none" aria-hidden="true">
      <path
        d="M6 4h12v16l-6-4-6 4z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform ${
        open ? "rotate-180" : ""
      }`}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

function InfoIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" />
      <path d="M8 7v4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="8" cy="4.75" r="0.9" fill="currentColor" stroke="none" />
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
