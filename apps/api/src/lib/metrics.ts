/**
 * Minimal CloudWatch metric emission via the Embedded Metric Format (EMF).
 *
 * EMF is just a structured JSON log line: when CloudWatch Logs ingests a line
 * carrying the `_aws` envelope, it auto-extracts the named metrics — no
 * `PutMetricData` API call (and its per-call cost), and no extra dependency.
 * See ADR-016. In Lambda, writing the line to stdout sends it straight to the
 * function's log group, so this is the whole integration.
 */

const DEFAULT_NAMESPACE = "Bookshelf/WebEvents";

/**
 * Emit a single `Count: 1` metric named by `event`, with `event` as the only
 * metric dimension. Callers MUST pass a value from a bounded allowlist — an
 * unbounded dimension value would create unbounded CloudWatch metrics.
 *
 * Optional `props` are written as a nested field on the same log line (NOT as
 * metric dimensions, so they never widen metric cardinality) — they stay
 * queryable in CloudWatch Logs Insights. Never throws: a metric failure must
 * not break the request that triggered it.
 *
 * `namespace` defaults to the web-events namespace; other concerns (e.g. abuse
 * counters, ADR-018) pass their own namespace to keep metrics grouped.
 */
export function emitMetric(
  event: string,
  props?: Record<string, string | number | boolean>,
  namespace: string = DEFAULT_NAMESPACE,
): void {
  try {
    const line = {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: namespace,
            Dimensions: [["event"]],
            Metrics: [{ Name: "Count", Unit: "Count" }],
          },
        ],
      },
      event,
      Count: 1,
      ...(props ? { props } : {}),
    };
    // EMF is delivered as a single stdout line to CloudWatch Logs.
    process.stdout.write(`${JSON.stringify(line)}\n`);
  } catch (err) {
    // Best-effort: never let metric emission affect the response. But log it,
    // so a broken emitter surfaces in CloudWatch instead of a silent flatline.
    console.error("emitMetric failed", event, err instanceof Error ? err.message : err);
  }
}
