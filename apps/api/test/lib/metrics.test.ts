import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emitMetric } from "../../src/lib/metrics.js";

let writes: string[];
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  writes = [];
  writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  writeSpy.mockRestore();
});

describe("emitMetric", () => {
  it("writes a well-formed EMF line with the event as the sole dimension", () => {
    emitMetric("hint_shown");
    expect(writes).toHaveLength(1);
    const line = JSON.parse(writes[0]!) as {
      _aws: {
        CloudWatchMetrics: { Namespace: string; Dimensions: string[][]; Metrics: unknown[] }[];
      };
      event: string;
      Count: number;
    };
    expect(line.event).toBe("hint_shown");
    expect(line.Count).toBe(1);
    const metric = line._aws.CloudWatchMetrics[0]!;
    expect(metric.Namespace).toBe("Bookshelf/WebEvents");
    expect(metric.Dimensions).toEqual([["event"]]);
    expect(metric.Metrics).toEqual([{ Name: "Count", Unit: "Count" }]);
  });

  it("includes props as a nested field (not a metric dimension)", () => {
    emitMetric("hint_link_clicked", { page: "shelf" });
    const line = JSON.parse(writes[0]!) as {
      _aws: { CloudWatchMetrics: { Dimensions: string[][] }[] };
      props?: Record<string, unknown>;
    };
    expect(line.props).toEqual({ page: "shelf" });
    // props must never widen metric cardinality.
    expect(line._aws.CloudWatchMetrics[0]!.Dimensions).toEqual([["event"]]);
  });

  it("omits props when none are given", () => {
    emitMetric("hint_dismissed");
    expect(writes[0]).not.toContain("props");
  });

  it("never throws and writes nothing if serialization fails (best-effort)", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular; // JSON.stringify throws on a circular ref
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => emitMetric("hint_shown", circular as never)).not.toThrow();
    expect(writes).toHaveLength(0);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
