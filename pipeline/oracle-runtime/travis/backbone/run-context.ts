// A-04 T010: what every `backbone` verb is handed (contracts/seams.md RunContext).
import { createSourceClient, type SourceClient } from "../lib/source-client.js";
import { checkDiskSpace, MIN_FREE_BYTES } from "./disk-guard.js";
import type { RestateIngressClient } from "./restate-client.js";

export interface RunContext {
  /** Default job id of this invocation, `travis-a04-<yyyymmddhhmmss>`; verbs may mint their own with jobIdFor. */
  jobId: string;
  /** The run's as-of ISO date, fixed once per run; never now() inside a derivation. */
  asOf: () => string;
  ingress: RestateIngressClient;
  /** Throws DiskGuardError below `minFreeBytes` (default 5 GiB) free; the CLI exits 4. */
  diskGuard(minFreeBytes?: number): void;
  /** The one HTTP boundary (User-Agent, HOST_POLICY, backoff, StopOnBlocked). */
  sourceClient(): SourceClient;
  /** One stdout line: counts and paths only (the CLI scrubs secrets on the way out). */
  print(line: string): void;
  /** Mints `travis-a04-[kind-]<yyyymmddhhmmss>` from this run's clock. */
  jobIdFor(kind: string | null): string;
}

const stamp = (d: Date): string => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);

export function jobIdFor(kind: string | null, at: Date): string {
  const id = `travis-a04-${kind === null ? "" : `${kind}-`}${stamp(at)}`;
  if (!/^travis-a04-[a-z0-9-]+$/.test(id)) throw new Error(`invalid job id kind: ${kind ?? ""}`);
  return id;
}

export interface RunContextDeps {
  ingress: RestateIngressClient;
  now: () => Date;
  freeBytes: () => number;
  print: (line: string) => void;
  sourceClient?: () => SourceClient;
}

export function createRunContext(deps: RunContextDeps): RunContext {
  const startedAt = deps.now();
  let asOf: string | null = null;
  let client: SourceClient | null = null;
  return {
    jobId: jobIdFor(null, startedAt),
    asOf: () => (asOf ??= deps.now().toISOString().slice(0, 10)),
    ingress: deps.ingress,
    diskGuard: (minFreeBytes = MIN_FREE_BYTES) => checkDiskSpace(deps.freeBytes(), minFreeBytes),
    sourceClient: () =>
      (client ??= deps.sourceClient?.() ?? createSourceClient({ hostSpacing: true })),
    print: deps.print,
    jobIdFor: (kind) => jobIdFor(kind, startedAt),
  };
}
