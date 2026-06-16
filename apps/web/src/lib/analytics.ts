import { postEvent, type AnalyticsEvent } from "./api-client";

/**
 * Fire-and-forget analytics (ADR-016). `track` never throws and never blocks the
 * UI — an analytics ping failing must be invisible to the user. Awaiting is
 * optional; callers in render paths should not await.
 */
export function track(
  name: AnalyticsEvent,
  props?: Record<string, string | number | boolean>,
): void {
  void postEvent(name, props).catch(() => {
    // Best-effort: swallow network/auth errors so analytics can't break the app.
  });
}
