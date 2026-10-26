// Run events (A-13 T014, research R5, data-model.md RunEvent): the Runs · Log list, built only
// from manifest timestamps: each run's `startedAt`, every `sources[].captured_at` (with its source
// name), and `finishedAt` with the run's limitations. A manifest cannot carry its own publish or
// verify time (its CID is fixed before upload), so no such event is invented. Events are sorted
// ascending by time across every run; on equal times the run's own order (started, captured,
// finished) is kept.
import type { ManifestSource, RunManifestV1 } from "@countylens/contract";

export type RunEvent =
  | { readonly time: string; readonly runId: string; readonly kind: "started" }
  | {
      readonly time: string;
      readonly runId: string;
      readonly kind: "captured";
      readonly source: string;
    }
  | {
      readonly time: string;
      readonly runId: string;
      readonly kind: "finished";
      readonly limitations: readonly string[];
    };

const RANK: Record<RunEvent["kind"], number> = { started: 0, captured: 1, finished: 2 };

/**
 * Label review 2026-10-26: a source whose name and capture time an earlier run already holds was
 * carried over unchanged (Run 4 kept TCAD from 2026-10-22); its capture is that earlier run's event.
 * A first capture counts even when it precedes the run's start (Run 1 captured before it started).
 */
function ownCaptures(manifests: readonly RunManifestV1[]): Map<RunManifestV1, ManifestSource[]> {
  const seen = new Set<string>();
  const own = new Map<RunManifestV1, ManifestSource[]>();
  for (const m of [...manifests].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  )) {
    own.set(
      m,
      m.sources.filter((s) => !seen.has(`${s.name}|${s.captured_at}`)),
    );
    for (const s of m.sources) seen.add(`${s.name}|${s.captured_at}`);
  }
  return own;
}

export function runEvents(manifests: readonly RunManifestV1[]): RunEvent[] {
  const own = ownCaptures(manifests);
  const events: RunEvent[] = manifests.flatMap((m): RunEvent[] => [
    { time: m.startedAt, runId: m.runId, kind: "started" },
    ...(own.get(m) ?? []).map((s): RunEvent => ({
      time: s.captured_at,
      runId: m.runId,
      kind: "captured",
      source: s.name,
    })),
    { time: m.finishedAt, runId: m.runId, kind: "finished", limitations: m.limitations },
  ]);
  return events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        Date.parse(a.event.time) - Date.parse(b.event.time) ||
        RANK[a.event.kind] - RANK[b.event.kind] ||
        a.index - b.index,
    )
    .map(({ event }) => event);
}
