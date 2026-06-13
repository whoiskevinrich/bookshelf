/**
 * Whether this device can plausibly scan a barcode with a rear camera: it has a
 * MediaDevices/getUserMedia API and a touch screen. The Scan entry point is
 * gated on this so the button never appears on a desktop, where pointing a
 * webcam at a book spine is awkward and rarely what the user wants.
 *
 * This is a capability hint, not a guarantee — permission can still be denied or
 * there may be no usable camera. `useBarcodeScanner` handles those at runtime.
 */
export function supportsCameraScan(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const hasGetUserMedia = typeof navigator.mediaDevices?.getUserMedia === "function";
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return hasGetUserMedia && isTouch;
}
