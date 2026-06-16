/**
 * Minimal CloudWatch metric emission via the Embedded Metric Format (EMF).
 *
 * EMF is just a structured JSON log line: when CloudWatch Logs ingests a line
 * carrying the `_aws` envelope, it auto-extracts the named metrics — no
 * `PutMetricData` API call (and its per-call cost), and no extra dependency.
 * See ADR-016. In Lambda, `console.log` writes straight to the function's log
 * group, so this is the whole integration.
 */

const NAMESPACE = "Bookshelf/WebEvents";

/**
 * Emit a single `Count: 1` metric named by `event`, with `event` as the only
 * metric dimension. Callers MUST pass a value from a bounded allowlist — an
 * unbounded dimension value would create unbounded CloudWatch metrics.
 *
 * Optional `props` are written as a nested field on the same log line (NOT as
 * metric dimensions, so they never widen metric cardinality) — they stay
 * queryable in CloudWatch Logs Insights. Never throws: a metric failure must
 * not break the request that triggered it.
 */
export function emitMetric(event: string, props?: Record<string, string | number | boolean>): void {
  try {
    const line = {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: NAMESPACE,
            Dimensions: [["event"]],
            Metrics: [{ Name: "Count", Unit: "Count" }],
          },
        ],
      },
      event,
      Count: 1,
      ...(props ? { props } : {}),
    };
    // EMF is delivered via stdout to CloudWatch Logs.
    console.log(JSON.stringify(line));
  } catch {
    // Metric emission is best-effort; swallow so it never affects the response.
  }
}
