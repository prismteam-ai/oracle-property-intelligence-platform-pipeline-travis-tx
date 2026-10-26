// A-04 T009: BackboneReport, the read-only run report (contracts/report.md). Counts, digests,
// URLs and timestamps only: any key naming an owner, a mailing line or a payload is refused.
// Each group adds its part as services/report-sections/<key>.ts exporting `section`, `sections` or `*Section`; this file
// adds job_id, as_of, code_sha and limitations[] (from source_limitations). Read-only: it never
// opens a transaction (the Loader is the only writer).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as Restate from "@restatedev/restate-sdk";
import type postgres from "postgres";
import { z } from "zod";

export const SECTIONS_DIR = fileURLToPath(new URL("./report-sections/", import.meta.url));
export const SECTION_KEYS = [
  "roll",
  "confidentiality",
  "coordinates",
  "gis",
  "permits",
  "jurisdictions",
  "identity",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface ReportSection {
  key: SectionKey;
  build(sql: postgres.Sql, jobId: string): Promise<unknown>;
}

const JobId = z.string().regex(/^travis-a04-[a-z0-9-]+$/);

export const BackboneReportV1 = z
  .object({
    job_id: JobId,
    as_of: z.string().nullable(),
    code_sha: z.string().nullable(),
    roll: z.unknown().optional(),
    confidentiality: z.unknown().optional(),
    coordinates: z.unknown().optional(),
    gis: z.unknown().optional(),
    permits: z.unknown().optional(),
    jurisdictions: z.unknown().optional(),
    identity: z.unknown().optional(),
    limitations: z.array(z.string()),
    /** The same limitations with the job that recorded each (own job first, then source_jobs). */
    limitation_jobs: z.array(z.object({ job_id: z.string(), text: z.string() }).strict()),
  })
  .strict();
export type BackboneReportV1 = z.infer<typeof BackboneReportV1>;

export interface RunningJob {
  job_id: string;
  track: string;
  mode: string;
  started_at: string;
}

/** The report's reads. The Postgres store is the real one; tests inject a fake. */
export interface ReportStore {
  run(jobId: string): Promise<{ as_of: string | null; code_sha: string | null } | null>;
  limitations(jobIds: string[]): Promise<Array<{ job_id: string; text: string }>>;
  running(): Promise<RunningJob | null>;
}

const FORBIDDEN_KEY = /owner_name|mailing|payload/i;

/** Path of the first key that names private data, or null. */
export function findForbiddenKey(value: unknown, path = ""): string | null {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const hit = findForbiddenKey(item, `${path}[${i}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const here = path === "" ? key : `${path}.${key}`;
      if (FORBIDDEN_KEY.test(key)) return here;
      const hit = findForbiddenKey(item, here);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function isSection(value: unknown): value is ReportSection {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<ReportSection>;
  return (
    typeof s.build === "function" &&
    typeof s.key === "string" &&
    (SECTION_KEYS as readonly string[]).includes(s.key)
  );
}

/** Every report section a module exports: `section`, `sections[]` and any `*Section`. */
function sectionsOf(mod: Record<string, unknown>): ReportSection[] {
  const found: ReportSection[] = [];
  for (const [name, value] of Object.entries(mod)) {
    if (name === "sections" && Array.isArray(value)) found.push(...value.filter(isSection));
    else if ((name === "section" || name.endsWith("Section")) && isSection(value)) found.push(value);
  }
  return found;
}

/** Job ids a section lists under `source_jobs`. */
function sourceJobsOf(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const jobs = (value as { source_jobs?: unknown }).source_jobs;
  return Array.isArray(jobs) ? jobs.filter((j): j is string => typeof j === "string") : [];
}

/**
 * Imports every `<dir>/*.ts` and keeps each distinct section export; the same object exported
 * twice (or re-exported by another file) counts once, two different sections for one key fail.
 * A missing directory gives none.
 */
export async function loadSections(dir: string = SECTIONS_DIR): Promise<Map<SectionKey, ReportSection>> {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".d.ts")).sort();
  } catch {
    return new Map();
  }
  const sections = new Map<SectionKey, ReportSection>();
  for (const name of names) {
    const mod = (await import(pathToFileURL(join(dir, name)).href)) as Record<string, unknown>;
    for (const found of sectionsOf(mod)) {
      const have = sections.get(found.key);
      if (have === found) continue;
      if (have !== undefined) throw new Error(`report: duplicate section ${found.key}`);
      sections.set(found.key, found);
    }
  }
  return sections;
}

export async function buildReport(
  store: ReportStore,
  sql: postgres.Sql,
  sections: ReadonlyMap<SectionKey, ReportSection>,
  jobId: string,
): Promise<BackboneReportV1> {
  const id = JobId.parse(jobId);
  const run = await store.run(id);
  if (run === null) throw new Error(`report: unknown job ${id}`);
  const body: Record<string, unknown> = { job_id: id, as_of: run.as_of, code_sha: run.code_sha };
  const jobIds = [id];
  for (const key of SECTION_KEYS) {
    const section = sections.get(key);
    if (section === undefined) continue;
    body[key] = await section.build(sql, id);
    for (const job of sourceJobsOf(body[key])) if (!jobIds.includes(job)) jobIds.push(job);
  }
  const limitations = await store.limitations(jobIds);
  body.limitations = limitations.map((l) => l.text);
  body.limitation_jobs = limitations;
  const leak = findForbiddenKey(body);
  if (leak !== null) throw new Error(`report: refused private key ${leak}`);
  return BackboneReportV1.parse(body);
}

export async function runningJob(store: ReportStore): Promise<RunningJob | null> {
  return store.running();
}

export function postgresReportStore(sql: postgres.Sql): ReportStore {
  return {
    async run(jobId) {
      const rows = await sql<Array<{ as_of: string | null; code_sha: string | null }>>`
        SELECT as_of::text AS as_of, code_sha FROM backbone_runs WHERE job_id = ${jobId}`;
      return rows[0] ?? null;
    },
    async limitations(jobIds) {
      const rows = await sql<Array<{ job_id: string; text: string }>>`
        SELECT job_id, text FROM source_limitations WHERE job_id IN ${sql(jobIds)}
        ORDER BY array_position(${jobIds}::text[], job_id), source_key, code`;
      return rows;
    },
    async running() {
      const rows = await sql<RunningJob[]>`
        SELECT job_id, track, mode, to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_at
        FROM backbone_runs WHERE status = 'running' ORDER BY started_at LIMIT 1`;
      return rows[0] ?? null;
    },
  };
}

function connect(deps: ReportDeps, restate: typeof Restate): postgres.Sql {
  try {
    return deps.sql();
  } catch (error) {
    // A missing DATABASE_URL is a configuration error, never retried.
    if (error instanceof Error && error.name === "QueryDbConfigError") {
      throw new restate.TerminalError(error.message);
    }
    throw error;
  }
}

export interface ReportDeps {
  sections: ReadonlyMap<SectionKey, ReportSection>;
  sql: () => postgres.Sql;
}

export function createBackboneReport(restate: typeof Restate, deps: ReportDeps) {
  return restate.service({
    name: "BackboneReport",
    handlers: {
      get: async (ctx: Restate.Context, req: unknown): Promise<BackboneReportV1> => {
        const parsed = z.object({ jobId: JobId }).safeParse(req);
        if (!parsed.success) throw new restate.TerminalError("BackboneReport.get: {jobId} required");
        const sql = connect(deps, restate);
        return ctx.run("report", async () => {
          try {
            return await buildReport(postgresReportStore(sql), sql, deps.sections, parsed.data.jobId);
          } catch (error) {
            if (error instanceof Error && /^report: /.test(error.message)) {
              throw new restate.TerminalError(error.message);
            }
            throw error;
          }
        });
      },
      running: async (ctx: Restate.Context): Promise<RunningJob | null> => {
        const sql = connect(deps, restate);
        return ctx.run("running", () => runningJob(postgresReportStore(sql)));
      },
    },
  });
}
