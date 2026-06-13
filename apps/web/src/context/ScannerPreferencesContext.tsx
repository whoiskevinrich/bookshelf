import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";

/** What happens after a barcode decodes to a valid ISBN. */
export type PostScanBehavior = "confirm" | "autoAddOwned";
/** Whether the camera stops after one book or keeps scanning. */
export type ScanMode = "single" | "continuous";

const POST_SCAN_VALUES: readonly PostScanBehavior[] = ["confirm", "autoAddOwned"];
const SCAN_MODE_VALUES: readonly ScanMode[] = ["single", "continuous"];

interface ScannerPreferencesValue {
  postScanBehavior: PostScanBehavior;
  scanMode: ScanMode;
  setPostScanBehavior: (value: PostScanBehavior) => void;
  setScanMode: (value: ScanMode) => void;
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

  const value = useMemo(
    () => ({ postScanBehavior, scanMode, setPostScanBehavior, setScanMode }),
    [postScanBehavior, scanMode, setPostScanBehavior, setScanMode],
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
