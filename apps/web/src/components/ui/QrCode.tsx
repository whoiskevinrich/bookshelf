import { useEffect, useState } from "react";

interface QrCodeProps {
  /** Value to encode (e.g. an absolute URL). */
  value: string;
  /** Accessible description of where the QR leads. */
  label: string;
  /** Applied to the white quiet-zone box (size it here, e.g. "h-28 w-28"). */
  className?: string;
}

/**
 * Renders `value` as a QR code SVG. The encoder (`qrcode-generator`, a tiny
 * dependency-free lib) is **lazily imported** so only views that actually show
 * a QR pay for it — mirroring the lazy WASM decoder in ADR-014.
 *
 * The code always sits on a white background with a quiet-zone margin,
 * regardless of light/dark theme, because QR scanners expect dark-on-light.
 * This is a deliberate exception to the dark-mode rule (cf. the always-dark
 * camera scanner surface).
 */
export function QrCode({ value, label, className = "" }: QrCodeProps) {
  const [path, setPath] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { default: qrcode } = await import("qrcode-generator");
        const qr = qrcode(0, "M"); // 0 = auto-fit version, "M" = ~15% error correction
        qr.addData(value);
        qr.make();
        const n = qr.getModuleCount();
        // One <path> of all dark modules — far fewer DOM nodes than per-cell rects.
        let d = "";
        for (let row = 0; row < n; row++) {
          for (let col = 0; col < n; col++) {
            if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
          }
        }
        if (!cancelled) {
          setCount(n);
          setPath(d);
        }
      } catch {
        // Encoder failed to load — leave the placeholder; the text URL beside
        // the QR is the accessible fallback (never QR-only).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div className={`shrink-0 rounded-lg bg-white p-2 ${className}`}>
      {path !== null ? (
        <svg
          viewBox={`0 0 ${count} ${count}`}
          width="100%"
          height="100%"
          role="img"
          aria-label={label}
          shapeRendering="crispEdges"
        >
          <path d={path} fill="#0f172a" />
        </svg>
      ) : (
        // Same footprint while the encoder loads, so layout doesn't shift.
        <div className="h-full w-full" role="img" aria-label={label} aria-busy="true" />
      )}
    </div>
  );
}
