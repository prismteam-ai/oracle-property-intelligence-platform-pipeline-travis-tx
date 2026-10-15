import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

export type Row = Record<string, unknown>;

export type SnapshotSource = {
  base: string;
  runId: string | null;
  rootCid: string | null;
  manifest: Record<string, unknown> | null;
};

const HOT_TABLES = [
  "property_leads",
  "roofing_permits",
  "contractors",
  "bbb_profiles",
  "geo_places",
];
const COLD_TABLES = ["permits", "parcels", "businesses", "places", "contractor_ambiguous_links"];

export function isRemote(base: string): boolean {
  return /^https?:\/\//.test(base);
}

export async function resolveSnapshotSource(
  env: NodeJS.ProcessEnv = process.env,
  cwd = env.INIT_CWD || process.cwd(),
): Promise<SnapshotSource> {
  const gateway = (env.ORACLE_IPFS_GATEWAY || "https://ipfs.io").replace(/\/$/, "");
  if (env.ORACLE_SNAPSHOT_BASE) {
    return {
      base: env.ORACLE_SNAPSHOT_BASE.replace(/\/$/, ""),
      runId: env.ORACLE_SNAPSHOT_RUN_ID || null,
      rootCid: null,
      manifest: null,
    };
  }
  if (env.ORACLE_SNAPSHOT_ROOT_CID) {
    return {
      base: `${gateway}/ipfs/${env.ORACLE_SNAPSHOT_ROOT_CID}`,
      runId: env.ORACLE_SNAPSHOT_RUN_ID || null,
      rootCid: env.ORACLE_SNAPSHOT_ROOT_CID,
      manifest: null,
    };
  }
  const manifestRef = env.ORACLE_SNAPSHOT_MANIFEST;
  if (manifestRef) {
    const text = isRemote(manifestRef)
      ? await (await fetch(manifestRef)).text()
      : await readFile(path.resolve(cwd, manifestRef), "utf8");
    const m = JSON.parse(text) as { runId: string; root: { cid: string } };
    return {
      base: `${gateway}/ipfs/${m.root.cid}`,
      runId: m.runId,
      rootCid: m.root.cid,
      manifest: m as Record<string, unknown>,
    };
  }
  const dataDir = path.resolve(cwd, env.ORACLE_DATA_DIR || "data");
  const exportsDir = path.join(dataDir, "exports");
  const runs = (await readdir(exportsDir).catch(() => [] as string[]))
    .filter((d) => d.startsWith("run-"))
    .sort();
  const latest = runs[runs.length - 1];
  if (!latest) throw new Error(`no snapshot configured and no local exports under ${exportsDir}`);
  return { base: path.join(exportsDir, latest), runId: latest, rootCid: null, manifest: null };
}

export class Snapshot {
  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly conn: DuckDBConnection,
    readonly source: SnapshotSource,
    readonly runJson: Row,
    readonly coverage: Record<string, number>,
    readonly schema: Record<
      string,
      { description: string; columns: { name: string; type: string }[] }
    >,
  ) {}

  static async open(source: SnapshotSource): Promise<Snapshot> {
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    await conn.run("INSTALL httpfs; LOAD httpfs; INSTALL fts; LOAD fts;");
    await conn.run(`SET memory_limit = '${process.env.ORACLE_DUCKDB_MEMORY_LIMIT || "2GB"}'`);
    const file = (rel: string) =>
      isRemote(source.base) ? `${source.base}/${rel}` : path.join(source.base, rel);
    const readText = async (rel: string) =>
      isRemote(source.base)
        ? await (await fetch(file(rel))).text()
        : await readFile(file(rel), "utf8");
    const runJson = JSON.parse(await readText("run.json")) as Row;
    const coverage = JSON.parse(await readText("coverage.json")) as Record<string, number>;
    const schema = JSON.parse(await readText("schema.json"));
    const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
    for (const t of HOT_TABLES) {
      await conn.run(
        `CREATE TABLE ${t} AS SELECT * FROM read_parquet(${q(file(`tables/${t}.parquet`))})`,
      );
    }
    for (const t of COLD_TABLES) {
      await conn.run(
        `CREATE VIEW ${t} AS SELECT * FROM read_parquet(${q(file(`tables/${t}.parquet`))})`,
      );
    }
    await conn.run(`CREATE TABLE permit_text AS
      SELECT permit_number, coalesce(description, '') || ' ' || coalesce(contractor_name, '') || ' ' ||
        coalesce(address, '') || ' ' || coalesce(status, '') AS body
      FROM roofing_permits`);
    await conn.run(
      `PRAGMA create_fts_index('permit_text', 'permit_number', 'body', overwrite = 1)`,
    );
    const snap = new Snapshot(instance, conn, source, runJson, coverage, schema);
    if (!source.runId) {
      const run = runJson.run as { run_id?: string } | undefined;
      snap.source.runId = run?.run_id ?? null;
    }
    return snap;
  }

  async all<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!params.length) return (await this.conn.runAndReadAll(sql)).getRowObjectsJson() as T[];
    const stmt = await this.conn.prepare(sql);
    stmt.bind(params as never);
    return (await stmt.runAndReadAll()).getRowObjectsJson() as T[];
  }

  close(): void {
    this.conn.closeSync();
    this.instance.closeSync();
  }
}

let shared: Promise<Snapshot> | undefined;

export function getSnapshot(env: NodeJS.ProcessEnv = process.env): Promise<Snapshot> {
  shared ??= resolveSnapshotSource(env).then((s) => Snapshot.open(s));
  return shared;
}
