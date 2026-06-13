import { useCallback, useEffect, useRef, useState } from "react";
import { createBarcodeScanner, type BarcodeScanner } from "../lib/barcode/scanner";

export type ScannerStatus =
  | "starting" // requesting camera / loading decoder
  | "scanning" // camera live, decode loop running
  | "denied" // user blocked camera permission
  | "no-camera" // no camera / getUserMedia unavailable
  | "error"; // unexpected failure

interface UseBarcodeScannerOptions {
  /** Called with each decoded raw barcode value (de-duplicated vs. the last hit). */
  onDecode: (raw: string) => void;
  /**
   * When false the decode loop pauses but the camera stays live — used while a
   * confirmation card or lookup is on screen so we don't stack decodes.
   */
  active: boolean;
}

interface UseBarcodeScannerResult {
  /** Attach to the `<video>` element that shows the camera preview. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: ScannerStatus;
  /** Re-request the camera (e.g. after the user grants permission). */
  retry: () => void;
}

// Decode a few times a second — frequent enough to feel instant, cheap enough
// to keep the main thread responsive.
const SCAN_INTERVAL_MS = 250;
// Ignore the same code re-appearing within this window (it stays in frame).
const DEDUPE_MS = 2500;

export function useBarcodeScanner({
  onDecode,
  active,
}: UseBarcodeScannerOptions): UseBarcodeScannerResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<ScannerStatus>("starting");
  const [nonce, setNonce] = useState(0);

  // Keep the latest callback/flag without restarting the camera effect.
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;
  const activeRef = useRef(active);
  activeRef.current = active;

  const retry = useCallback(() => {
    setStatus("starting");
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stream: MediaStream | null = null;
    let scanner: BarcodeScanner | null = null;
    const lastHit = { raw: "", at: 0 };

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("no-camera");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setStatus(
          name === "NotAllowedError" || name === "SecurityError"
            ? "denied"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "no-camera"
              : "error",
        );
        return;
      }

      const video = videoRef.current;
      if (cancelled || !video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay may reject momentarily; the decode loop still reads frames.
      }

      try {
        scanner = await createBarcodeScanner();
      } catch {
        if (!cancelled) setStatus("error");
        return;
      }
      if (cancelled) {
        scanner.dispose();
        return;
      }

      setStatus("scanning");

      const tick = async () => {
        if (cancelled) return;
        const v = videoRef.current;
        if (v && scanner && activeRef.current && v.readyState >= 2) {
          try {
            const raw = await scanner.scan(v);
            if (raw && !cancelled) {
              const now = Date.now();
              const isDuplicate = raw === lastHit.raw && now - lastHit.at < DEDUPE_MS;
              if (!isDuplicate) {
                lastHit.raw = raw;
                lastHit.at = now;
                onDecodeRef.current(raw);
              }
            }
          } catch {
            // Transient decode failure — keep looping.
          }
        }
        if (!cancelled) timer = setTimeout(() => void tick(), SCAN_INTERVAL_MS);
      };
      void tick();
    }

    void start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      scanner?.dispose();
      const video = videoRef.current;
      if (video) video.srcObject = null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [nonce]);

  return { videoRef, status, retry };
}
