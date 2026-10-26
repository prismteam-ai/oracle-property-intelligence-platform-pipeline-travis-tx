// T061 (A-02, FR-002 / FR-011): bind the four views to one run manifest and its export-tables
// output. Everything the views stamp on a row comes from here: as_of = finishedAt (never now()),
// captured_at from sources[], profile_version/profile_sha256 from profiles[], table_cid from the
// manifest's part artifacts, manifest_cid = the raw-leaves CIDv1 of the manifest bytes.
// Tables the export did not emit become empty typed relations (oracle R10). No engine import:
// SQL goes through the QueryEngine interface.
import { RunManifestV1 } from "@countylens/contract";
import { PROFILE, RULES } from "@countylens/profile-travis-austin";
import { GAZETTEER } from "../gazetteer/travis-places@1.0.0/index.js";
import { deriveMacrosSql, zctaAreaRows } from "./derive.js";
import type { QueryEngine } from "./engine.js";
import { rawCid } from "./raw-cid.js";
import { STATUS_MAP_SQL, VIEWS_SQL } from "./sql.js";
import { CONTRACT_VIEWS, planViews, type ContractView, type ViewPlan } from "./view-plan.js";

const V = "VARCHAR";
/** The manifest profiles[] name of the travis-places gazetteer (area_list_sha256). */
export const PLACES_PROFILE = "travis-places";
const ENTITY = { cid: V, property_cid: V, data_group_cid: V, request_identifier: V };
const EDGE = { relationship_cid: V, from_cid: V, to_cid: V, property_cid: V, data_group_cid: V };

export interface RequiredTable {
  group: "county" | "property_improvement";
  table: string;
  /** The columns views.sql reads, with the type export-tables gives them. */
  columns: Readonly<Record<string, string>>;
}

const edge = (group: RequiredTable["group"], table: string): RequiredTable => ({
  group,
  table,
  columns: EDGE,
});

/** Every relation views.sql reads. Emitted ones must carry these columns. */
export const REQUIRED_TABLES: readonly RequiredTable[] = [
  {
    group: "county",
    table: "property",
    columns: {
      ...ENTITY,
      parcel_identifier: V,
      property_type: V,
      property_usage_type: V,
      property_structure_built_year: "BIGINT",
      source_http_request: V,
    },
  },
  {
    group: "county",
    table: "geometry",
    // source_http_request: the coordinate source (address_point vs gis_centroid, ADR 0004).
    columns: { ...ENTITY, latitude: "DOUBLE", longitude: "DOUBLE", source_http_request: V },
  },
  { group: "county", table: "structure", columns: { ...ENTITY, roof_date: V } },
  {
    group: "county",
    table: "sales_history",
    columns: { ...ENTITY, ownership_transfer_date: V, source_http_request: V },
  },
  { group: "county", table: "person", columns: { ...ENTITY, first_name: V, last_name: V } },
  { group: "county", table: "company", columns: { ...ENTITY, name: V } },
  edge("county", "property_has_parcel"),
  edge("county", "parcel_has_geometry"),
  edge("county", "property_has_structure"),
  edge("county", "property_has_sales_history"),
  edge("county", "sales_history_has_person"),
  edge("county", "sales_history_has_company"),
  // ERR-69: owners hang on the property (current owners), not only on the latest sale. A run
  // written before Run 3 has no such edge; it binds as an empty typed relation.
  edge("county", "person_has_property"),
  edge("county", "company_has_property"),
  // v1.2: the situs address record of the property (its text is read through meta.address_fields).
  edge("county", "property_has_address"),
  edge("county", "person_has_mailing_address"),
  edge("county", "company_has_mailing_address"),
  {
    group: "property_improvement",
    table: "property_improvement",
    columns: {
      ...ENTITY,
      permit_number: V,
      improvement_type: V,
      improvement_action: V,
      improvement_status: V,
      permit_issue_date: V,
      completion_date: V,
      permit_close_date: V,
      final_inspection_date: V,
      source_http_request: V,
    },
  },
  edge("property_improvement", "property_has_property_improvement"),
  edge("property_improvement", "property_improvement_has_contractor"),
  {
    group: "property_improvement",
    table: "company",
    columns: { ...ENTITY, name: V, sunbiz_document_number: V, source_http_request: V },
  },
];

/** ERR-19: the required tables `views` read (transitively, through meta.permit and
 *  v_roofing_permit), in REQUIRED_TABLES order. */
export function tablesForViews(views: readonly ContractView[]): RequiredTable[] {
  const { tables } = planViews(views);
  return REQUIRED_TABLES.filter((r) => tables.has(`${r.group}.${r.table}`));
}

/** The manifest source each data group's records were captured from (used when a record has no
 *  source_http_request, or one whose url is not a manifest source). */
export const TRAVIS_GROUP_SOURCES: Readonly<Record<string, string>> = {
  county: "tcad-2026-certified-json",
  property_improvement: "austin-3syk-w9eu",
};

export interface BindOptions {
  groupSources?: Readonly<Record<string, string>>;
  /**
   * Where the engine reads a part, from its manifest artifact `{name, cid}`: a local path or a
   * URL (the CID copy serves `/ipfs/<cid>`, a presigned S3 GET in the Lambda). Default:
   * `${tablesDir}/${group}/${table}/${part}`, the export-tables layout (A-03 T013, additive).
   */
  partUrl?: (artifact: { name: string; cid: string }) => string;
  /**
   * ERR-19: bind only what these contract views read (view-plan.ts): the export tables they need
   * (emitted → read over their parts, absent → empty typed tables) and their views.sql statements.
   * Other parts are never passed to `partUrl` nor read. Default: every emitted table and all four
   * views (unchanged). Rows of a created view are the same either way.
   */
  views?: readonly ContractView[];
}

export interface BoundTable {
  group: string;
  table: string;
  emitted: boolean;
  parts: string[];
}

export interface BoundRun {
  runId: string;
  manifestCid: string;
  asOf: string;
  tables: BoundTable[];
  /** The contract views created, in CONTRACT_VIEWS order (all four unless `views` was given). */
  views: ContractView[];
}

const str = (s: string | null | undefined): string =>
  s === null || s === undefined ? "NULL" : `'${s.replace(/'/g, "''")}'`;
const ident = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/** A table artifact's name split into the export batch it came from (every sibling table/part
 *  under the same prefix) and its own table/part. Works for A-03's pilot layout
 *  (`tables/<group>/<table>/<part>`, batchRoot `tables/<group>`) and A-04/A-11's full-county
 *  batching (AD-0001: `<run-dir>/…/tables/<bNN>/<table>/<part>`, batchRoot
 *  `<run-dir>/…/tables/<bNN>`) alike — the batch is just "everything before the last two path
 *  segments", at any depth. */
function tableLocOf(name: string): { batchRoot: string; table: string; part: string } | null {
  const segs = name.split("/");
  if (segs.length < 3) return null;
  const part = segs[segs.length - 1];
  const table = segs[segs.length - 2];
  if (!part || !table) return null;
  return { batchRoot: segs.slice(0, -2).join("/"), table, part };
}

/** REQUIRED_TABLES table names that name exactly one group — the anchors `resolveBatchGroups`
 *  trusts. "company" (the one name REQUIRED_TABLES lists for both groups) is deliberately never
 *  an anchor. */
const GROUP_OF_REQUIRED_TABLE: ReadonlyMap<string, RequiredTable["group"]> = (() => {
  const byTable = new Map<string, Set<RequiredTable["group"]>>();
  for (const r of REQUIRED_TABLES) {
    const groups = byTable.get(r.table) ?? new Set<RequiredTable["group"]>();
    groups.add(r.group);
    byTable.set(r.table, groups);
  }
  const out = new Map<string, RequiredTable["group"]>();
  for (const [table, groups] of byTable) {
    if (groups.size === 1) out.set(table, [...groups][0] as RequiredTable["group"]);
  }
  return out;
})();

/**
 * The data group of every export batch (one `tableLocOf` batchRoot), from the manifest's own
 * structure — never guessed from a fixed path string, so this works for any number of batches
 * per group (1 in A-03's pilot, 10+2 in Run 1, however many later). A batch's group is the one
 * most of its table names agree on via GROUP_OF_REQUIRED_TABLE (a majority vote, not any single
 * name): a batch can legitimately carry a table name that REQUIRED_TABLES assigns to the *other*
 * group (e.g. A-11's property_improvement batches also export an unused "property" table, whose
 * only REQUIRED_TABLES owner is county) without that one name mis-grouping the whole batch. Falls
 * back to the pilot's own literal `tables/<group>` layout only when no table name resolves the
 * batch at all.
 */
export function resolveBatchGroups(
  tableNames: Iterable<string>,
): ReadonlyMap<string, RequiredTable["group"] | null> {
  const byBatch = new Map<string, string[]>();
  for (const name of tableNames) {
    const loc = tableLocOf(name);
    if (!loc) continue;
    const tables = byBatch.get(loc.batchRoot) ?? [];
    tables.push(loc.table);
    byBatch.set(loc.batchRoot, tables);
  }
  const resolved = new Map<string, RequiredTable["group"] | null>();
  for (const [batchRoot, tables] of byBatch) {
    const votes = new Map<RequiredTable["group"], number>();
    for (const table of tables) {
      const group = GROUP_OF_REQUIRED_TABLE.get(table);
      if (group) votes.set(group, (votes.get(group) ?? 0) + 1);
    }
    let winner: RequiredTable["group"] | null = null;
    let max = 0;
    for (const [group, count] of votes) {
      if (count > max) {
        winner = group;
        max = count;
      }
    }
    if (winner === null) {
      const last = batchRoot.split("/").at(-1);
      if (last === "county" || last === "property_improvement") winner = last;
    }
    resolved.set(batchRoot, winner);
  }
  return resolved;
}

/** The emitted export tables `wanted` admits, each with its part artifact names (manifest order). */
function emittedTables(
  parts: readonly { name: string }[],
  batchGroups: ReadonlyMap<string, RequiredTable["group"] | null>,
  wanted: (key: string) => boolean,
): Map<string, BoundTable> {
  const emitted = new Map<string, BoundTable>();
  for (const a of parts) {
    const loc = tableLocOf(a.name);
    if (!loc) continue;
    const group = batchGroups.get(loc.batchRoot);
    if (!group) continue; // the batch's group could not be resolved: never bind it into a guess
    const key = `${group}.${loc.table}`;
    if (!wanted(key)) continue;
    const t = emitted.get(key) ?? { group, table: loc.table, emitted: true, parts: [] };
    t.parts.push(a.name);
    emitted.set(key, t);
  }
  return emitted;
}

/**
 * The names of the table part artifacts `bindManifest` reads for `views` (every emitted table's
 * parts when `views` is omitted): the same selection, so a caller can prefetch exactly those
 * parts instead of every part of the run. Takes the manifest's `artifacts` only.
 */
export function boundPartNames(
  artifacts: readonly { readonly kind: string; readonly name: string }[],
  views?: readonly ContractView[],
): string[] {
  const parts = artifacts.filter((a) => a.kind === "table");
  const tables = views === undefined ? undefined : planViews(views).tables;
  const batchGroups = resolveBatchGroups(parts.map((a) => a.name));
  const emitted = emittedTables(
    parts,
    batchGroups,
    (key) => tables === undefined || tables.has(key),
  );
  return [...emitted.values()].flatMap((t) => t.parts);
}

/**
 * Creates schema `meta` (run, sources, parts, lookups), one relation per export table under the
 * schema of its data group (`county.property`, `property_improvement.property_improvement`, …,
 * each with a `_part` column naming its part artifact), the derivation macros, the status map and
 * the four views. `tablesDir` holds `<group>/<table>/part-*.parquet` (export-tables output) unless
 * `options.partUrl` maps each part to its own path or URL.
 */
export async function bindManifest(
  manifestBytes: Uint8Array,
  tablesDir: string,
  engine: QueryEngine,
  options: BindOptions = {},
): Promise<BoundRun> {
  const manifest = RunManifestV1.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
  const manifestCid = await rawCid(manifestBytes);
  const profile = manifest.profiles.find((p) => p.name === RULES.name);
  if (!profile) throw new Error(`bindManifest: manifest has no ${RULES.name} profile`);
  // The status map below is generated from the in-repo profile: a run classified by another
  // digest must not be read through it (oracle F5).
  if (profile.sha256 !== PROFILE.sha256 || profile.version !== PROFILE.version)
    throw new Error(
      `bindManifest: manifest ${RULES.name}@${profile.version} sha256 ${profile.sha256} is not the in-repo profile DIGEST ${PROFILE.version} ${PROFILE.sha256}`,
    );
  // area_list_sha256 comes from the manifest only (code-review #8); the ZCTA lookup is the
  // in-repo gazetteer, so its digest must be the one the run recorded. A run that never captured
  // places/business (A-07 Track C out of scope, e.g. Run 1) carries no travis-places profile at
  // all: that is missing data, not a binding failure (constitution "missing data says why"), so
  // area_list_sha256 stays NULL and meta.zcta_area stays empty — v_property's own
  // `owner_area_class = coalesce(zcta_class, 'unknown')` and its "not_in_export" missing-reason
  // already carry that forward; nothing downstream needs to know why the table is empty. A
  // present profile whose digest disagrees with the in-repo gazetteer is still a hard failure:
  // that is not missing data, it is a run classified by a lookup this build cannot reproduce.
  const places = manifest.profiles.find((p) => p.name === PLACES_PROFILE);
  if (places && places.sha256 !== GAZETTEER.sha256)
    throw new Error(
      `bindManifest: manifest ${PLACES_PROFILE} sha256 ${places.sha256} is not the in-repo gazetteer DIGEST ${GAZETTEER.sha256}`,
    );
  const areaList = places?.sha256 ?? null;
  const groupSources = options.groupSources ?? TRAVIS_GROUP_SOURCES;
  const plan: ViewPlan | undefined =
    options.views === undefined ? undefined : planViews(options.views);
  const wanted = (key: string): boolean => plan === undefined || plan.tables.has(key);

  // A warm engine may hold another run: emitted tables are VIEWs and absent required ones are
  // empty TABLEs, and DuckDB cannot CREATE OR REPLACE across the two kinds; the previous run's
  // extra views (over presigned URLs that expire) must not survive either. The three run schemas
  // are dropped whole; the main-schema views and macros are replaced below (code-review Major 4).
  // ERR-19: the four contract views are dropped too, so a subset bind leaves none of the previous
  // run's views behind (each is recreated below when the plan includes it).
  const sql: string[] = [
    ...CONTRACT_VIEWS.map((v) => `DROP VIEW IF EXISTS ${v}`),
    "DROP SCHEMA IF EXISTS meta CASCADE",
    "DROP SCHEMA IF EXISTS county CASCADE",
    "DROP SCHEMA IF EXISTS property_improvement CASCADE",
    "CREATE SCHEMA IF NOT EXISTS meta",
    "CREATE SCHEMA IF NOT EXISTS county",
    "CREATE SCHEMA IF NOT EXISTS property_improvement",
  ];

  const batchGroups = resolveBatchGroups(
    manifest.artifacts.filter((a) => a.kind === "table").map((a) => a.name),
  );
  const roots = manifest.artifacts
    .filter((a) => a.kind === "directory")
    .map((a) => ({
      data_group: batchGroups.get(a.name) ?? a.name.replace(/^tables\//, ""),
      cid: a.cid,
    }));
  sql.push(`CREATE OR REPLACE TABLE meta.run AS SELECT
    ${str(manifest.runId)} AS run_id,
    ${str(manifest.fips)} AS county_fips,
    CAST(${str(manifest.startedAt)} AS TIMESTAMPTZ) AS started_at,
    CAST(${str(manifest.finishedAt)} AS TIMESTAMPTZ) AS finished_at,
    CAST(${str(manifest.finishedAt)} AS TIMESTAMPTZ) AS as_of,
    ${str(manifestCid)} AS manifest_cid,
    ${str(manifest.previousManifestCid)}::VARCHAR AS previous_manifest_cid,
    ${str(`${profile.name}@${profile.version}`)} AS profile_version,
    ${str(profile.sha256)} AS profile_sha256,
    ${str(areaList)} AS area_list_sha256,
    CAST(${str(JSON.stringify(roots))} AS JSON) AS tables_root_cids,
    CAST(${str(JSON.stringify(manifest.sources))} AS JSON) AS sources,
    CAST(${str(JSON.stringify(manifest.coverage))} AS JSON) AS coverage,
    CAST(${str(JSON.stringify(manifest.limitations))} AS JSON) AS limitations`);

  const sources = manifest.sources.map(
    (s) => `(${str(s.name)}, ${str(s.url)}, CAST(${str(s.captured_at)} AS TIMESTAMPTZ))`,
  );
  sql.push(
    `CREATE OR REPLACE TABLE meta.source (name VARCHAR, url VARCHAR, captured_at TIMESTAMPTZ)`,
  );
  if (sources.length > 0) sql.push(`INSERT INTO meta.source VALUES ${sources.join(", ")}`);

  sql.push("CREATE OR REPLACE TABLE meta.group_source (data_group VARCHAR, source_name VARCHAR)");
  for (const [group, name] of Object.entries(groupSources)) {
    if (!manifest.sources.some((s) => s.name === name))
      throw new Error(`bindManifest: group ${group} source ${name} is not in the manifest`);
    sql.push(`INSERT INTO meta.group_source VALUES (${str(group)}, ${str(name)})`);
  }

  const parts = manifest.artifacts.filter((a) => a.kind === "table");
  sql.push("CREATE OR REPLACE TABLE meta.part (name VARCHAR, table_cid VARCHAR)");
  if (parts.length > 0)
    sql.push(
      `INSERT INTO meta.part VALUES ${parts.map((p) => `(${str(p.name)}, ${str(p.cid)})`).join(", ")}`,
    );

  const hosts = Object.entries(RULES.jurisdictions).flatMap(([id, j]) =>
    j.hosts.map((h) => `(${str(h)}, ${str(id)})`),
  );
  sql.push("CREATE OR REPLACE TABLE meta.jurisdiction_host (host VARCHAR, jurisdiction VARCHAR)");
  if (hosts.length > 0) sql.push(`INSERT INTO meta.jurisdiction_host VALUES ${hosts.join(", ")}`);

  // No travis-places profile (places/business out of scope for this run): meta.zcta_area stays
  // an empty typed relation, never silently filled from the in-repo gazetteer a run that never
  // declared using it did not ask for (see the `places` comment above).
  if (places) {
    const byClass = new Map<string, string[]>();
    // Push, never re-spread: ~33k ZCTAs made the copy-per-row form O(n²) (≈1.9 s CPU per bind).
    for (const r of zctaAreaRows()) {
      const codes = byClass.get(r.area_class);
      if (codes === undefined) byClass.set(r.area_class, [r.zcta]);
      else codes.push(r.zcta);
    }
    sql.push(
      `CREATE OR REPLACE TABLE meta.zcta_area AS ${[...byClass.entries()]
        .map(
          ([cls, codes]) =>
            `SELECT unnest(string_split(${str(codes.join(","))}, ',')) AS zcta, ${str(cls)} AS area_class`,
        )
        .join(" UNION ALL ")}`,
    );
  } else {
    sql.push("CREATE OR REPLACE TABLE meta.zcta_area (zcta VARCHAR, area_class VARCHAR)");
  }
  await engine.run(sql.join(";\n"));

  // One relation per emitted table, then empty typed relations for the required absent ones.
  const emitted = emittedTables(parts, batchGroups, wanted);
  const cidOf = new Map(parts.map((a) => [a.name, a.cid]));
  const partUrl =
    options.partUrl ??
    (({ name }: { name: string; cid: string }): string => {
      const loc = tableLocOf(name);
      const group = loc ? batchGroups.get(loc.batchRoot) : null;
      return `${tablesDir}/${group}/${loc?.table}/${loc?.part}`;
    });
  for (const t of emitted.values()) {
    const selects = t.parts.map((name) => {
      const file = partUrl({ name, cid: cidOf.get(name) ?? "" });
      return `SELECT *, ${str(name)} AS _part FROM read_parquet(${str(file)})`;
    });
    await engine.run(
      `CREATE SCHEMA IF NOT EXISTS ${ident(t.group)}; CREATE OR REPLACE VIEW ${ident(t.group)}.${ident(t.table)} AS ${selects.join(" UNION ALL BY NAME ")}`,
    );
  }

  const tables: BoundTable[] = [...emitted.values()];
  for (const r of REQUIRED_TABLES) {
    if (!wanted(`${r.group}.${r.table}`)) continue;
    const t = emitted.get(`${r.group}.${r.table}`);
    if (t) {
      const described = await engine.all(`DESCRIBE SELECT * FROM ${r.group}.${r.table}`);
      const have = new Map(described.map((d) => [String(d.column_name), String(d.column_type)]));
      const lacking = Object.entries(r.columns)
        .filter(([c, type]) => have.get(c) !== type)
        .map(([c, type]) => `${c} ${type}`);
      if (lacking.length > 0)
        throw new Error(
          `bindManifest: ${r.group}.${r.table} lacks column(s) views.sql reads: ${lacking.join(", ")}`,
        );
      continue;
    }
    const cols = Object.entries(r.columns).map(([c, type]) => `${ident(c)} ${type}`);
    await engine.run(
      `CREATE OR REPLACE TABLE ${r.group}.${r.table} (${[...cols, "_part VARCHAR"].join(", ")})`,
    );
    tables.push({ group: r.group, table: r.table, emitted: false, parts: [] });
  }

  // meta.address_fields: the address text, ZIP and state of every address record, from the
  // county.address columns the export carries. elephant-cli export-tables emits address's fields
  // only with the oneOf-columns patch (Run 3.1, pipeline/publish/patches/); an earlier run's
  // address table has identity columns only, so each missing column binds as NULL and views.sql
  // never names a column that may not exist. meta.address_zip (the mailing ZIP) reads from it.
  // address is deliberately not a REQUIRED_TABLE (its absence or shape never fails a bind).
  if (wanted("county.address")) {
    const cols = emitted.has("county.address")
      ? await engine.all("DESCRIBE SELECT * FROM county.address")
      : [];
    const has = (name: string) => cols.some((c) => String(c.column_name) === name);
    const field = (name: string) =>
      has(name)
        ? `CAST(any_value(${name}) AS VARCHAR) AS ${name}`
        : `CAST(NULL AS VARCHAR) AS ${name}`;
    await engine.run(
      cols.length > 0
        ? `CREATE OR REPLACE TABLE meta.address_fields AS SELECT cid, ${["unnormalized_address", "postal_code", "state_code"].map(field).join(", ")} FROM county.address GROUP BY cid`
        : "CREATE OR REPLACE TABLE meta.address_fields (cid VARCHAR, unnormalized_address VARCHAR, postal_code VARCHAR, state_code VARCHAR)",
    );
    await engine.run(
      "CREATE OR REPLACE VIEW meta.address_zip AS SELECT cid, postal_code FROM meta.address_fields",
    );
  }

  const views = plan === undefined ? VIEWS_SQL : plan.statements.map((s) => s.sql).join("\n");
  await engine.run(`${STATUS_MAP_SQL}\n${deriveMacrosSql()}\n${views}`);
  return {
    runId: manifest.runId,
    manifestCid,
    asOf: manifest.finishedAt,
    tables,
    views: plan === undefined ? [...CONTRACT_VIEWS] : [...plan.views],
  };
}
