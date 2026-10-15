import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "../core/db.js";
import { sqlString } from "../core/db.js";

export type ExportedTable = { name: string; file: string; rows: number; description: string };

export const EXPORT_TABLES: { name: string; sql: string; description: string; dir?: string }[] = [
  {
    name: "property_leads",
    sql: "SELECT * FROM property_leads",
    description:
      "One row per Travis parcel: situs, coordinates, owner + mailing address, owner location class, roof year/age with basis and evidence permit, roofing-permit rollups, provenance.",
  },
  {
    name: "roofing_permits",
    sql: "SELECT * FROM roofing_permits",
    description:
      "In-county roofing permits with status, open duration, expired-without-final flag, contractor identity, business/BBB links and provenance.",
  },
  {
    name: "permits",
    sql: `SELECT p.* EXCLUDE (is_deleted), s.prop_id, s.match_method AS parcel_match_method, s.in_county
          FROM permits p LEFT JOIN permit_scope s USING (permit_number) WHERE NOT p.is_deleted`,
    description:
      "All ingested City of Austin construction permits with parcel resolution and county scope.",
  },
  {
    name: "parcels",
    sql: "SELECT * EXCLUDE (is_deleted) FROM parcels WHERE NOT is_deleted",
    description:
      "TCAD-contributed StratMap parcel attributes (owner, situs, mailing, values, land use) with provenance.",
  },
  {
    name: "contractors",
    sql: `SELECT c.*, bl.taxpayer_number, bl.match_method AS business_match_method, pl.place_id, bb.bbb_id
          FROM contractors c
          LEFT JOIN contractor_business_links bl USING (contractor_id)
          LEFT JOIN contractor_place_links pl USING (contractor_id)
          LEFT JOIN contractor_bbb_links bb USING (contractor_id)`,
    description:
      "Contractors reconciled across permit name variants (normalized name key), linked to Comptroller business records, Overture places and BBB profiles where unambiguous.",
  },
  {
    name: "contractor_ambiguous_links",
    sql: "SELECT * FROM contractor_ambiguous_links",
    description:
      "Contractors whose name key matched several business records; preserved unlinked for review.",
  },
  {
    name: "businesses",
    sql: "SELECT * EXCLUDE (is_deleted) FROM businesses WHERE NOT is_deleted",
    description:
      "Texas Comptroller active franchise taxpayers registered in Travis County (code 227).",
  },
  {
    name: "places",
    sql: "SELECT * EXCLUDE (is_deleted) FROM places WHERE NOT is_deleted",
    description:
      "Overture Maps places clipped to the Travis County boundary (OSM-sourced rows excluded).",
  },
  {
    name: "bbb_profiles",
    sql: "SELECT * EXCLUDE (is_deleted) FROM bbb_profiles WHERE NOT is_deleted",
    description: "BBB contractor profiles (empty until a BBB harvest runs from US egress).",
  },
  {
    name: "tcad_properties",
    sql: "SELECT * EXCLUDE (is_deleted) FROM tcad_properties WHERE NOT is_deleted",
    description:
      "TCAD appraisal-roll fields (deed date, year built, roof attributes); empty until the export is ingested from US egress.",
  },
  {
    name: "geo_places",
    sql: "SELECT * EXCLUDE (is_deleted) FROM geo_places WHERE NOT is_deleted",
    description:
      "Census incorporated places and CDPs with internal points, used to geocode city names for radius queries.",
  },
  {
    name: "parcel_geometries",
    sql: "SELECT prop_id, ST_AsWKB(geom) AS geom_wkb FROM parcel_geometries",
    description: "Parcel polygons (WKB, EPSG:4326) keyed by prop_id.",
    dir: "geo",
  },
  {
    name: "county_boundary",
    sql: "SELECT geoid, name, ST_AsWKB(geom) AS geom_wkb, source_url, raw_sha256, collected_at FROM county_boundary",
    description: "Census TIGER county polygon used for scope clipping.",
    dir: "geo",
  },
];

export async function exportSnapshot(
  db: Db,
  outDir: string,
  extras: { runSummary: unknown; coverage: unknown },
): Promise<ExportedTable[]> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, "tables"), { recursive: true });
  await mkdir(path.join(outDir, "geo"), { recursive: true });
  await mkdir(path.join(outDir, "samples"), { recursive: true });
  const exported: ExportedTable[] = [];
  const schema: Record<string, { description: string; columns: { name: string; type: string }[] }> =
    {};
  for (const t of EXPORT_TABLES) {
    const rel = path.join(t.dir ?? "tables", `${t.name}.parquet`);
    const file = path.join(outDir, rel);
    await db.exec(
      `COPY (${t.sql}) TO ${sqlString(file)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)`,
    );
    const rows = Number(await db.scalar(`SELECT count(*) FROM read_parquet(${sqlString(file)})`));
    const cols = await db.all<{ column_name: string; column_type: string }>(
      `DESCRIBE SELECT * FROM read_parquet(${sqlString(file)})`,
    );
    schema[t.name] = {
      description: t.description,
      columns: cols.map((c) => ({ name: c.column_name, type: c.column_type })),
    };
    exported.push({ name: t.name, file: rel, rows, description: t.description });
  }
  const sample = await db.all(
    `SELECT * FROM property_leads WHERE roof_age_years >= 15 AND open_roofing_permit_count > 0 ORDER BY oldest_open_roofing_permit_days DESC NULLS LAST LIMIT 50`,
  );
  await writeFile(
    path.join(outDir, "samples", "aged_roof_open_permit_leads.json"),
    JSON.stringify(sample, null, 2),
  );
  const permitSample = await db.all(
    `SELECT * FROM roofing_permits WHERE is_open ORDER BY open_days DESC NULLS LAST LIMIT 50`,
  );
  await writeFile(
    path.join(outDir, "samples", "longest_open_roofing_permits.json"),
    JSON.stringify(permitSample, null, 2),
  );
  await writeFile(path.join(outDir, "schema.json"), JSON.stringify(schema, null, 2));
  await writeFile(path.join(outDir, "tables.json"), JSON.stringify(exported, null, 2));
  await writeFile(path.join(outDir, "run.json"), JSON.stringify(extras.runSummary, null, 2));
  await writeFile(path.join(outDir, "coverage.json"), JSON.stringify(extras.coverage, null, 2));
  await writeFile(path.join(outDir, "NOTICE.txt"), NOTICE);
  return exported;
}

const NOTICE = `Travis County, TX property intelligence snapshot

Sources and attribution:
- Parcels: Texas Geographic Information Office (TxGIO) StratMap Land Parcels, compiled from Travis Central Appraisal District data. Informational only; not a survey.
- Permits: City of Austin Open Data Portal, "Issued Construction Permits" (data.austintexas.gov, 3syk-w9eu).
- Businesses: Texas Comptroller of Public Accounts, "Active Franchise Taxpayers" (data.texas.gov, 9cir-efmm).
- Places: Overture Maps Foundation places theme (CDLA-Permissive-2.0 / per-source licences recorded in source_datasets); OSM-sourced rows excluded.
- Boundaries and place centroids: US Census Bureau TIGERweb.

Every row carries source_id, source_url, raw_sha256 and collected_at provenance. See run.json for the run history,
source limitations and record deltas, and the artifact manifest for content identifiers (CIDs).
`;
