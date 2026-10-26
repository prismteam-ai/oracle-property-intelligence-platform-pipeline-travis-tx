// The bind guard (CR-A-03 F-1, defence): before a manifest goes public, bind it against the
// LOCAL tables with the real query-core bindManifest, run listRoofingPermitsSql() and
// runSummarySql(), and require the roofing-permit rows to equal coverage.permits_emitted. A
// manifest the web engine or the Lambda cannot bind (for example one with no travis-places
// profile) is refused here with BindGuardError, before the manifest add and before runs/ is
// written: published CIDs never change and runs/index.json is append-only.
//
// No engine import here (ARD § 4, AD-19: DuckDB stays out of pipeline/publish/src). The binder
// that drives query-core over a node DuckDB is scripts/local-bind.ts, loaded lazily by
// loadLocalBinder() the way cli.ts loads the CID-copy uploader; tests inject their own.
/** What a local bind of one manifest returned. */
export interface BoundRows {
  /** meta.run.run_id (runSummarySql). */
  runId: string;
  /** meta.run.manifest_cid: the raw-leaves CIDv1 of the bound bytes (runSummarySql). */
  manifestCid: string;
  /** Rows of listRoofingPermitsSql(). */
  permitRows: number;
  /** roofing_permit_rows of runSummarySql(). */
  roofingPermitRows: number;
  /** Relations bound (emitted plus empty typed required tables). */
  tables: number;
}

/** Binds `manifestBytes` over the parts under `runDir` (artifact names are relative to it). */
export type LocalBinder = (input: {
  manifestBytes: Uint8Array;
  runDir: string;
}) => Promise<BoundRows>;

/** The built manifest does not bind against its local tables, or binds to other rows. */
export class BindGuardError extends Error {
  override name = "BindGuardError";
  constructor(detail: string) {
    super(`BindGuardError: ${detail}`);
  }
}

/** The query-core + node DuckDB binder (scripts/local-bind.ts), imported only when used. */
export async function loadLocalBinder(): Promise<LocalBinder> {
  const { localBind } = await import("../scripts/local-bind.js");
  return localBind;
}

/**
 * Binds the built manifest against the local tables of `runDir` and checks what the views
 * return: the run id and manifest CID are the manifest's, and the roofing-permit rows (the list
 * query and the summary count) equal coverage.permits_emitted. Throws BindGuardError otherwise.
 */
export async function assertBindable(
  built: {
    bytes: Uint8Array;
    cid: string;
    /** The parts of the RunManifestV1 the check reads. */
    manifest: { runId: string; coverage: Readonly<Record<string, { count: number }>> };
  },
  runDir: string,
  bind?: LocalBinder,
): Promise<BoundRows> {
  const binder = bind ?? (await loadLocalBinder());
  let bound: BoundRows;
  try {
    bound = await binder({ manifestBytes: built.bytes, runDir });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BindGuardError(
      `the built manifest does not bind against the local tables (web and API would fail): ${detail}`,
    );
  }
  const expected = built.manifest.coverage.permits_emitted?.count;
  if (expected === undefined)
    throw new BindGuardError("the built manifest has no coverage.permits_emitted");
  const problems: string[] = [];
  if (bound.runId !== built.manifest.runId)
    problems.push(`run_id ${bound.runId} bound, ${built.manifest.runId} built`);
  if (bound.manifestCid !== built.cid)
    problems.push(`manifest_cid ${bound.manifestCid} bound, ${built.cid} built`);
  if (bound.permitRows !== expected)
    problems.push(
      `${bound.permitRows} roofing permit rows bound, coverage.permits_emitted ${expected}`,
    );
  if (bound.roofingPermitRows !== bound.permitRows)
    problems.push(
      `runSummarySql counts ${bound.roofingPermitRows} roofing permit rows, the list returns ${bound.permitRows}`,
    );
  if (problems.length > 0) throw new BindGuardError(problems.join("; "));
  return bound;
}
