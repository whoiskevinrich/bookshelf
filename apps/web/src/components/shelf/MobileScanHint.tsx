import { useEffect, useMemo } from "react";
import { Callout } from "../ui/Callout";
import { QrCode } from "../ui/QrCode";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { supportsCameraScan } from "../../lib/device";
import { track } from "../../lib/analytics";

const DISMISSED_KEY = "scanHint:dismissed";

// Dedup `hint_shown` across client-side navigations within one page load:
// ShelfPage and WishlistPage both render this, so without a guard a
// shelf→wishlist→shelf trip would over-count. A hard reload (a new visit)
// resets it, which is the behaviour we want for "once per session".
let shownThisSession = false;

const parseDismissed = (raw: string): "yes" | "no" | null =>
  raw === "yes" ? "yes" : raw === "no" ? "no" : null;

/**
 * Points desktop users to the mobile camera scanner, which is hidden on their
 * device (`supportsCameraScan()` is false). Renders nothing when the current
 * device can already scan, or once the user has dismissed it. See
 * `docs/specs/mobile-scan-discoverability.md`.
 *
 * `page` is attached to every analytics event so CloudWatch can attribute
 * shown/clicked/dismissed by where the hint was surfaced.
 */
export function MobileScanHint({ page }: { page: "shelf" | "wishlist" }) {
  const [dismissed, setDismissed] = useLocalStorage<"yes" | "no">(
    DISMISSED_KEY,
    "no",
    parseDismissed,
  );

  // Eligible = this device can't scan itself.
  const eligible = useMemo(() => !supportsCameraScan(), []);
  const show = eligible && dismissed === "no";

  useEffect(() => {
    if (show && !shownThisSession) {
      shownThisSession = true;
      track("hint_shown", { page });
    }
  }, [show, page]);

  if (!show) return null;

  const appUrl = window.location.origin;
  const displayUrl = appUrl.replace(/^https?:\/\//, "");

  return (
    <Callout
      className="mb-8"
      title="Scan books with your phone"
      dismissLabel="Dismiss scan tip"
      onDismiss={() => {
        track("hint_dismissed", { page });
        setDismissed("yes");
      }}
      icon={
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p>
            Open <span className="font-medium text-slate-900 dark:text-white">bookshelf</span> on
            your phone, sign in, and tap{" "}
            <span className="font-medium text-slate-900 dark:text-white">Scan</span> to add a book
            by pointing the camera at its barcode.
          </p>
          <a
            href={appUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track("hint_link_clicked", { page })}
            className="mt-2 inline-block text-sm text-slate-900 underline underline-offset-2 dark:text-white"
          >
            {displayUrl}
          </a>
        </div>
        <QrCode value={appUrl} label={`QR code linking to ${displayUrl}`} className="h-28 w-28" />
      </div>
    </Callout>
  );
}
