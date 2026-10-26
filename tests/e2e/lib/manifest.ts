// Manifest and tables-root helpers for the published-data cases (TC-003…005, TC-040…044).
// The `elephant-cli export-tables` output is a tables directory whose `tables.car` holds one
// dag-json "CountyTables" root block: the part size, the group's archive CAR root
// (`county_root`) and every table's parts with their CIDs and sizes. Reading that root from
// the published CAR lets the hosted tests check the manifest against the CLI output itself.
import { CarReader } from "@ipld/car";
import * as dagJson from "@ipld/dag-json";
import { CidV1, type ManifestArtifact, type RunManifestV1 } from "@countylens/contract";
import { REQUIRED_TABLES, type RequiredTable } from "@countylens/query-core";
import { z } from "zod";

/** `--part-size 48m` (PO decision D-4): 48 MiB = 50,331,648 bytes (TC-005). */
export const PART_SIZE_48M = 48 * 1024 * 1024;

/** A dag-json link, `{"/": "<cid>"}`, unwrapped to the CID string. */
const Link = z.object({ "/": CidV1 }).transform((link) => link["/"]);

const Count = z.number().int().nonnegative();

export const TablePart = z.object({ cid: Link, bytes: Count, rows: Count }).loose();
export const TableEntry = z.object({ rows: Count, parts: z.array(TablePart) }).loose();

export const TablesRoot = z
  .object({
    label: z.literal("CountyTables"),
    codec: z.string().min(1),
    part_size_bytes: z.number().int().positive(),
    county_root: Link,
    tables: z.record(z.string().min(1), TableEntry),
  })
  .loose();
export type TablesRoot = z.infer<typeof TablesRoot>;

export interface ReadTablesRoot {
  rootCid: string;
  root: TablesRoot;
  blockCount: number;
}

/** Reads the CountyTables root of a `tables.car` (its only root; every link unwrapped). */
export async function readTablesRoot(carBytes: Uint8Array): Promise<ReadTablesRoot> {
  const car = await CarReader.fromBytes(carBytes);
  const roots = await car.getRoots();
  const rootCid = roots[0];
  if (!rootCid || roots.length !== 1) {
    throw new Error(`tables.car must have exactly one root, found ${roots.length}`);
  }
  const block = await car.get(rootCid);
  if (!block) throw new Error(`tables.car does not contain its root block ${rootCid.toString()}`);
  let blockCount = 0;
  for await (const _block of car.blocks()) blockCount += 1;
  // dag-json → plain JSON (links become {"/": cid}) → Zod, so the test never handles CID objects.
  const plain: unknown = JSON.parse(
    new TextDecoder().decode(dagJson.encode(dagJson.decode(block.bytes))),
  );
  return { rootCid: rootCid.toString(), root: TablesRoot.parse(plain), blockCount };
}

/** The CID whose bytes are public for an artifact: tables by `cid`, directories and CARs by `carCid` (AM-05). */
export function publicCid(artifact: ManifestArtifact): string {
  if (artifact.kind === "table") return artifact.cid;
  if (!artifact.carCid) {
    throw new Error(`${artifact.kind} artifact ${artifact.name} has no carCid (AM-05)`);
  }
  return artifact.carCid;
}

export function artifactsOf(
  manifest: RunManifestV1,
  kind: ManifestArtifact["kind"],
): ManifestArtifact[] {
  return manifest.artifacts.filter((artifact) => artifact.kind === kind);
}

/** The data group an artifact belongs to, from its name (`tables/<group>[/…]`, `car/travis-<group>.car`).
 *  Only valid for the pilot's flat, one-batch-per-group layout (A-03). A manifest whose group
 *  spans several batch CARs (A-04/A-11, e.g. Run 1's 10 county + 2 permits batches, or any
 *  deployment-specific path prefix) does not match these literal patterns at all — use
 *  `resolveDataGroups`/`groupOfDirectory`/`groupOfTable` below instead, which resolve the group
 *  from the manifest's own structure the same way bind-manifest.ts does. */
export function groupOf(artifact: ManifestArtifact): string {
  const tables = /^tables\/([a-z_]+)(?:\/|$)/.exec(artifact.name);
  if (tables?.[1]) return tables[1];
  const car = /^car\/travis-([a-z_]+)\.car$/.exec(artifact.name);
  if (car?.[1]) return car[1];
  throw new Error(`artifact name does not name a data group: ${artifact.name}`);
}

/** A table artifact's name split into its export batch (everything before the last two path
 *  segments, at any depth) and its own table/part — mirrors
 *  packages/query-core/src/bind-manifest.ts's `tableLocOf`, since this test must resolve a
 *  batch's data group the exact same way a bound run resolves it. */
function tableLocOf(name: string): { batchRoot: string; table: string } | null {
  const segs = name.split("/");
  if (segs.length < 3) return null;
  const part = segs[segs.length - 1];
  const table = segs[segs.length - 2];
  if (!part || !table) return null;
  return { batchRoot: segs.slice(0, -2).join("/"), table };
}

/** REQUIRED_TABLES table names that name exactly one group — the anchors the majority vote
 *  trusts. Mirrors bind-manifest.ts's `GROUP_OF_REQUIRED_TABLE`, built from the same
 *  `REQUIRED_TABLES` the bound run uses, so the manifest test and the query engine never
 *  disagree about which group a table name belongs to. */
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
 * The data group of every export batch (one `tableLocOf` batchRoot) in a manifest, resolved by a
 * majority vote of its table names over `GROUP_OF_REQUIRED_TABLE` — the same resolution
 * bind-manifest.ts's `resolveBatchGroups` performs, so this test agrees with the bound run on
 * which group a batch belongs to no matter how many batches a group spans (Run 1: 10 county + 2
 * property_improvement/"permits" batches) or what the deployment-specific path prefix is.
 */
export function resolveDataGroups(manifest: RunManifestV1): ReadonlyMap<string, string> {
  const byBatch = new Map<string, string[]>();
  for (const artifact of manifest.artifacts) {
    if (artifact.kind !== "table") continue;
    const loc = tableLocOf(artifact.name);
    if (!loc) continue;
    const tables = byBatch.get(loc.batchRoot) ?? [];
    tables.push(loc.table);
    byBatch.set(loc.batchRoot, tables);
  }
  const resolved = new Map<string, string>();
  for (const [batchRoot, tables] of byBatch) {
    const votes = new Map<string, number>();
    for (const table of tables) {
      const group = GROUP_OF_REQUIRED_TABLE.get(table);
      if (group) votes.set(group, (votes.get(group) ?? 0) + 1);
    }
    let winner: string | null = null;
    let max = 0;
    for (const [group, count] of votes) {
      if (count > max) {
        winner = group;
        max = count;
      }
    }
    if (winner) resolved.set(batchRoot, winner);
  }
  return resolved;
}

/** A table artifact's own export batch's data group (its `tableLocOf` batchRoot looked up in
 *  `resolveDataGroups`'s result). */
export function groupOfTable(
  groups: ReadonlyMap<string, string>,
  artifact: ManifestArtifact,
): string | null {
  const loc = tableLocOf(artifact.name);
  return loc ? (groups.get(loc.batchRoot) ?? null) : null;
}

/** A directory artifact's data group. A directory's own name *is* its export batch's batchRoot
 *  (the export-tables layout: `tables/<group>` in the pilot, `<run-dir>/…/tables/<bNN>` in
 *  A-04/A-11's full-county batching), so it is looked up directly in `resolveDataGroups`'s result. */
export function groupOfDirectory(
  groups: ReadonlyMap<string, string>,
  artifact: ManifestArtifact,
): string | null {
  return groups.get(artifact.name) ?? null;
}

/** Whether a table artifact's export batch is the one a given directory artifact names
 *  (`tableLocOf`'s batchRoot equals the directory's own name) — groups a group's many batches'
 *  tables back to the one directory/CAR pair each batch produced. */
export function tableInDirectory(table: ManifestArtifact, directory: ManifestArtifact): boolean {
  return tableLocOf(table.name)?.batchRoot === directory.name;
}

/** Every `ipfs/<cid>` key the CID copy may hold for one run: its artifacts and the manifest itself. */
export function expectedCidCopyKeys(manifest: RunManifestV1, manifestCid: string): Set<string> {
  const keys = new Set<string>([`ipfs/${manifestCid}`]);
  for (const artifact of manifest.artifacts) keys.add(`ipfs/${publicCid(artifact)}`);
  return keys;
}

/** Content types by artifact kind (contracts/storage.md "Object headers"). */
export const CONTENT_TYPES: Record<ManifestArtifact["kind"] | "manifest", string> = {
  table: "application/vnd.apache.parquet",
  car: "application/vnd.ipld.car",
  directory: "application/vnd.ipld.car",
  manifest: "application/json",
};

/** CIDv0 (`Qm…`) must never appear anywhere in a published manifest (constitution A3). */
export const CID_V0_PATTERN = /\bQm[1-9A-HJ-NP-Za-km-z]{44}\b/;
