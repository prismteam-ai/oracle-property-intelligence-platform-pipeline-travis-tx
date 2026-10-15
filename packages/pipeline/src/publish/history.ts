import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OracleConfig } from "../core/config.js";
import { fileExists } from "../core/http.js";
import { manifestSchema } from "./manifest.js";

export type HistoryEntry = {
  runId: string;
  createdAt: string;
  status: string;
  rootCid: string;
  carCid: string;
  manifestPath: string;
  manifestCid: string | null;
  previousRootCid: string | null;
  ipns: { name: string; resolvedCid: string } | null;
  published: boolean;
  providers: { provider: string; status: string }[];
  coverage: Record<string, number>;
  sources: {
    sourceId: string;
    status: string;
    inserted: number;
    updated: number;
    unchanged: number;
    deleted: number;
    limitation: string | null;
  }[];
};

export type History = { county: string; state: string; generatedAt: string; runs: HistoryEntry[] };

export async function readHistory(config: OracleConfig): Promise<History> {
  const file = path.join(config.runsDir, "history.json");
  if (!(await fileExists(file)))
    return {
      county: config.county,
      state: config.state,
      generatedAt: new Date().toISOString(),
      runs: [],
    };
  return JSON.parse(await readFile(file, "utf8")) as History;
}

export async function writeHistory(
  config: OracleConfig,
  extra: Record<string, { manifestCid: string | null; dryRun: boolean }> = {},
): Promise<History> {
  const prior = await readHistory(config);
  const priorById = new Map(prior.runs.map((r) => [r.runId, r]));
  const dir = path.join(config.runsDir, "manifests");
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter((f) => /^run-\d{8}T\d{6}Z\.json$/.test(f)).sort();
  const runs: HistoryEntry[] = [];
  for (const f of files) {
    const m = manifestSchema.parse(JSON.parse(await readFile(path.join(dir, f), "utf8")));
    const before = priorById.get(m.runId);
    const ex = extra[m.runId];
    runs.push({
      runId: m.runId,
      createdAt: m.createdAt,
      status: m.runSummary.status,
      rootCid: m.root.cid,
      carCid: m.root.car.cid,
      manifestPath: path.posix.join("runs", "manifests", f),
      manifestCid: ex?.manifestCid ?? before?.manifestCid ?? null,
      previousRootCid: m.previous?.rootCid ?? null,
      ipns: m.ipns ? { name: m.ipns.name, resolvedCid: m.ipns.resolvedCid } : null,
      published: m.providers.some((p) => p.status === "pinned"),
      providers: m.providers.map((p) => ({ provider: p.provider, status: p.status })),
      coverage: m.runSummary.coverage,
      sources: m.runSummary.sources.map((s) => ({
        sourceId: String(s.source_id),
        status: String(s.status),
        inserted: Number(s.inserted ?? 0),
        updated: Number(s.updated ?? 0),
        unchanged: Number(s.unchanged ?? 0),
        deleted: Number(s.deleted ?? 0),
        limitation: (s.limitation as string | null) ?? null,
      })),
    });
  }
  runs.sort((a, b) => a.runId.localeCompare(b.runId));
  const history: History = {
    county: config.county,
    state: config.state,
    generatedAt: new Date().toISOString(),
    runs,
  };
  await writeFile(
    path.join(config.runsDir, "history.json"),
    JSON.stringify(history, null, 2) + "\n",
  );
  return history;
}
