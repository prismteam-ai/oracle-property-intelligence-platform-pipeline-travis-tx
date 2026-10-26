// ERR-19 / A-03-TC-NF-04 at unit level (Vitest, `pnpm --filter @countylens/e2e test`): the cold
// start is read from X-Ray only. The function is configured with SystemLogLevel WARN, so Lambda
// writes no platform.report line and the REPORT-log fallback never had data; the handler time is
// the `AWS::Lambda::Function` segment's `Invocation` subsegment when present, else the Powertools
// handler subsegment (`## index.handler`), plus its `Init` / `Initialization` subsegment.
import { describe, expect, it } from "vitest";
import { coldStartPhases, LAMBDA_FUNCTION_ORIGIN } from "./cold-start.js";
import type { XraySegment } from "./ops.js";

const seg = (name: string, start: number, ms: number, extra: Partial<XraySegment> = {}) => ({
  id: name,
  name,
  start_time: start,
  end_time: start + ms / 1000,
  ...extra,
});

/** The shape of hosted trace 1-6ad8e594-2137ace954e063076e0737a0 (ERR-19), durations rounded. */
const HOSTED_COLD: XraySegment[] = [
  seg("countylens-api", 1792599444.542, 6662),
  seg("countylens-api", 1792599445.5578, 5647, {
    origin: LAMBDA_FUNCTION_ORIGIN,
    subsegments: [
      seg("## index.handler", 1792599445.562, 5637, {
        subsegments: [seg("duckdb.query", 1792599445.566, 5629)],
      }),
      seg("Overhead", 1792599451.203, 0),
      seg("Init", 1792599444.8607, 693),
    ],
  }),
];

describe("coldStartPhases (ERR-19, TC-NF-04)", () => {
  it("reads Init + the Powertools handler subsegment of the function segment (the hosted trace shape)", () => {
    const phases = coldStartPhases(HOSTED_COLD);
    expect(phases).toMatchObject({
      initName: "Init",
      initMs: 693,
      handlerName: "## index.handler",
      handlerMs: 5637,
      coldStartMs: 693 + 5637,
    });
    expect(phases.functionSegment?.origin).toBe(LAMBDA_FUNCTION_ORIGIN);
  });

  it("prefers Invocation and Initialization when Lambda emits them", () => {
    const fn = seg("countylens-api", 100, 1500, {
      origin: LAMBDA_FUNCTION_ORIGIN,
      subsegments: [
        seg("Initialization", 99, 600),
        seg("Invocation", 100, 900, { subsegments: [seg("## index.handler", 100, 880)] }),
        seg("Overhead", 101, 1),
      ],
    });
    expect(coldStartPhases([fn])).toMatchObject({
      initName: "Initialization",
      initMs: 600,
      handlerName: "Invocation",
      handlerMs: 900,
      coldStartMs: 1500,
    });
  });

  it("reports null (never a guessed number) while a phase is missing or still open", () => {
    expect(coldStartPhases([])).toMatchObject({
      functionSegment: undefined,
      initMs: null,
      handlerMs: null,
      coldStartMs: null,
    });
    const warm = seg("countylens-api", 1, 20, {
      origin: LAMBDA_FUNCTION_ORIGIN,
      subsegments: [seg("## index.handler", 1, 19)],
    });
    expect(coldStartPhases([warm])).toMatchObject({
      initMs: null,
      handlerMs: 19,
      coldStartMs: null,
    });
    const open = seg("countylens-api", 1, 20, {
      origin: LAMBDA_FUNCTION_ORIGIN,
      subsegments: [seg("Init", 0, 500), { id: "h", name: "## index.handler", start_time: 1 }],
    });
    expect(coldStartPhases([open])).toMatchObject({
      initMs: 500,
      handlerMs: null,
      coldStartMs: null,
    });
  });

  it("ignores subsegments of other segments (the API Gateway or client segment)", () => {
    const other = seg("countylens-api", 1, 20, {
      subsegments: [seg("Init", 0, 500), seg("## index.handler", 1, 10)],
    });
    expect(coldStartPhases([other]).functionSegment).toBeUndefined();
  });
});
