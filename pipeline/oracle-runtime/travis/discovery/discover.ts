// Operator command `npm --prefix pipeline/oracle-runtime run discover` (contracts/cli.md).
//
// Starts the TravisDiscovery workflow with the run id TRAVIS_DISCOVERY_RUN_ID (required: no
// default, so a superseded run is never addressed by accident, CR-3) through the local
// Restate ingress (RESTATE_INGRESS_URL, default http://localhost:8080) with a one-way send,
// then polls the workflow's shared `status` handler and prints each state
// change. It stops when the run has finished (READY, or WAITING_HUMAN with documented
// blockers) or is waiting on a human, prints the run state, the blockers with their next
// step and the validator result, and exits 0. It exits 1 when the stack cannot be reached,
// the ingress refuses the run, or the run is still discovering after DISCOVER_MAX_HOURS
// (default 9 h: SC-006 allows 8 h of discovery).
//
// A Restate workflow runs once per id: a second `discover` with the same id shows the
// existing run's state instead of starting a new one.
//
// Before a NEW run is sent (exit 2, nothing sent, when refused):
// - CR-3: the committed catalog must be one the new run may write (`catalogWriteRefusal`:
//   no offline amendments or approved exceptions, not another run's); otherwise the run
//   would probe every source and then be refused at the write;
// - OR-B1: the egress country is read from the Cloudflare trace (never the IP) and checked
//   against ORACLE_EXPECT_EGRESS when set; the run records it (`discovery_egress`).
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { redact } from "../lib/log.js";
import { checkEgress, type EgressCheck } from "../lib/egress.js";
import type { Catalog } from "./catalog.schema.js";
import { CATALOG_REL_PATH } from "./run-validator.js";
import { WORKFLOW_NAME } from "./workflow.js";
import { DEFAULT_INGRESS_URL, RUN_ID_ENV } from "./resolve.js";
import { catalogWriteRefusal, readCatalogIfPresent } from "./write-catalog.js";

const DEFAULT_POLL_MS = 10_000;
const DEFAULT_MAX_HOURS = 9;
const MAX_STATUS_FAILURES = 6;

const StatusSchema = z.looseObject({
  run_id: z.string(),
  state: z.enum(["DISCOVERING", "WAITING_HUMAN", "READY"]),
  steps: z.array(z.looseObject({ key: z.string() })),
  blockers: z.array(
    z.looseObject({
      source_key: z.string(),
      next_step: z.string(),
      waiting: z.boolean(),
      resolution: z.string().nullable(),
      receipt: z.looseObject({ status: z.number().nullable(), outcome: z.string() }),
    }),
  ),
  validator: z.looseObject({ exit_code: z.number(), report_path: z.string() }).nullable(),
  waiting_human_hours: z.number(),
  waiting_since: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  egress: z.looseObject({ country: z.string() }).nullable().optional(),
});
type Status = z.infer<typeof StatusSchema>;

const SendSchema = z.looseObject({ status: z.string().optional() });

export interface DiscoverCliDeps {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  env?: Record<string, string | undefined>;
  out?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** OR-B1 egress check (default: Cloudflare trace through `fetch`). */
  egress?: (reference: string | null) => Promise<EgressCheck>;
  /** The committed catalog (default pipeline/docs/travis-sources.yaml; null when none). */
  readCatalog?: () => Catalog | null;
  /** Wall-clock time for the catalog guard (default new Date()). */
  clock?: () => Date;
}

/** The run has nothing more to do without a human, or has finished. */
export function isSettled(status: Status): boolean {
  if (status.completed_at) return true;
  return status.state === "WAITING_HUMAN" && Boolean(status.waiting_since);
}

function summary(status: Status): string[] {
  const lines = [
    `discover: run ${status.run_id} state ${status.state}; ${status.steps.length} journaled probe steps; waiting_human_hours ${status.waiting_human_hours}`,
    `discover: catalog ${CATALOG_REL_PATH}`,
  ];
  if (status.validator) {
    lines.push(
      `discover: validator exit ${status.validator.exit_code}; report ${status.validator.report_path}`,
    );
  }
  for (const b of status.blockers) {
    const http = b.receipt.status === null ? "no HTTP status" : `HTTP ${b.receipt.status}`;
    const state = b.waiting ? "waiting for a human" : `resolved ${b.resolution ?? "?"}`;
    lines.push(
      `discover: blocker ${b.source_key} (${b.receipt.outcome}, ${http}, ${state}): ${b.next_step}`,
    );
  }
  if (status.state === "READY") {
    lines.push("discover: READY; seed is never started automatically (A-04 does)");
  }
  return lines;
}

export async function main(deps: DiscoverCliDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out =
    deps.out ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const say = (line: string): void => out(redact(line));
  const fetchImpl = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Date.now());

  const ingress = (env.RESTATE_INGRESS_URL ?? DEFAULT_INGRESS_URL).replace(/\/+$/, "");
  const runId = (env[RUN_ID_ENV] ?? "").trim();
  if (runId === "") {
    say(
      `discover: refused: set ${RUN_ID_ENV} to the run id (there is no default run id; a new id starts a new run)`,
    );
    return 2;
  }
  const pollMs = Number(env.DISCOVER_POLL_MS ?? DEFAULT_POLL_MS);
  const maxMs = Number(env.DISCOVER_MAX_HOURS ?? DEFAULT_MAX_HOURS) * 3_600_000;
  const base = `${ingress}/${WORKFLOW_NAME}/${encodeURIComponent(runId)}`;

  // Does this run exist already? A new run gets the catalog guard and the egress check.
  let existing: Status | null;
  try {
    const res = await fetchImpl(`${base}/status`, { method: "POST" });
    const parsed = res.ok ? StatusSchema.nullable().safeParse(await res.json()) : null;
    existing = parsed?.success ? parsed.data : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say(
      `discover: not started: Restate ingress unreachable (${message}); is the local stack up and the deployment registered?`,
    );
    return 1;
  }
  let body: string | undefined;
  if (existing === null) {
    try {
      const onDisk = (deps.readCatalog ?? (() => readCatalogIfPresent()))();
      const snapshot = (deps.clock ?? (() => new Date()))().toISOString();
      const refusal =
        onDisk === null
          ? null
          : catalogWriteRefusal(onDisk, {
              ...onDisk,
              amendments: undefined,
              approved_exceptions: undefined,
              discovery_run_id: runId,
              snapshot_time: snapshot,
            });
      if (refusal !== null) {
        say(`discover: refused: a new run could not write the catalog: ${refusal}`);
        return 2;
      }
    } catch (error) {
      const message = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
      say(`discover: refused: the committed catalog is unreadable (${message})`);
      return 2;
    }
    const check = await (
      deps.egress ??
      ((reference: string | null) =>
        checkEgress({ fetch: fetchImpl, env, reference, requireReference: false }))
    )(null);
    if (!check.ok) {
      say(`discover: refused: ${check.reason}`);
      return 2;
    }
    say(`discover: egress country ${check.egress.country} (recorded with the run)`);
    body = JSON.stringify({ egress: check.egress });
  }

  let sent: Response;
  try {
    sent = await fetchImpl(`${base}/run/send`, {
      method: "POST",
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say(
      `discover: not started: Restate ingress unreachable (${message}); is the local stack up and the deployment registered?`,
    );
    return 1;
  }
  if (!sent.ok) {
    say(`discover: not started: ingress answered HTTP ${sent.status} for run ${runId}`);
    return 1;
  }
  const accepted = SendSchema.safeParse(await sent.json().catch(() => ({})));
  if (accepted.success && accepted.data.status === "PreviouslyAccepted") {
    say(
      `discover: run ${runId} already exists; showing its state (set TRAVIS_DISCOVERY_RUN_ID for a new run)`,
    );
  } else {
    say(`discover: started ${WORKFLOW_NAME} run ${runId}`);
  }

  const started = now();
  let lastState = "";
  let failures = 0;
  for (;;) {
    let status: Status | null = null;
    try {
      const res = await fetchImpl(`${base}/status`, { method: "POST" });
      const parsed = res.ok ? StatusSchema.nullable().safeParse(await res.json()) : null;
      if (!parsed || !parsed.success) throw new Error(`status HTTP ${res.status}`);
      status = parsed.data;
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= MAX_STATUS_FAILURES) {
        const message = error instanceof Error ? error.message : String(error);
        say(
          `discover: status unavailable ${failures} times in a row (${message}); the run continues in Restate`,
        );
        return 1;
      }
    }
    if (status) {
      if (status.state !== lastState) {
        say(`discover: state ${status.state} after ${status.steps.length} steps`);
        lastState = status.state;
      }
      if (isSettled(status)) {
        for (const line of summary(status)) say(line);
        return 0;
      }
    }
    if (now() - started > maxMs) {
      say(
        `discover: still ${lastState || "starting"} after ${maxMs / 3_600_000} h; the run continues in Restate`,
      );
      return 1;
    }
    await sleep(pollMs);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
