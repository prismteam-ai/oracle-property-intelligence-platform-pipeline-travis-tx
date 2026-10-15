import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OracleConfig } from "../core/config.js";
import { fileExists } from "../core/http.js";
import { log } from "../core/log.js";
import { buildCar, CID_PROFILE } from "./car.js";
import { readHistory, writeHistory } from "./history.js";
import { DEFAULT_GATEWAYS, manifestSchema, type ArtifactManifest } from "./manifest.js";
import { ipnsFromEnv, providersFromEnv, type ProviderUploadResult } from "./providers.js";

type SchemaJson = Record<string, { description: string }>;
type RunJson = {
  run: { status: string };
  sources: Record<string, unknown>[];
};

export function snapshotRootName(config: OracleConfig, runId: string): string {
  return `${config.county}-${config.state}-${runId}`.toLowerCase();
}

export async function publishRun(
  config: OracleConfig,
  opts: { runId: string; providers?: string[]; dryRun?: boolean; env?: NodeJS.ProcessEnv },
): Promise<ArtifactManifest> {
  const env = opts.env ?? process.env;
  const exportDir = path.join(config.dataDir, "exports", opts.runId);
  if (!(await fileExists(path.join(exportDir, "run.json"))))
    throw new Error(`no export found for ${opts.runId} at ${exportDir}`);
  const manifestPath = path.join(config.runsDir, "manifests", `${opts.runId}.json`);
  if (await fileExists(manifestPath)) {
    const existing = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    log.warn("publish_existing_manifest", { runId: opts.runId, rootCid: existing.root.cid });
  }

  const rootName = snapshotRootName(config, opts.runId);
  const workDir = path.join(config.dataDir, "publish", opts.runId);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  const snapshotCar = path.join(workDir, `${rootName}.car`);
  const snapshot = await buildCar(exportDir, rootName, snapshotCar);
  log.info("snapshot_car_built", {
    rootCid: snapshot.rootCid,
    carBytes: snapshot.carBytes,
    blocks: snapshot.blocks,
  });

  const carDir = path.join(workDir, "car-file");
  await mkdir(carDir, { recursive: true });
  await link(snapshotCar, path.join(carDir, `${rootName}.car`));
  const carFileCar = path.join(workDir, `${rootName}.car-file.car`);
  const carFile = await buildCar(carDir, `${rootName}-car`, carFileCar);
  const carEntry = carFile.entries.find((e) => e.path === `${rootName}-car/${rootName}.car`);
  if (!carEntry) throw new Error("CAR file entry missing from car-file DAG");

  const schema = JSON.parse(
    await readFile(path.join(exportDir, "schema.json"), "utf8"),
  ) as SchemaJson;
  const runJson = JSON.parse(await readFile(path.join(exportDir, "run.json"), "utf8")) as RunJson;
  const coverage = JSON.parse(
    await readFile(path.join(exportDir, "coverage.json"), "utf8"),
  ) as Record<string, number>;
  const rowCounts = await tableRowCounts(exportDir);

  const objects: ArtifactManifest["objects"] = snapshot.entries
    .filter((e) => e.path !== rootName)
    .map((e) => {
      const rel = e.path.slice(rootName.length + 1);
      const tableName = path.basename(rel, ".parquet");
      const isTable = rel.endsWith(".parquet");
      return {
        name: rel,
        path: e.path,
        cid: e.cid,
        codec: e.codec,
        size: e.size,
        sha256: e.sha256 ?? null,
        ...(isTable && rowCounts[tableName] !== undefined ? { rows: rowCounts[tableName] } : {}),
        ...(isTable && schema[tableName] ? { description: schema[tableName].description } : {}),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  objects.push({
    name: `${rootName}.car`,
    path: `${rootName}-car/${rootName}.car`,
    cid: carEntry.cid,
    codec: "file",
    size: snapshot.carBytes,
    sha256: snapshot.carSha256,
    description: "CARv1 of the snapshot DAG rooted at root.cid; import with `ipfs dag import`.",
  });

  const history = await readHistory(config);
  const prev = [...history.runs].reverse().find((r) => r.runId !== opts.runId && r.rootCid);
  const providerResults: ProviderUploadResult[] = [];
  if (!opts.dryRun) {
    const providers = providersFromEnv(env, opts.providers);
    if (providers.length === 0)
      log.warn("publish_no_providers", { hint: "set ORACLE_IPFS_PROVIDERS" });
    for (const p of providers) {
      for (const [file, cid, label] of [
        [snapshotCar, snapshot.rootCid, rootName],
        [carFileCar, carFile.rootCid, `${rootName}-car`],
      ] as const) {
        const r = await p.importCar(file, cid, label);
        log.info("provider_import", { ...r, cid, label });
        providerResults.push({ ...r, detail: `${label}: ${r.detail ?? "ok"}` });
      }
    }
  }

  let ipns: ArtifactManifest["ipns"] = null;
  const ipnsPublisher = opts.dryRun ? undefined : ipnsFromEnv(env);
  if (ipnsPublisher) {
    const res = await ipnsPublisher.publish(snapshot.rootCid);
    ipns = {
      name: res.ipnsName,
      resolvedCid: res.resolvedCid,
      publishedAt: new Date().toISOString(),
    };
  }

  const manifest: ArtifactManifest = manifestSchema.parse({
    schemaVersion: "oracle-artifact-manifest/v1",
    county: config.county,
    state: config.state,
    fips: config.fips,
    runId: opts.runId,
    createdAt: new Date().toISOString(),
    cidProfile: CID_PROFILE,
    previous: prev
      ? { runId: prev.runId, rootCid: prev.rootCid, manifestCid: prev.manifestCid ?? null }
      : null,
    root: {
      name: rootName,
      cid: snapshot.rootCid,
      codec: "directory",
      size: objects
        .filter((o) => o.codec === "file" && !o.name.endsWith(".car"))
        .reduce((s, o) => s + o.size, 0),
      car: {
        fileName: `${rootName}.car`,
        cid: carEntry.cid,
        size: snapshot.carBytes,
        sha256: snapshot.carSha256,
      },
    },
    objects,
    ipns,
    providers: providerResults,
    gateways: DEFAULT_GATEWAYS,
    runSummary: { status: runJson.run.status, coverage, sources: runJson.sources },
  });

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const manifestDir = path.join(workDir, "manifest");
  await mkdir(manifestDir, { recursive: true });
  await writeFile(
    path.join(manifestDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  const manifestCarPath = path.join(workDir, `${rootName}.manifest.car`);
  const manifestCar = await buildCar(manifestDir, `${rootName}-manifest`, manifestCarPath);
  const manifestEntry = manifestCar.entries.find((e) => e.path.endsWith("/manifest.json"));
  if (!opts.dryRun) {
    for (const p of providersFromEnv(env, opts.providers)) {
      const r = await p.importCar(manifestCarPath, manifestCar.rootCid, `${rootName}-manifest`);
      log.info("provider_import_manifest", { ...r });
    }
  }
  await writeHistory(config, {
    [opts.runId]: { manifestCid: manifestEntry?.cid ?? null, dryRun: Boolean(opts.dryRun) },
  });
  return manifest;
}

async function tableRowCounts(exportDir: string): Promise<Record<string, number>> {
  const run = JSON.parse(await readFile(path.join(exportDir, "schema.json"), "utf8")) as SchemaJson;
  const out: Record<string, number> = {};
  const tablesFile = path.join(exportDir, "tables.json");
  if (await fileExists(tablesFile)) {
    const tables = JSON.parse(await readFile(tablesFile, "utf8")) as {
      name: string;
      rows: number;
    }[];
    for (const t of tables) out[t.name] = t.rows;
  }
  for (const k of Object.keys(run)) out[k] ??= -1;
  for (const [k, v] of Object.entries(out)) if (v < 0) delete out[k];
  return out;
}
