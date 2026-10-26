// T036: operator command `npm --prefix pipeline/oracle-runtime run resolve -- <source_key>
// captured|still-blocked` (FR-006f, contracts/cli.md).
//
// Sends the resolution to the TravisDiscovery workflow's shared `resolve` handler through
// the local Restate ingress. The handler completes the waiting source's durable promise;
// the running workflow then re-probes that source once (`captured`) or documents the
// blocker (`still-blocked`).
//
// Exit 0 when the resolution is recorded; exit 1 when the source is not waiting, the
// arguments are invalid, or the stack cannot be reached (nothing was recorded). Exit 2
// (refused, nothing sent) when:
// - CR-3 / OR-M1: TRAVIS_DISCOVERY_RUN_ID is not set (there is no default run id), or it is
//   not the run that wrote the committed catalog (`discovery_run_id`): a superseded run
//   would re-assemble the catalog from its own journal;
// - CR2-1 / OR-N5: the workflow could not write the catalog after this resolution: both
//   outcomes re-publish the catalog, and its write guard (`catalogWriteRefusal`) refuses a
//   catalog that offline commands amended. The same guard runs here first, so no source is
//   re-probed (and no run is left dead) for a result that could never be written;
// - T056 / AC-6: the outcome is `captured` and the run status shows the source waiting on a
//   receipt that stopped on HTTP 403, a bot challenge or a WAF block: a blocked source is
//   never re-probed, only `still-blocked` is allowed (the workflow handler refuses too);
// - OR-B1: the outcome is `captured` (the workflow then re-probes the source) and the
//   egress country differs from the run's recorded egress or ORACLE_EXPECT_EGRESS.
//
// Environment: RESTATE_INGRESS_URL (default http://localhost:8080), TRAVIS_DISCOVERY_RUN_ID
// (required) and ORACLE_EXPECT_EGRESS (optional).
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { checkEgress, type EgressCheck } from "../lib/egress.js";
import { redact } from "../lib/log.js";
import { SOURCE_KEYS, type Catalog } from "./catalog.schema.js";
import {
  blockedReprobeReason,
  ResolveRequestSchema,
  stoppedOnBlock,
  WORKFLOW_NAME,
  type StopReceipt,
} from "./workflow.js";
import { catalogWriteRefusal, readCatalogIfPresent } from "./write-catalog.js";

export const DEFAULT_INGRESS_URL = "http://localhost:8080";
/** The workflow key (run id) every operator command must name explicitly. */
export const RUN_ID_ENV = "TRAVIS_DISCOVERY_RUN_ID";

const RunStatusSchema = z
  .looseObject({
    egress: z.looseObject({ country: z.string() }).nullable().optional(),
    blockers: z
      .array(
        z.looseObject({
          source_key: z.string(),
          waiting: z.boolean(),
          receipt: z.looseObject({
            status: z.number().nullable(),
            blocked_reason: z.enum(["http-403", "challenge", "timeout"]).nullable().optional(),
            challenge_signal: z.string().optional(),
            stop_evidence: z
              .looseObject({
                headers: z.record(z.string(), z.string()),
                excerpt_base64: z.string(),
                body_bytes: z.number(),
              })
              .optional(),
          }),
        }),
      )
      .optional(),
  })
  .nullable();

/** Why `runId` may not be resolved against the committed catalog, or null. */
export function runMismatch(catalog: Catalog | null, runId: string): string | null {
  if (catalog === null) return null;
  const writer = catalog.discovery_run_id;
  if (writer === undefined) {
    return "the committed catalog records no discovery_run_id, so the run that wrote it is unknown";
  }
  if (writer !== runId) {
    return `run ${runId} did not write the committed catalog (run ${writer} did); resolving it would re-assemble the catalog from a superseded journal`;
  }
  return null;
}

/**
 * CR2-1 / OR-N5: why the workflow would refuse to write the catalog this resolution makes,
 * or null. The workflow re-assembles the catalog for the same run at a later snapshot, so
 * the guard is applied to that shape: the catalog on disk stamped `now`.
 */
export function resolutionWriteRefusal(catalog: Catalog | null, now: Date): string | null {
  if (catalog === null) return null;
  return catalogWriteRefusal(catalog, { ...catalog, snapshot_time: now.toISOString() });
}

const USAGE = `usage: npm --prefix pipeline/oracle-runtime run resolve -- <source_key> captured|still-blocked (source_key: ${SOURCE_KEYS.join(", ")})`;

const ResolveResponseSchema = z.union([
  z.object({ accepted: z.literal(true), promise: z.string() }),
  z.object({ accepted: z.literal(false), reason: z.string() }),
]);

export interface ResolveCliDeps {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  env?: Record<string, string | undefined>;
  out?: (line: string) => void;
  readCatalog?: () => Catalog | null;
  egress?: (reference: string | null) => Promise<EgressCheck>;
  now?: () => Date;
}

export async function main(argv: readonly string[], deps: ResolveCliDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out =
    deps.out ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const fetchImpl = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const say = (line: string): void => out(redact(line));

  const parsed = ResolveRequestSchema.safeParse({ source_key: argv[0], outcome: argv[1] });
  if (argv.length !== 2 || !parsed.success) {
    say(`resolve: not recorded: invalid arguments; ${USAGE}`);
    return 1;
  }
  const request = parsed.data;
  const ingress = (env.RESTATE_INGRESS_URL ?? DEFAULT_INGRESS_URL).replace(/\/+$/, "");
  const runId = (env[RUN_ID_ENV] ?? "").trim();
  if (runId === "") {
    say(`resolve: refused: set ${RUN_ID_ENV} to the run that wrote the catalog (no default)`);
    return 2;
  }
  let mismatch: string | null;
  try {
    const onDisk = (deps.readCatalog ?? (() => readCatalogIfPresent()))();
    mismatch =
      runMismatch(onDisk, runId) ??
      resolutionWriteRefusal(onDisk, (deps.now ?? (() => new Date()))());
  } catch {
    mismatch = "the committed catalog is unreadable";
  }
  if (mismatch !== null) {
    say(`resolve: refused: ${mismatch}; nothing sent`);
    return 2;
  }
  const base = `${ingress}/${WORKFLOW_NAME}/${encodeURIComponent(runId)}`;
  const url = `${base}/resolve`;

  if (request.outcome === "captured") {
    // The workflow re-probes the source: the same egress as the run, or nothing (OR-B1).
    let reference: string | null;
    let receipt: StopReceipt | null = null;
    try {
      const res = await fetchImpl(`${base}/status`, { method: "POST" });
      const parsed = res.ok ? RunStatusSchema.safeParse(await res.json()) : null;
      const status = parsed?.success ? parsed.data : null;
      reference = status?.egress?.country ?? null;
      const blocker = status?.blockers?.find(
        (b) => b.source_key === request.source_key && b.waiting,
      );
      if (blocker) receipt = blocker.receipt;
    } catch {
      reference = null;
    }
    // T056 / AC-6: a source stopped by 403, a challenge or a WAF is never re-probed.
    if (receipt !== null && stoppedOnBlock(receipt)) {
      say(`resolve: refused: ${blockedReprobeReason(request.source_key)}; nothing sent`);
      return 2;
    }
    const check = await (
      deps.egress ??
      ((ref: string | null) =>
        checkEgress({ fetch: fetchImpl, env, reference: ref, requireReference: true }))
    )(reference);
    if (!check.ok) {
      say(`resolve: refused: ${check.reason}`);
      return 2;
    }
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say(`resolve: not recorded: Restate ingress unreachable (${message}); is the local stack up?`);
    return 1;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const result = ResolveResponseSchema.safeParse(body);
  if (!response.ok || !result.success) {
    say(`resolve: not recorded: ingress answered HTTP ${response.status} for run ${runId}`);
    return 1;
  }
  if (!result.data.accepted) {
    say(`resolve: not recorded: ${result.data.reason}`);
    return 1;
  }
  say(
    `resolve: recorded ${request.source_key} ${request.outcome} for run ${runId} (${result.data.promise})`,
  );
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
