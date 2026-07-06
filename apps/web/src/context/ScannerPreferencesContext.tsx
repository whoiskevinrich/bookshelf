import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";
import type { ShelfStatus } from "../lib/api-client";

/** What happens after a barcode decodes to a valid ISBN. */
export type PostScanBehavior = "confirm" | "autoAddOwned";
/** Whether the camera stops after one book or keeps scanning. */
export type ScanMode = "single" | "continuous";
/** Whether the scanner reads barcodes or printed ISBN text (OCR). */
export type OcrInputMode = "barcode" | "text";
/** Where a scanned book lands — the remembered Owned/Wishlist destination (BOOKSHELF-58). */
export type ScanDestination = ShelfStatus;

const POST_SCAN_VALUES: readonly PostScanBehavior[] = ["confirm", "autoAddOwned"];
const SCAN_MODE_VALUES: readonly ScanMode[] = ["single", "continuous"];
const OCR_INPUT_MODE_VALUES: readonly OcrInputMode[] = ["barcode", "text"];
const SCAN_DESTINATION_VALUES: readonly ScanDestination[] = ["owned", "want"];

interface ScannerPreferencesValue {
  postScanBehavior: PostScanBehavior;
  scanMode: ScanMode;
  ocrInputMode: OcrInputMode;
  scanDestination: ScanDestination;
  /** Remembered target named shelf (or `null` for "No shelf") — BOOKSHELF-85. */
  scanShelfId: string | null;
  setPostScanBehavior: (value: PostScanBehavior) => void;
  setScanMode: (value: ScanMode) => void;
  setOcrInputMode: (value: OcrInputMode) => void;
  setScanDestination: (value: ScanDestination) => void;
  setScanShelfId: (value: string | null) => void;
}

const ScannerPreferencesContext = createContext<ScannerPreferencesValue | null>(null);

/** Build a `parse` that only accepts a known member of `values`. */
function memberOf<T extends string>(values: readonly T[]): (raw: string) => T | null {
  return (raw) => (values.includes(raw as T) ? (raw as T) : null);
}

/**
 * Holds the user's scanner preferences, persisted to localStorage. Defaults are
 * the safe, least-surprising choices: confirm each book, one at a time.
 */
export function ScannerPreferencesProvider({ children }: { children: ReactNode }) {
  const [postScanBehavior, setPostScanBehavior] = useLocalStorage<PostScanBehavior>(
    "scanner:postScanBehavior",
    "confirm",
    memberOf(POST_SCAN_VALUES),
  );
  const [scanMode, setScanMode] = useLocalStorage<ScanMode>(
    "scanner:scanMode",
    "single",
    memberOf(SCAN_MODE_VALUES),
  );
  const [ocrInputMode, setOcrInputMode] = useLocalStorage<OcrInputMode>(
    "scanner:ocrInputMode",
    "barcode",
    memberOf(OCR_INPUT_MODE_VALUES),
  );
  const [scanDestination, setScanDestination] = useLocalStorage<ScanDestination>(
    "scanner:destination",
    "owned",
    memberOf(SCAN_DESTINATION_VALUES),
  );
  // Stored as "" for "no shelf" since useLocalStorage requires a string type;
  // surfaced through the context as `null` (BOOKSHELF-85).
  const [scanShelfIdRaw, setScanShelfIdRaw] = useLocalStorage<string>(
    "scanner:shelfId",
    "",
    (raw) => raw,
  );
  const scanShelfId = scanShelfIdRaw || null;
  const setScanShelfId = useCallback(
    (value: string | null) => setScanShelfIdRaw(value ?? ""),
    [setScanShelfIdRaw],
  );

  const value = useMemo(
    () => ({
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
    }),
    [
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
    ],
  );

  return (
    <ScannerPreferencesContext.Provider value={value}>
      {children}
    </ScannerPreferencesContext.Provider>
  );
}

export function useScannerPreferences(): ScannerPreferencesValue {
  const ctx = useContext(ScannerPreferencesContext);
  if (!ctx) {
    throw new Error("useScannerPreferences must be used within ScannerPreferencesProvider");
  }
  return ctx;
}
