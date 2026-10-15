import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  agedRoofInput,
  describeSchema,
  findAgedRoofProperties,
  findLongTenureOwners,
  findOpenRoofingPermits,
  findOwnersByLocation,
  geocodePlace,
  getContractor,
  getProperty,
  getRunSummary,
  openPermitInput,
  ownerLocationInput,
  runReadOnlySql,
  searchPermitText,
  sqlInput,
  tenureInput,
  textSearchInput,
} from "./queries.js";
import type { Snapshot } from "./snapshot.js";

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  title: string;
  description: string;
  input: S;
  run: (s: Snapshot, input: z.infer<S>) => Promise<unknown>;
};

function def<S extends z.ZodType>(d: ToolDef<S>): ToolDef {
  return d as unknown as ToolDef;
}

async function readPublicationHistory(): Promise<unknown> {
  const url = process.env.ORACLE_HISTORY_URL;
  if (url) return (await fetch(url)).json();
  const dir = path.resolve(
    process.env.INIT_CWD || process.cwd(),
    process.env.ORACLE_RUNS_DIR || "runs",
  );
  return JSON.parse(await readFile(path.join(dir, "history.json"), "utf8"));
}

async function readManifest(runId: string): Promise<unknown> {
  if (!/^run-\d{8}T\d{6}Z$/.test(runId)) throw new Error("invalid runId");
  const base = process.env.ORACLE_MANIFEST_BASE_URL;
  if (base) return (await fetch(`${base.replace(/\/$/, "")}/${runId}.json`)).json();
  const dir = path.resolve(
    process.env.INIT_CWD || process.cwd(),
    process.env.ORACLE_RUNS_DIR || "runs",
  );
  return JSON.parse(await readFile(path.join(dir, "manifests", `${runId}.json`), "utf8"));
}

export const TOOLS: ToolDef[] = [
  def({
    name: "get_run_summary",
    title: "Pipeline run summary",
    description:
      "Return the loaded snapshot's pipeline run: sources, per-source status/record deltas/limitations, coverage counts, run history and table descriptions.",
    input: z.object({}),
    run: (s) => getRunSummary(s),
  }),
  def({
    name: "get_publication_history",
    title: "IPFS publication history",
    description:
      "Return every published run with its immutable root CID, CAR CID, manifest CID, IPNS pointer and provider pin status.",
    input: z.object({}),
    run: () => readPublicationHistory(),
  }),
  def({
    name: "get_artifact_manifest",
    title: "Artifact manifest",
    description:
      "Return the JSON artifact manifest (CID, size, codec, sha256 per object) for a run id such as run-20261014T191018Z.",
    input: z.object({ runId: z.string() }),
    run: (_s, i: { runId: string }) => readManifest(i.runId),
  }),
  def({
    name: "describe_tables",
    title: "Describe tables",
    description:
      "Return table descriptions and column names/types of the snapshot (for writing query_sql).",
    input: z.object({}),
    run: async (s) => describeSchema(s),
  }),
  def({
    name: "geocode_place",
    title: "Geocode a place",
    description:
      "Resolve a Travis-area city/CDP name to coordinates using US Census TIGER internal points.",
    input: z.object({ place: z.string().min(2) }),
    run: (s, i: { place: string }) => geocodePlace(s, i.place),
  }),
  def({
    name: "find_aged_roof_properties",
    title: "Properties with aged roofs in a radius",
    description:
      "Find properties within a radius (GPS point, map pin or place name) whose roof is at least N years old (default 15). Returns roof-age basis, evidence permit, coordinates and provenance, plus counts of properties without roof evidence.",
    input: agedRoofInput,
    run: findAgedRoofProperties,
  }),
  def({
    name: "find_open_roofing_permits",
    title: "Open roofing permits in a radius",
    description:
      "Find open roofing permits within a radius, longest-open first, optionally only those open at least N years, optionally including permits that expired without a final inspection. Includes contractor identity and BBB rating when available.",
    input: openPermitInput,
    run: findOpenRoofingPermits,
  }),
  def({
    name: "find_owners_by_location",
    title: "Regional / out-of-area owners",
    description:
      "Find properties in a radius whose owners mail from elsewhere in Texas or out of state.",
    input: ownerLocationInput,
    run: findOwnersByLocation,
  }),
  def({
    name: "find_long_tenure_owners",
    title: "Owners without a transfer in N years",
    description:
      "Find properties without an ownership transfer in at least N years (default 10). Reports data availability explicitly; deed dates come from the TCAD appraisal export.",
    input: tenureInput,
    run: findLongTenureOwners,
  }),
  def({
    name: "get_property",
    title: "Property detail",
    description:
      "Return one property (by TCAD prop_id) with roof-age evidence, roofing permits, recent permits and provenance.",
    input: z.object({ propId: z.string() }),
    run: (s, i: { propId: string }) => getProperty(s, i.propId),
  }),
  def({
    name: "get_contractor",
    title: "Contractor detail",
    description:
      "Return a reconciled contractor (by contractor_id or fuzzy name) with name variants, Comptroller business link, BBB profile and recent roofing permits.",
    input: z.object({ contractorId: z.string().optional(), name: z.string().optional() }),
    run: (s, i: { contractorId?: string; name?: string }) => getContractor(s, i),
  }),
  def({
    name: "search_roofing_permits_text",
    title: "Full-text search over roofing permits",
    description: "BM25 retrieval over roofing-permit descriptions, contractor names and addresses.",
    input: textSearchInput,
    run: searchPermitText,
  }),
  def({
    name: "query_sql",
    title: "Read-only SQL",
    description:
      "Run one read-only DuckDB SELECT over the snapshot tables (property_leads, roofing_permits, permits, parcels, contractors, businesses, places, bbb_profiles, geo_places). Max 500 rows.",
    input: sqlInput,
    run: runReadOnlySql,
  }),
];
