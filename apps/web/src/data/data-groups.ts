// The Runs page's data-group items (TC-013): every tables directory of the manifest with the data
// group it belongs to, resolved by query-core's own batch rule (the same one bindManifest binds
// with), and its position among that group's batches. A pilot run has one directory per group
// named `tables/<group>`; a full-county run has several export batches per group, whose directory
// names are run paths (`…/county-batched/tables/b01`), never a group name.
import type { ManifestArtifact, RunManifestV1 } from "@countylens/contract";
import { resolveBatchGroups } from "@countylens/query-core";

export interface DataGroupItem {
  readonly artifact: ManifestArtifact;
  /** `county` or `property_improvement`; null only if the manifest's tables name no group. */
  readonly group: string | null;
  /** 1-based position among the group's batches, in manifest order. */
  readonly batch: number;
  /** How many batches the group has (1 for a pilot run). */
  readonly batches: number;
}

export function dataGroupItems(manifest: Pick<RunManifestV1, "artifacts">): DataGroupItem[] {
  const groups = resolveBatchGroups(
    manifest.artifacts.filter((a) => a.kind === "table").map((a) => a.name),
  );
  const directories = manifest.artifacts.filter((a) => a.kind === "directory");
  const groupOf = (artifact: ManifestArtifact): string | null => groups.get(artifact.name) ?? null;
  const totals = new Map<string | null, number>();
  for (const d of directories) totals.set(groupOf(d), (totals.get(groupOf(d)) ?? 0) + 1);
  const seen = new Map<string | null, number>();
  return directories.map((artifact) => {
    const group = groupOf(artifact);
    const batch = (seen.get(group) ?? 0) + 1;
    seen.set(group, batch);
    return { artifact, group, batch, batches: totals.get(group) ?? 1 };
  });
}
