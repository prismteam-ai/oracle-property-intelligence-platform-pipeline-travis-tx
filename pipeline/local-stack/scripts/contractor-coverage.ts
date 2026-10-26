// A-11 Run 3.1 (ERR-73, PO decision 2026-10-26): the five-state contractor totals for the
// manifest `coverage`, computed over the permits a run actually publishes.
//
// Run 3 wrote its contractor_* coverage with the "registry not loaded" default although the
// Comptroller registry was loaded in the Query DB on 2026-10-22. This script reads the built
// Property Improvement group (every `property_improvement_N.json` and its `company_N.json`, the
// name published as printed), matches each published name against the loaded registry with
// A-07's resolver (unchanged), and prints the totals. It is read-only: it writes no ledger row
// and changes no published file (the per-permit state is not published, AD-24).
//
// Usage (from pipeline/local-stack):
//   npx tsx scripts/contractor-coverage.ts --group <groups/property_improvement dir> --out <file.json>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  registrySnapshotDigest,
  type ComptrollerRow,
} from "../../oracle-runtime/travis/adapters/socrata/tx-comptroller.js";
import { LIVE_CROSSWALK } from "../../oracle-runtime/travis/identity/crosswalk.js";
import {
  normalizeContractorName,
  resolveContractor,
  type RegistryRecord,
  type ResolverState,
} from "../../oracle-runtime/travis/identity/resolver.js";
import { FIVE_STATES } from "../../oracle-runtime/travis/identity/totals.js";

export interface PublishedPermit {
  pid: string;
  permitNumber: string;
  /** company.name as published (as printed), or null when the permit has no contractor. */
  name: string | null;
}

/** Every published permit of a built group dir, with the contractor name published for it. */
export function readPublishedPermits(groupDir: string): PublishedPermit[] {
  const out: PublishedPermit[] = [];
  for (const pid of readdirSync(groupDir).sort()) {
    const data = join(groupDir, pid, "data");
    let files: string[];
    try {
      files = readdirSync(data);
    } catch {
      continue;
    }
    for (const f of files) {
      const m = /^property_improvement_(\d+)\.json$/.exec(f);
      if (m === null) continue;
      const permit = JSON.parse(readFileSync(join(data, f), "utf8")) as { permit_number: string };
      const company = files.includes(`company_${m[1]}.json`)
        ? (JSON.parse(readFileSync(join(data, `company_${m[1]}.json`), "utf8")) as { name: string })
        : null;
      out.push({ pid, permitNumber: permit.permit_number, name: company?.name ?? null });
    }
  }
  return out;
}

export interface ContractorCoverage {
  permits: number;
  named: number;
  byState: Record<ResolverState, number>;
  /** Reason codes of the `unresolved` rows (`contractor_not_printed`, or `no_match` when none). */
  unresolvedBy: Record<string, number>;
  registryRows: number;
  registrySnapshotDigest: string;
}

/** Pure: resolve every published name against the registry snapshot (A-07 resolver, unchanged). */
export function contractorCoverage(
  permits: readonly PublishedPermit[],
  registry: readonly ComptrollerRow[],
  effectiveOn: string,
): ContractorCoverage {
  const digest = registrySnapshotDigest(registry);
  // The same index A-07's resolve track builds: only the rows whose normalised legal name equals
  // the permit's are handed to the resolver, which stays the correctness boundary.
  const byName = new Map<string, RegistryRecord[]>();
  for (const r of registry) {
    const key = normalizeContractorName(r.legalName);
    const bucket = byName.get(key);
    if (bucket) bucket.push(r);
    else byName.set(key, [r]);
  }
  const byState = Object.fromEntries(FIVE_STATES.map((s) => [s, 0])) as Record<
    ResolverState,
    number
  >;
  const unresolvedBy: Record<string, number> = {};
  let named = 0;
  for (const p of permits) {
    if (p.name !== null) named += 1;
    const row = resolveContractor({
      permitKey: p.permitNumber,
      rawContractorName: p.name,
      registryLoaded: registry.length > 0,
      registry: p.name === null ? [] : (byName.get(normalizeContractorName(p.name)) ?? []),
      registrySnapshotDigest: digest,
      crosswalk: LIVE_CROSSWALK,
      effectiveOn,
    });
    byState[row.state] += 1;
    if (row.state === "unresolved") {
      const why = row.reasonCode ?? "no_match";
      unresolvedBy[why] = (unresolvedBy[why] ?? 0) + 1;
    }
  }
  return {
    permits: permits.length,
    named,
    byState,
    unresolvedBy,
    registryRows: registry.length,
    registrySnapshotDigest: digest,
  };
}

export function parseArgs(argv: string[]): { group: string; out: string } {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === undefined || !k.startsWith("--") || v === undefined)
      throw new Error(`bad argument ${k}`);
    a[k.slice(2)] = v;
  }
  if (a["group"] === undefined || a["out"] === undefined)
    throw new Error("--group and --out are required");
  return { group: a["group"], out: a["out"] };
}

/** The tagged-template query function of the postgres client (injected in tests). */
export type Sql = <T>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>;

/** The loaded Comptroller registry (read-only) and its latest load row. */
export async function loadRegistry(sql: Sql): Promise<{
  registry: ComptrollerRow[];
  load: { job_id: string; loaded_at: string; source_url: string; watermark: string | null } | null;
}> {
  const rows = await sql<{
    taxpayer_number: string;
    legal_name: string;
    sos_status_code: string | null;
    mailing_address: string | null;
    sos_file_number: string | null;
  }>`SELECT taxpayer_number, legal_name, sos_status_code, mailing_address, sos_file_number FROM comptroller_registry`;
  const [load] = await sql<{
    job_id: string;
    loaded_at: Date;
    source_url: string;
    watermark: string | null;
  }>`SELECT job_id, loaded_at, source_url, watermark FROM comptroller_registry_loads ORDER BY loaded_at DESC LIMIT 1`;
  return {
    registry: rows.map((r) => ({
      taxpayerNumber: r.taxpayer_number,
      legalName: r.legal_name,
      sosStatusCode: r.sos_status_code ?? "unknown",
      mailingAddress: r.mailing_address,
      sosFileNumber: r.sos_file_number,
    })),
    load: load === undefined ? null : { ...load, loaded_at: load.loaded_at.toISOString() },
  };
}

/** Reads the group and the registry, checks the five-state sum and writes the report. */
export async function writeCoverageReport(
  sql: Sql,
  args: { group: string; out: string },
  effectiveOn: string,
): Promise<ContractorCoverage> {
  const { registry, load } = await loadRegistry(sql);
  const permits = readPublishedPermits(args.group);
  const cov = contractorCoverage(permits, registry, effectiveOn);
  const sum = FIVE_STATES.reduce((n, s) => n + cov.byState[s], 0);
  if (sum !== cov.permits) throw new Error(`five-state sum ${sum} != permits ${cov.permits}`);
  writeFileSync(
    args.out,
    `${JSON.stringify({ ...cov, effectiveOn, registryLoad: load }, null, 2)}\n`,
  );
  return cov;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const { config } = await import("dotenv");
  config({ path: join(here, "../.env"), quiet: true });
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url.trim() === "") throw new Error("DATABASE_URL is not set");
  const { default: pg } = await import("postgres");
  const sql = pg(url, { max: 1, onnotice: () => {} });
  try {
    const cov = await writeCoverageReport(sql as unknown as Sql, args, new Date().toISOString());
    console.log(
      `[contractor-coverage] permits=${cov.permits} named=${cov.named} ${FIVE_STATES.map((s) => `${s}=${cov.byState[s]}`).join(" ")} unresolved_by=${JSON.stringify(cov.unresolvedBy)} registry_rows=${cov.registryRows}`,
    );
  } finally {
    await sql.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`[contractor-coverage] FAILED: ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
