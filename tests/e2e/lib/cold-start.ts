// A-03-TC-NF-04 (NFR-004 "cold start incl. DuckDB init < 3 s"), ERR-19: the cold start of one
// request, read from its X-Ray trace only. On the `AWS::Lambda::Function` segment:
// - init: the `Initialization` (or `Init`) subsegment — node, the bundle and module scope;
// - handler: the `Invocation` subsegment when Lambda emits one, else the Powertools handler
//   subsegment (`## index.handler`, captureLambdaHandler) — the request including the DuckDB
//   open and the view bind of the first query.
// No REPORT-log fallback: the function's SystemLogLevel is WARN by design, so Lambda writes no
// platform.report line. A phase that is absent or still open is null, never estimated.
import type { XraySegment } from "./ops.js";

export const LAMBDA_FUNCTION_ORIGIN = "AWS::Lambda::Function";
export const INIT_NAMES: readonly string[] = ["Initialization", "Init"];
export const INVOCATION_NAME = "Invocation";
/** Powertools Tracer names the handler subsegment `## <_HANDLER>`. */
export const POWERTOOLS_HANDLER_PREFIX = "## ";

export interface ColdStartPhases {
  readonly functionSegment: XraySegment | undefined;
  readonly initName: string | null;
  readonly initMs: number | null;
  readonly handlerName: string | null;
  readonly handlerMs: number | null;
  /** initMs + handlerMs, or null while either is missing. */
  readonly coldStartMs: number | null;
}

const closedMs = (s: XraySegment | undefined): number | null =>
  s?.end_time === undefined ? null : Math.round((s.end_time - s.start_time) * 1000);

export function coldStartPhases(segments: readonly XraySegment[]): ColdStartPhases {
  const fn = segments.find((s) => s.origin === LAMBDA_FUNCTION_ORIGIN);
  const children = fn?.subsegments ?? [];
  const init = INIT_NAMES.map((n) => children.find((s) => s.name === n)).find(Boolean);
  const handler =
    children.find((s) => s.name === INVOCATION_NAME) ??
    children.find((s) => s.name.startsWith(POWERTOOLS_HANDLER_PREFIX));
  const initMs = closedMs(init);
  const handlerMs = closedMs(handler);
  return {
    functionSegment: fn,
    initName: init?.name ?? null,
    initMs,
    handlerName: handler?.name ?? null,
    handlerMs,
    coldStartMs: initMs === null || handlerMs === null ? null : initMs + handlerMs,
  };
}
