// T011/T011a (A-14, agent-design.md § 2-3, analyze finding F1): the six query-core tool
// functions plus geocodePlace and the shared area-resolution helper, built directly on
// gazetteer.lookup() (travis-places@1.0.0) and the existing builders.ts/permits.ts SQL
// primitives. searchProperties' rows and total come from A-13's exploreSearchSql (T030, AC-8), so
// the agent tool, the MCP search_properties tool and the Explore page share one filter builder.
// Each function: validate (the caller already ran the matching Zod schema) -> build SQL from
// radiusSql/roofAgeSql/permitsSql -> engine.all -> map rows -> ResultEnvelope. Nothing here
// derives a value the views do not already carry; roof age, tenure and every provenance field
// come straight off v_property/v_roofing_permit.
//
// run_not_found: query-core binds one run per engine (bindManifest), so a function cannot itself
// rebind to a different manifest_cid. When a caller names one that is not the currently bound
// run's, the function returns an empty envelope with empty_reason "run_not_found" rather than
// silently answering from the wrong run; resolving *which* run to bind for a given manifest_cid
// is a layer above query-core (not built in this story).
import type { RunsIndexV1 } from "@countylens/contract";
import { COLUMN_ENUMS, UNCARRIED, VIEWS } from "@countylens/contract";
import { z } from "zod";
import type { BoundRun } from "../bind-manifest.js";
import { METRES_PER_MILE } from "../builders.js";
import { withContractorGaps } from "../contractor-gaps.js";
import { EXPLORE_BOUNDS, exploreSearchSql } from "../explore.js";
import type { QueryEngine, Row } from "../engine.js";
import {
  DAYS_PER_YEAR,
  effectivePermitSort,
  geoFilter,
  permitsCountSql,
  permitsSql,
  permitsUnplacedCountSql,
} from "../permits.js";
import * as gazetteer from "../../gazetteer/travis-places@1.0.0/index.js";
import type { Found } from "../../gazetteer/travis-places@1.0.0/index.js";
import {
  GetCoverageInput,
  GetPropertyInput,
  GetSchemaInput,
  ListPermitsInput,
  ListRunsInput,
  SearchPropertiesInput,
  type AreaEcho,
  type AreaInput,
  type EmptyReason,
  type ResultEnvelope,
  type RunEcho,
} from "./schemas.js";

// ---------------------------------------------------------------------------------------
// geocodePlace
// ---------------------------------------------------------------------------------------

export interface GeocodeFound {
  status: "found";
  id?: string;
  kind: "place" | "zcta";
  name: string;
  point: { lat: number; lon: number };
  label: string;
  partial_in_travis: boolean;
  counties: string[];
  source: Found["source"];
  gazetteer: Found["gazetteer"];
}
export interface GeocodeOutOfScope {
  status: "out_of_scope";
  query: string;
}
export type GeocodeResult = GeocodeFound | GeocodeOutOfScope;

/** The year of the Census Gazetteer vintage behind a found place's source stamp. */
function vintageYear(fileDate: string): number {
  return new Date(fileDate).getUTCFullYear();
}

function placeLabel(found: Found): string {
  return `${found.name} · Census ${vintageYear(found.source.file_date)} Gazetteer · ${found.point.lat}, ${found.point.lon}`;
}

/** geocodePlace: exact gazetteer match only (no fuzzy match is ever auto-applied, § 3). A
 *  misspelling or anything outside Travis County is out_of_scope, never a guessed point. */
export function geocodePlace(input: { query: string }): GeocodeResult {
  const found = gazetteer.lookup(input.query);
  if (found.status === "out_of_scope") return { status: "out_of_scope", query: found.query };
  const id = found.kind === "place" ? found.geoid : found.zcta;
  return {
    status: "found",
    id,
    kind: found.kind,
    name: found.name,
    point: found.point,
    label: placeLabel(found),
    partial_in_travis: found.partial_in_travis,
    counties: [...found.counties],
    source: found.source,
    gazetteer: found.gazetteer,
  };
}

// ---------------------------------------------------------------------------------------
// Shared area resolution (searchProperties / listPermits)
// ---------------------------------------------------------------------------------------

interface Centre {
  lat: number;
  lon: number;
}

type AreaResolution =
  { outOfScope: true; query: string } | { outOfScope: false; centre: Centre; echo: AreaEcho };

/** The shared helper T011a names: resolves AreaInput (a place name or a raw lat/lon) to a centre
 *  point and its citable echo, directly on gazetteer.lookup(). A raw lat/lon is always resolved
 *  (global bounds, AC-11); EXPLORE_BOUNDS-style out-of-Travis rejection for a bare point is not
 *  built in this story (A-13 territory) and is noted here, not silently assumed. */
function resolveArea(area: AreaInput): AreaResolution {
  if ("place" in area) {
    const found = gazetteer.lookup(area.place);
    if (found.status === "out_of_scope") return { outOfScope: true, query: area.place };
    const id = found.kind === "place" ? found.geoid : found.zcta;
    return {
      outOfScope: false,
      centre: found.point,
      echo: {
        label: placeLabel(found),
        point: found.point,
        kind: found.kind,
        id,
        partial_in_travis: found.partial_in_travis,
        source: found.source,
        gazetteer: found.gazetteer,
      },
    };
  }
  return {
    outOfScope: false,
    centre: { lat: area.lat, lon: area.lon },
    echo: {
      label: `${area.lat}, ${area.lon}`,
      point: { lat: area.lat, lon: area.lon },
      kind: "point",
      partial_in_travis: false,
      source: { url: "", file_date: "", sha256: "" },
      gazetteer: { version: gazetteer.GAZETTEER.version, sha256: gazetteer.GAZETTEER.sha256 },
    },
  };
}

// ---------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------

function runEcho(bound: BoundRun): RunEcho {
  return { run_id: bound.runId, manifest_cid: bound.manifestCid, as_of: bound.asOf };
}

/** True when the caller named a manifest_cid other than the currently bound run's (see the
 *  module header note on run_not_found). */
function wrongRun(bound: BoundRun, manifestCid?: string): boolean {
  return manifestCid !== undefined && manifestCid !== bound.manifestCid;
}

/** Builds a ResultEnvelope, handling `area`'s optionality the way `exactOptionalPropertyTypes`
 *  requires: the key is omitted entirely rather than ever set to `undefined`. */
function envelope<R>(params: {
  rows: R[];
  returned: number;
  total: number;
  emptyReason: EmptyReason | null;
  unknownExcluded?: Record<string, number> | undefined;
  area?: AreaEcho | undefined;
  run: RunEcho;
  applied: Record<string, unknown>;
}): ResultEnvelope<R> {
  const { rows, returned, total, emptyReason, unknownExcluded, area, run, applied } = params;
  return {
    rows,
    returned,
    total,
    truncated: total > returned,
    empty_reason: emptyReason,
    unknown_excluded: unknownExcluded ?? {},
    ...(area ? { area } : {}),
    run,
    applied,
  };
}

function emptyEnvelope<R>(
  run: RunEcho,
  reason: EmptyReason,
  applied: Record<string, unknown>,
  area?: AreaEcho,
): ResultEnvelope<R> {
  return envelope({ rows: [], returned: 0, total: 0, emptyReason: reason, area, run, applied });
}

async function countOf(engine: QueryEngine, sql: string): Promise<number> {
  const rows = await engine.all(sql);
  return Number((rows[0] as { n: number } | undefined)?.n ?? 0);
}

type PropertyStatusClass = NonNullable<SearchPropertiesInput["status_class"]>;
function statusClassesFor(
  statusClass: PropertyStatusClass | undefined,
): readonly string[] | undefined {
  if (statusClass === undefined) return undefined;
  if (statusClass === "open_or_stalled") return ["open", "stalled"];
  return [statusClass];
}

const sqlStr = (s: string): string => `'${s.replace(/'/g, "''")}'`;

// ---------------------------------------------------------------------------------------
// searchProperties
// ---------------------------------------------------------------------------------------

export async function searchProperties(
  engine: QueryEngine,
  bound: BoundRun,
  rawInput: z.input<typeof SearchPropertiesInput>,
): Promise<ResultEnvelope<Row>> {
  const input = SearchPropertiesInput.parse(rawInput);
  const run = runEcho(bound);
  const applied: Record<string, unknown> = { ...input };
  if (wrongRun(bound, input.manifest_cid)) return emptyEnvelope(run, "run_not_found", applied);

  const resolved = resolveArea(input.area);
  if (resolved.outOfScope) return emptyEnvelope(run, "out_of_scope", applied);
  const { centre, echo } = resolved;

  const { bbox, distance, radiusM } = geoFilter(centre.lat, centre.lon, input.radius_mi);
  const radiusWhere = `p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND ${bbox} AND ${distance} < ${radiusM}`;

  // T030: the matching rows come from A-13's exploreSearchSql, so the agent tool, the MCP tool and
  // the Explore page agree on the property_cid set. Its bounds (Travis County box) are the only
  // place a raw lat/lon can fall outside: no published data lies there, so it is out_of_scope.
  const { lat: latB, lon: lonB } = EXPLORE_BOUNDS;
  if (!(
    centre.lat >= latB[0] &&
    centre.lat <= latB[1] &&
    centre.lon >= lonB[0] &&
    centre.lon <= lonB[1]
  ))
    return emptyEnvelope(run, "out_of_scope", applied);
  // open_years_min without a status_class has always meant "open or stalled" for the agent.
  const permit =
    input.status_class ?? (input.open_years_min !== undefined ? "open_or_stalled" : undefined);
  const sql = exploreSearchSql({
    centre,
    radius_mi: input.radius_mi,
    roof: input.roof_age_years_min,
    permit,
    openYrs: input.open_years_min,
    tenure: input.tenure_years_min,
    ooa: input.owner_is_out_of_area,
    sort: input.sort,
    limit: input.limit,
  });

  // Predicates now serve only the unknown-value diagnostics (unknown_excluded, empty_reason).
  // Roof age, tenure and owner_is_out_of_area all exclude an unknown value, exactly as Explore
  // does; `relaxedSql` additionally accepts NULL to test whether that exclusion alone was the
  // blocker. The permit filter is a genuine no_match, never field_not_published.
  const predicates: Array<{ sql: string; field?: string; relaxedSql?: string }> = [];
  if (input.roof_age_years_min !== undefined)
    predicates.push({
      field: "roof_age_years",
      sql: `p.roof_age_years >= ${input.roof_age_years_min}`,
      relaxedSql: `(p.roof_age_years >= ${input.roof_age_years_min} OR p.roof_age_years IS NULL)`,
    });
  // Strictly more than N years, as Explore ("Tenure > years").
  if (input.tenure_years_min !== undefined)
    predicates.push({
      field: "tenure_years",
      sql: `p.tenure_years > ${input.tenure_years_min}`,
      relaxedSql: `(p.tenure_years > ${input.tenure_years_min} OR p.tenure_years IS NULL)`,
    });
  if (input.owner_is_out_of_area === true)
    predicates.push({
      field: "owner_is_out_of_area",
      sql: `p.owner_is_out_of_area = true`,
      relaxedSql: `(p.owner_is_out_of_area = true OR p.owner_is_out_of_area IS NULL)`,
    });
  if (permit !== undefined) {
    const classes = statusClassesFor(permit) ?? [];
    const permitWhere = [
      "r.property_cid = p.property_cid",
      `r.status_class IN (${classes.map(sqlStr).join(", ")})`,
    ];
    if (input.open_years_min !== undefined)
      permitWhere.push(
        `r.open_days >= ${Number((input.open_years_min * DAYS_PER_YEAR).toFixed(4))}`,
      );
    predicates.push({
      sql: `EXISTS (SELECT 1 FROM v_roofing_permit r WHERE ${permitWhere.join(" AND ")})`,
    });
  }

  const [summaryRows, rawRows] = await Promise.all([engine.all(sql.summary), engine.all(sql.rows)]);
  const total = Number(
    (summaryRows[0] as { total_within_r?: number } | undefined)?.total_within_r ?? 0,
  );
  const rows = rawRows.map((r) => ({
    ...r,
    dist_m: r.distance_m,
    dist_mi: toMiles(r.distance_m),
  }));
  const returned = rows.length;

  const unknownFields = predicates.filter((p) => p.field !== undefined);
  const unknownCounts = await Promise.all(
    unknownFields.map((p) =>
      countOf(
        engine,
        `SELECT count(*) AS n FROM v_property p WHERE ${radiusWhere} AND p.${p.field} IS NULL`,
      ),
    ),
  );
  const unknownExcluded: Record<string, number> = {};
  unknownFields.forEach((p, i) => {
    unknownExcluded[p.field as string] = unknownCounts[i] ?? 0;
  });

  // Review F1 fix: field_not_published is reported only when relaxing one specific field's null
  // exclusion — and nothing else — provably turns 0 rows into >=1, holding every other active
  // filter fixed. This is NOT "every in-radius row happens to have this field null": that
  // coincidence (e.g. all 5 in-radius rows have roof_age_years IS NULL) says nothing about *why*
  // returned === 0 when an unrelated filter (status_class, a permit EXISTS clause, ...) is the
  // actual cause. If more than one field would unblock on its own, or none would, the cause is
  // ambiguous or lies in a non-unknown-related filter, so we fall back to no_match.
  let emptyReason: EmptyReason | null = null;
  if (returned === 0) {
    const relaxable = predicates.filter((p) => p.field !== undefined && p.relaxedSql !== undefined);
    const relaxedCounts = await Promise.all(
      relaxable.map((p) => {
        const relaxedWhere = [
          radiusWhere,
          ...predicates.filter((o) => o !== p).map((o) => o.sql),
          p.relaxedSql as string,
        ].join(" AND ");
        return countOf(engine, `SELECT count(*) AS n FROM v_property p WHERE ${relaxedWhere}`);
      }),
    );
    const blockingFields = relaxable.filter((_, i) => (relaxedCounts[i] ?? 0) > 0);
    const [blocking] = blockingFields;
    if (blockingFields.length !== 1 || blocking?.field === undefined) emptyReason = "no_match";
    else {
      // A-16 (PO audit item 11): "not published" is a claim about the RUN. When other rows of the
      // run carry the field, only these rows lack it: field_unknown (their own null reasons apply).
      const published = await countOf(
        engine,
        `SELECT count(${blocking.field}) AS n FROM v_property`,
      );
      emptyReason = published === 0 ? "field_not_published" : "field_unknown";
    }
  }

  return envelope({
    rows,
    returned,
    total,
    emptyReason,
    unknownExcluded,
    area: echo,
    run,
    applied,
  });
}

function toMiles(distM: unknown): number | undefined {
  return typeof distM === "number" ? Number((distM / METRES_PER_MILE).toFixed(3)) : undefined;
}

// ---------------------------------------------------------------------------------------
// listPermits
// ---------------------------------------------------------------------------------------

function mapPermitRow(raw: Row): Row {
  // A-16: "no contractor printed" reads source_missing even on an index built before the fix.
  const row = withContractorGaps(raw);
  const openDays = row.open_days;
  const distM = row.dist_m;
  return {
    ...row,
    status_raw: null,
    contractor: {
      // Contract v1.1: the printed name (unverified); null with the row's missing reason.
      name_as_printed: row.contractor_name_as_printed ?? null,
      resolution: row.contractor_resolution,
      company_cid: row.contractor_company_cid,
      bbb_url: row.bbb_url ?? null,
    },
    open_years: typeof openDays === "number" ? Number((openDays / DAYS_PER_YEAR).toFixed(2)) : null,
    dist_mi: toMiles(distM),
  };
}

export async function listPermits(
  engine: QueryEngine,
  bound: BoundRun,
  rawInput: z.input<typeof ListPermitsInput>,
): Promise<ResultEnvelope<Row>> {
  const input = ListPermitsInput.parse(rawInput);
  const run = runEcho(bound);
  const applied: Record<string, unknown> = { ...input };
  if (wrongRun(bound, input.manifest_cid)) return emptyEnvelope(run, "run_not_found", applied);

  let areaEcho: AreaEcho | undefined;
  let centre: Centre | undefined;
  if (input.area !== undefined) {
    const resolved = resolveArea(input.area);
    if (resolved.outOfScope) return emptyEnvelope(run, "out_of_scope", applied);
    centre = resolved.centre;
    areaEcho = resolved.echo;
  }

  if (input.permit_number !== undefined) {
    const rows = await engine.all(permitsSql({ permitNumber: input.permit_number, limit: 1 }));
    if (rows.length === 0) return emptyEnvelope(run, "not_found", applied, areaEcho);
    return envelope({
      rows: rows.map((r) => mapPermitRow(r)),
      returned: 1,
      total: 1,
      emptyReason: null,
      area: areaEcho,
      run,
      applied,
    });
  }

  // "nearest" without an area cannot be honoured: apply, and echo, the real default sort.
  const sort = effectivePermitSort(input.sort, centre !== undefined);
  applied.sort = sort;
  const filter = {
    ...(centre ? { centre: { ...centre, miles: input.radius_mi as number } } : {}),
    statusClass: statusClassesFor(input.status_class as PropertyStatusClass | undefined),
    openYearsMin: input.open_years_min,
    sort,
    limit: input.limit,
  };
  const [rawRows, total, unplaced] = await Promise.all([
    engine.all(permitsSql(filter)),
    countOf(engine, permitsCountSql(filter)),
    // Only an area search needs a property's coordinates; county-wide never drops a permit.
    centre ? engine.all(permitsUnplacedCountSql(filter)) : Promise.resolve([] as Row[]),
  ]);
  const rows = rawRows.map((r) => mapPermitRow(r));
  const returned = rows.length;
  // Permits the radius could not be tested against are reported, never silently dropped
  // ("unknown is never none found"). Only keys with a count above zero are emitted.
  const unknownExcluded: Record<string, number> = {};
  const propertyLink = Number(unplaced[0]?.property_link ?? 0);
  const coordinates = Number(unplaced[0]?.coordinates ?? 0);
  if (propertyLink > 0) unknownExcluded.property_link = propertyLink;
  if (coordinates > 0) unknownExcluded.coordinates = coordinates;
  return envelope({
    rows,
    returned,
    total,
    emptyReason: returned === 0 ? "no_match" : null,
    unknownExcluded,
    area: areaEcho,
    run,
    applied,
  });
}

// ---------------------------------------------------------------------------------------
// getProperty
// ---------------------------------------------------------------------------------------

export async function getProperty(
  engine: QueryEngine,
  bound: BoundRun,
  rawInput: z.input<typeof GetPropertyInput>,
): Promise<ResultEnvelope<Row>> {
  const input = GetPropertyInput.parse(rawInput);
  const run = runEcho(bound);
  const applied: Record<string, unknown> = { ...input };
  if (wrongRun(bound, input.manifest_cid)) return emptyEnvelope(run, "run_not_found", applied);

  const whereClause =
    input.property_cid !== undefined
      ? `property_cid = ${sqlStr(input.property_cid)}`
      : `request_identifier = ${sqlStr(input.request_identifier as string)}`;
  const rows = await engine.all(`SELECT * FROM v_property WHERE ${whereClause} LIMIT 1`);
  if (rows.length === 0) return emptyEnvelope(run, "not_found", applied);

  const propertyCid = String(rows[0]?.property_cid);
  const permits = await engine.all(permitsSql({ propertyCid, limit: 100 }));
  const detail: Row = { ...rows[0], permits: permits.map((p) => mapPermitRow(p)) };
  return envelope({ rows: [detail], returned: 1, total: 1, emptyReason: null, run, applied });
}

// ---------------------------------------------------------------------------------------
// getCoverage
// ---------------------------------------------------------------------------------------

export async function getCoverage(
  engine: QueryEngine,
  bound: BoundRun,
  rawInput: z.input<typeof GetCoverageInput> = {},
): Promise<{ coverage: unknown; run: RunEcho; empty_reason?: EmptyReason }> {
  const input = GetCoverageInput.parse(rawInput);
  const run = runEcho(bound);
  if (wrongRun(bound, input.manifest_cid))
    return { coverage: {}, run, empty_reason: "run_not_found" };
  const rows = await engine.all("SELECT coverage FROM v_run");
  const raw = rows[0]?.coverage;
  // DuckDB's JSON column comes back as JSON text, not a parsed object (scripts/duckdb-engine.ts
  // does not special-case the JSON type); parse it so AC-9's deep-equal is against real objects.
  const coverage = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
  return { coverage, run };
}

// ---------------------------------------------------------------------------------------
// listRuns
// ---------------------------------------------------------------------------------------

export function listRuns(
  index: Pick<RunsIndexV1, "runs">,
  rawInput: z.input<typeof ListRunsInput> = {},
): {
  runs: { run_id: string; manifest_cid: string; finished_at: string }[];
  latest: { run_id: string; manifest_cid: string; finished_at: string } | null;
} {
  const input = ListRunsInput.parse(rawInput);
  const sorted = [...index.runs].sort(
    (a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt),
  );
  const runs = sorted
    .slice(0, input.limit)
    .map((r) => ({ run_id: r.runId, manifest_cid: r.manifestCid, finished_at: r.finishedAt }));
  return { runs, latest: runs[0] ?? null };
}

// ---------------------------------------------------------------------------------------
// getSchema
// ---------------------------------------------------------------------------------------

const TOOL_SCHEMAS = {
  searchProperties: SearchPropertiesInput,
  listPermits: ListPermitsInput,
  getProperty: GetPropertyInput,
  getCoverage: GetCoverageInput,
  listRuns: ListRunsInput,
  getSchema: GetSchemaInput,
} as const;

export function getSchema(rawInput: z.input<typeof GetSchemaInput> = {}): {
  views: { name: string; columns: unknown[] }[];
  uncarried: unknown;
  enums: typeof COLUMN_ENUMS;
  tool_inputs: Record<string, unknown>;
} {
  const input = GetSchemaInput.parse(rawInput);
  const viewNames = input.view ? [input.view] : (Object.keys(VIEWS) as (keyof typeof VIEWS)[]);
  const views = viewNames.map((name) => ({
    name,
    columns: VIEWS[name].map((c) => ({
      name: c.name,
      type: c.type,
      enum: c.enum,
      nullable: c.nullable,
      meaning: c.meaning,
      missingReason: c.missingReason,
    })),
  }));
  // A-16: each not_in_export entry carries the product's plain wording for MCP clients.
  const withText = (entries: readonly { field: string; reason: string }[]) =>
    entries.map((e) =>
      e.reason === "not_in_export"
        ? {
            ...e,
            reason_text:
              /address|city_name|postal_code$/.test(e.field) && !e.field.startsWith("owner_")
                ? "Address not in the published export"
                : "Not in the published export",
          }
        : e,
    );
  const all = Object.fromEntries(
    Object.entries(UNCARRIED as Record<string, readonly { field: string; reason: string }[]>).map(
      ([view, entries]) => [view, withText(entries)],
    ),
  );
  const uncarried = input.view ? { [input.view]: all[input.view] ?? [] } : all;
  const tool_inputs = Object.fromEntries(
    Object.entries(TOOL_SCHEMAS).map(([name, schema]) => [name, z.toJSONSchema(schema)]),
  );
  return { views, uncarried, enums: COLUMN_ENUMS, tool_inputs };
}
