import { Button } from "../ui/Button";
import { Callout } from "../ui/Callout";
import { SegmentedControl } from "../ui/SegmentedControl";
import type { OcrInputMode } from "../../context/ScannerPreferencesContext";

interface ScannerModeBarProps {
  mode: OcrInputMode;
  onChange: (mode: OcrInputMode) => void;
  showCallout: boolean;
  onCalloutDismiss: () => void;
  onSwitchToText: () => void;
}

/**
 * Mode toggle (Barcode / Text) + optional auto-fallback Callout.
 * Sits between ScannerViewfinder and the footer in the forced-dark modal.
 *
 * The Callout appears after 2.5 s of barcode-free scanning to suggest Text mode.
 * All classes are unconditionally dark — no `dark:` prefixes in this component.
 */
export function ScannerModeBar({
  mode,
  onChange,
  showCallout,
  onCalloutDismiss,
  onSwitchToText,
}: ScannerModeBarProps) {
  return (
    <div className="bg-slate-950/90 px-4 py-3">
      <div className="flex justify-center">
        <SegmentedControl
          label="Scan input"
          value={mode}
          onChange={onChange}
          options={[
            { value: "barcode", label: "Barcode" },
            { value: "text", label: "Text" },
          ]}
        />
      </div>

      {showCallout && (
        <div className="mt-3 transition-opacity duration-150">
          <Callout
            title="Can't find a barcode?"
            onDismiss={onCalloutDismiss}
            dismissLabel="Dismiss scan tip"
            actions={
              <Button size="sm" variant="secondary" onClick={onSwitchToText}>
                Switch to Text
              </Button>
            }
          >
            This book may only have a printed ISBN. Try Text mode.
          </Callout>
        </div>
      )}
    </div>
  );
}
