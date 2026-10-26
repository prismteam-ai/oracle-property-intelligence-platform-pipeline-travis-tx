// The pre-publish identity gate as an importable module. It binds the manifest about to be
// published with query-core's bindManifest (the code the browser runs) and fails unless every
// Property Improvement property is a published County property (same CID), meta.permit is not
// empty, and v_roofing_permit returns the manifest's permits_emitted count. Run 1 failed exactly
// this: 0 of 17,387 permits joined (property.json differed between groups).
//
// Local table parts are used only when their SHA-256 matches the manifest; otherwise (and always
// with `remoteOnly`) a part is read from the CID copy, the bytes the app reads. Read-only: no
// upload, no database. The script scripts/identity-gate.ts is a thin CLI over runIdentityGate.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bindManifest, type QueryEngine, type Row } from "@countylens/query-core";
import { cidOfBytes } from "./cid.js";

export interface IdentityGateOptions {
  /** Path of the manifest; read when `manifestBytes` is not given. */
  manifestPath?: string;
  /** The exact manifest bytes to bind (the driver passes the bytes whose CID it publishes). */
  manifestBytes?: Uint8Array;
  /** Host of the CID copy, e.g. d2xsqoqv09bd0q.cloudfront.net. */
  copyHost: string;
  /** Directory the manifest's artifact names resolve against for local parts. */
  root: string;
  expectPermits?: number | null;
  pids?: readonly string[] | null;
  /** Never read a local part: bind every table part from the CID copy. */
  remoteOnly?: boolean;
  /**
   * The previous run's manifest (the one previousManifestCid names). When given, the gate also
   * binds it in a second engine and fails unless every previous property_cid and permit_cid
   * still exists in this run with the same request_identifier (see compareIdentity).
   */
  previous?: { manifestBytes: Uint8Array; root: string } | null;
  /** Accept a changed cid when its request_identifier survives; the old -> new map is reported. */
  allowCidMap?: boolean;
  /** Opens the query engine (AD-19: DuckDB is wired by the caller, scripts/duckdb-engine.ts). */
  openEngine: () => Promise<OpenedEngine>;
  /**
   * Longest a manifest bind (remote part reads included) may take before the gate fails closed
   * instead of hanging (A11-16). Default 30 minutes.
   */
  bindTimeoutMs?: number;
}

export interface OpenedEngine {
  engine: QueryEngine;
  close: () => void;
}

export interface IdentityGateSummary {
  manifest: string;
  v_roofing_permit: number;
  meta_permit: number;
  permits_emitted: number | null;
  permit_side_properties: number;
  unmatched_properties: number;
  pids_checked: number;
  pids_unmatched: number;
  result: "PASS" | "FAIL";
  failures: string[];
  /** Present when a previous manifest was compared. */
  previous?: IdentityComparison;
}

/** The (cid, request_identifier) pairs the views expose: what Task B keys leads on. */
export interface IdentitySet {
  /** v_property: property_cid -> request_identifier */
  properties: ReadonlyMap<string, string | null>;
  /** v_roofing_permit: permit_cid -> request_identifier */
  permits: ReadonlyMap<string, string | null>;
}

export interface IdentityComparison {
  previous_properties: number;
  previous_permits: number;
  missing_properties: number;
  missing_permits: number;
  /** Same cid, different request_identifier. */
  changed_identifier: number;
  /** Missing cids whose request_identifier is present under a new cid (old -> new), first 50. */
  remapped: number;
  cid_map: { kind: "property" | "permit"; old: string; new: string }[];
  /** First 20 old cids that have no successor at all. */
  lost: string[];
}

/**
 * Pure check: every previous cid must still exist with the same request_identifier. A missing cid
 * is tolerated only with `allowCidMap` and only when its request_identifier exists under a new
 * cid; the map is returned. Anything else is a failure line.
 */
export function compareIdentity(
  previous: IdentitySet,
  current: IdentitySet,
  allowCidMap: boolean,
): { comparison: IdentityComparison; failures: string[] } {
  const map: IdentityComparison["cid_map"] = [];
  const lost: string[] = [];
  const missing = { property: 0, permit: 0 };
  let changed = 0;
  let remapped = 0;
  const check = (
    kind: "property" | "permit",
    before: ReadonlyMap<string, string | null>,
    after: ReadonlyMap<string, string | null>,
  ): void => {
    const byRid = new Map<string, string>();
    for (const [cid, rid] of after) if (rid !== null && !byRid.has(rid)) byRid.set(rid, cid);
    for (const [cid, rid] of before) {
      if (!after.has(cid)) {
        missing[kind] += 1;
        const successor = rid === null ? undefined : byRid.get(rid);
        if (successor !== undefined) {
          remapped += 1;
          if (map.length < 50) map.push({ kind, old: cid, new: successor });
        } else if (lost.length < 20) lost.push(cid);
        continue;
      }
      if (after.get(cid) !== rid) changed += 1;
    }
  };
  check("property", previous.properties, current.properties);
  check("permit", previous.permits, current.permits);
  const comparison: IdentityComparison = {
    previous_properties: previous.properties.size,
    previous_permits: previous.permits.size,
    missing_properties: missing.property,
    missing_permits: missing.permit,
    changed_identifier: changed,
    remapped,
    cid_map: map,
    lost,
  };
  const failures: string[] = [];
  const totalMissing = missing.property + missing.permit;
  if (changed > 0)
    failures.push(`${changed} previous cids exist with a different request_identifier`);
  if (totalMissing > 0 && !allowCidMap)
    failures.push(
      `${missing.property} previous property_cids and ${missing.permit} permit_cids are missing from this run (re-hashed or dropped); pass the old -> new map explicitly (allowCidMap) or keep the records unchanged`,
    );
  if (totalMissing > 0 && allowCidMap && totalMissing !== remapped)
    failures.push(
      `${totalMissing - remapped} previous cids have no successor with the same request_identifier`,
    );
  return { comparison, failures };
}

/** Reads the identity pairs from a bound run (the views the app and Task B read). */
export async function collectIdentity(engine: QueryEngine): Promise<IdentitySet> {
  const pairs = async (sql: string): Promise<Map<string, string | null>> => {
    const out = new Map<string, string | null>();
    for (const r of await engine.all(sql))
      out.set(
        String(r["cid"]),
        r["rid"] === null || r["rid"] === undefined ? null : String(r["rid"]),
      );
    return out;
  };
  return {
    properties: await pairs(
      "SELECT property_cid AS cid, request_identifier AS rid FROM v_property",
    ),
    permits: await pairs(
      "SELECT permit_cid AS cid, request_identifier AS rid FROM v_roofing_permit",
    ),
  };
}

/**
 * The previous manifest's bytes: runs/index.json names its run, runs/<runId>/manifest.json holds
 * the bytes, and their CID must equal `previousManifestCid` (else it is not that manifest).
 */
export async function loadPreviousManifest(
  repoRoot: string,
  previousManifestCid: string,
): Promise<Buffer> {
  const index = JSON.parse(readFileSync(join(repoRoot, "runs", "index.json"), "utf8")) as {
    runs: { runId: string; manifestCid: string }[];
  };
  const entry = index.runs.find((r) => r.manifestCid === previousManifestCid);
  if (entry === undefined)
    throw new Error(`previous manifest ${previousManifestCid} is not in runs/index.json`);
  const bytes = readFileSync(join(repoRoot, "runs", entry.runId, "manifest.json"));
  const cid = await cidOfBytes(bytes);
  if (cid !== previousManifestCid)
    throw new Error(`runs/${entry.runId}/manifest.json has CID ${cid}, not ${previousManifestCid}`);
  return bytes;
}

export type IdentityGate = (
  options: Pick<IdentityGateOptions, "remoteOnly">,
) => Promise<IdentityGateSummary>;

const count = (rows: Row[]): number => Number(rows[0]?.["n"] ?? -1);

const sha256File = (path: string): Promise<string> =>
  new Promise((done, fail) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", fail)
      .on("end", () => done(hash.digest("hex")));
  });

/** Default longest a manifest bind may take (A11-16: a stalled remote part read must not hang the gate). */
export const BIND_TIMEOUT_MS_DEFAULT = 30 * 60 * 1000;

/** Rejects with `what timed out after N ms` when `work` has not settled in `ms` (the timer is cleared). */
export async function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Binds a manifest's table parts into `engine`. A local part is read only after its bytes hash to
 * the manifest's SHA-256 (a file changed after the manifest was built must not pass the gate);
 * otherwise a part comes from the CID copy.
 */
async function bindParts(
  bytes: Buffer,
  artifacts: { name: string; kind: string; sha256: string }[],
  root: string,
  copyHost: string,
  remoteOnly: boolean,
  engine: QueryEngine,
  failures: string[],
  bindTimeoutMs: number,
): Promise<void> {
  const localOk = new Set<string>();
  if (!remoteOnly) {
    for (const a of artifacts.filter((x) => x.kind === "table")) {
      const local = resolve(root, a.name);
      if (!existsSync(local)) continue;
      const digest = await sha256File(local);
      if (digest === a.sha256) localOk.add(a.name);
      else failures.push(`local part ${a.name} hashes to ${digest}, manifest says ${a.sha256}`);
    }
  }
  const partUrl = ({ name, cid }: { name: string; cid: string }): string =>
    localOk.has(name) ? resolve(root, name) : `https://${copyHost}/${cid}`;
  await withDeadline(
    bindManifest(bytes, "", engine, { partUrl }),
    bindTimeoutMs,
    `binding the manifest from ${copyHost}`,
  );
}

export async function runIdentityGate(options: IdentityGateOptions): Promise<IdentityGateSummary> {
  const { copyHost, root } = options;
  const expectPermits = options.expectPermits ?? null;
  const pids = options.pids ?? null;
  const remoteOnly = options.remoteOnly === true;
  const bindTimeoutMs = options.bindTimeoutMs ?? BIND_TIMEOUT_MS_DEFAULT;
  if (options.manifestBytes === undefined && options.manifestPath === undefined)
    throw new Error("runIdentityGate needs manifestPath or manifestBytes");
  if (copyHost === "") throw new Error("runIdentityGate needs a CID copy host");
  const bytes = Buffer.from(options.manifestBytes ?? readFileSync(options.manifestPath ?? ""));
  const manifest = JSON.parse(bytes.toString("utf8")) as {
    coverage: Record<string, { count: number }>;
    artifacts: { name: string; kind: string; sha256: string }[];
  };
  const emitted = manifest.coverage["permits_emitted"]?.count ?? null;

  const opened = await options.openEngine();
  const { engine } = opened;
  try {
    const failures: string[] = [];
    await bindParts(
      bytes,
      manifest.artifacts,
      root,
      copyHost,
      remoteOnly,
      engine,
      failures,
      bindTimeoutMs,
    );

    const permits = count(await engine.all("SELECT count(*) AS n FROM v_roofing_permit"));
    const joined = count(await engine.all("SELECT count(*) AS n FROM meta.permit"));
    const piProperties = count(
      await engine.all("SELECT count(DISTINCT cid) AS n FROM property_improvement.property"),
    );
    // NOT EXISTS, never NOT IN: one NULL county cid would make NOT IN match nothing.
    const notCounty = `NOT EXISTS (SELECT 1 FROM county.property c WHERE c.cid = p.cid)`;
    const unmatched = count(
      await engine.all(`SELECT count(DISTINCT p.cid) AS n FROM property_improvement.property p
      WHERE p.cid IS NULL OR ${notCounty}`),
    );
    const nullCids = count(
      await engine.all("SELECT count(*) AS n FROM property_improvement.property WHERE cid IS NULL"),
    );
    let pidUnmatched: string[] = [];
    if (pids !== null) {
      const list = pids.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
      const rows = await engine.all(`SELECT p.request_identifier AS pid
      FROM property_improvement.property p
      WHERE p.request_identifier IN (${list}) AND (p.cid IS NULL OR ${notCounty})`);
      pidUnmatched = rows.map((r) => String(r["pid"]));
    }

    if (nullCids !== 0) failures.push(`${nullCids} permit-side properties have a NULL cid`);
    if (emitted === null && expectPermits === null) {
      failures.push(
        "no permit count to check: manifest lacks permits_emitted and no --expect-permits",
      );
    }
    if (unmatched !== 0)
      failures.push(`${unmatched} permit-side properties are not county properties`);
    if (joined <= 0) failures.push("meta.permit is empty");
    if (emitted !== null && permits !== emitted) {
      failures.push(`v_roofing_permit ${permits} != manifest permits_emitted ${emitted}`);
    }
    if (expectPermits !== null && permits !== expectPermits) {
      failures.push(`v_roofing_permit ${permits} != expected ${expectPermits}`);
    }
    if (pidUnmatched.length > 0)
      failures.push(`pIDs not matched: ${pidUnmatched.slice(0, 20).join(",")}`);

    let previousReport: IdentityComparison | undefined;
    if (options.previous != null) {
      const before = Buffer.from(options.previous.manifestBytes);
      const beforeManifest = JSON.parse(before.toString("utf8")) as typeof manifest;
      const second = await options.openEngine();
      try {
        const noise: string[] = [];
        await bindParts(
          before,
          beforeManifest.artifacts,
          options.previous.root,
          copyHost,
          remoteOnly,
          second.engine,
          noise,
          bindTimeoutMs,
        );
        failures.push(...noise.map((n) => `previous run: ${n}`));
        const compared = compareIdentity(
          await collectIdentity(second.engine),
          await collectIdentity(engine),
          options.allowCidMap === true,
        );
        previousReport = compared.comparison;
        failures.push(...compared.failures);
      } finally {
        second.close();
      }
    }

    return {
      manifest: options.manifestPath ?? "(manifest bytes)",
      v_roofing_permit: permits,
      meta_permit: joined,
      permits_emitted: emitted,
      permit_side_properties: piProperties,
      unmatched_properties: unmatched,
      pids_checked: pids?.length ?? 0,
      pids_unmatched: pidUnmatched.length,
      result: failures.length === 0 ? "PASS" : "FAIL",
      failures,
      ...(previousReport === undefined ? {} : { previous: previousReport }),
    };
  } finally {
    opened.close();
  }
}
