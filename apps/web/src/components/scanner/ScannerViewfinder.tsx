import { type ReactNode, type RefObject } from "react";
import { Button } from "../ui/Button";
import type { OcrInputMode } from "../../context/ScannerPreferencesContext";

interface ScannerViewfinderProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Render the video element (camera starting or actively scanning). */
  showVideo: boolean;
  /** Overlay a "Starting camera…" spinner (camera is initialising). */
  showCameraSpinner: boolean;
  /** Render the scan reticle (camera scanning + in the scanning view). */
  showReticle: boolean;
  mode: OcrInputMode;
  ocrEnabled: boolean;
  ocrBusy: boolean;
  ocrMissHint: string | null;
  onOcrScan: () => void;
  /** Overlay sheets and live regions passed from ScanModal. */
  children?: ReactNode;
}

/**
 * Full-screen camera area: video feed, scan reticle (barcode or text variant),
 * and the tap-to-scan button for text mode. Overlay sheets are rendered as
 * `children` so they remain positioned within the same `relative` container.
 *
 * All classes are unconditionally dark — no `dark:` prefixes here.
 */
export function ScannerViewfinder({
  videoRef,
  showVideo,
  showCameraSpinner,
  showReticle,
  mode,
  ocrEnabled,
  ocrBusy,
  ocrMissHint,
  onOcrScan,
  children,
}: ScannerViewfinderProps) {
  return (
    <div className="relative flex-1 overflow-hidden">
      {showVideo && (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      {showCameraSpinner && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 p-6">
          <div
            className="flex flex-col items-center gap-3"
            role="status"
            aria-label="Starting camera…"
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
            <p className="text-sm text-slate-300">Starting camera…</p>
          </div>
        </div>
      )}

      {showReticle &&
        (ocrEnabled && mode === "text" ? (
          <TextReticle onScan={onOcrScan} busy={ocrBusy} missHint={ocrMissHint} />
        ) : (
          <BarcodeReticle />
        ))}

      {children}
    </div>
  );
}

// ── Reticles ────────────────────────────────────────────────────────────────

const BRACKET = "absolute w-6 h-6 border-white";

function ReticleCorners() {
  return (
    <>
      <span className={`${BRACKET} left-0 top-0 rounded-tl-2xl border-l-[3px] border-t-[3px]`} />
      <span className={`${BRACKET} right-0 top-0 rounded-tr-2xl border-r-[3px] border-t-[3px]`} />
      <span className={`${BRACKET} bottom-0 left-0 rounded-bl-2xl border-b-[3px] border-l-[3px]`} />
      <span
        className={`${BRACKET} bottom-0 right-0 rounded-br-2xl border-b-[3px] border-r-[3px]`}
      />
    </>
  );
}

function BarcodeReticle() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative" style={{ width: 240, height: 150 }}>
          <div
            className="absolute inset-0 rounded-2xl"
            style={{ boxShadow: "0 0 0 2000px rgba(2,6,23,0.55)" }}
          />
          <ReticleCorners />
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

function TextReticle({
  onScan,
  busy,
  missHint,
}: {
  onScan: () => void;
  busy: boolean;
  missHint: string | null;
}) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Wide rectangular reticle in the lower third */}
      <div className="absolute inset-0 flex items-end justify-center pb-[20%]">
        <div className="relative" style={{ width: "min(70vw, 320px)", height: "18vh" }}>
          <div
            className="absolute inset-0 rounded-2xl"
            style={{ boxShadow: "0 0 0 2000px rgba(2,6,23,0.55)" }}
          />
          <ReticleCorners />
        </div>
      </div>

      {/* Instruction text — same absolute placement as BarcodeReticle's hint */}
      <p className="absolute inset-x-0 bottom-6 text-center text-sm text-slate-300">
        Frame the ISBN line, then tap Scan
      </p>

      {/* Scan button + miss hint — flex column above the instruction text */}
      <div
        className="pointer-events-auto absolute inset-x-0 flex flex-col items-center gap-2"
        style={{ bottom: "calc(20% - 56px)" }}
      >
        <Button variant="app" disabled={busy} aria-label="Scan for ISBN text" onClick={onScan}>
          {busy ? "Scanning…" : "Scan"}
        </Button>
        <div aria-live="polite" className="min-h-[1.25rem] text-center">
          {missHint && <p className="text-xs text-slate-300">{missHint}</p>}
        </div>
      </div>
    </div>
  );
}
