// Coverage rows (A-13 T014, research R10, data-model.md CoverageRow; AD-04, PO D-4): one row per
// manifest `coverage` key with its count, derivation and note, read only from the manifest. An
// unknown key is tolerated (labelled by its key), never thrown on. Denominators are coverage keys
// `source_total:{source}` (the A-11 input); a source without one shows "denominator not in this
// run's manifest · source {name}" and no number. Collection time is the source's captured_at.
import type { RunManifestV1 } from "@countylens/contract";
import { safeHttpUrl } from "./safe-url";
import {
  COVERAGE_LABELS,
  COVERAGE_TEXTS,
  DERIVATION_LABELS,
  type Derivation,
} from "@countylens/shared";

export const SOURCE_TOTAL_PREFIX = "source_total:";

export interface CoverageRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly derivation: Derivation;
  readonly derivationLabel: string;
  readonly note: string | null;
}

export interface DenominatorRow {
  readonly source: string;
  /** The source URL when it is http(s); undefined for anything else (never rendered as a link). */
  readonly sourceUrl: string | undefined;
  readonly capturedAt: string;
  readonly count: number | null;
  readonly derivation: Derivation | null;
  /** The missing reason in words when the manifest has no `source_total:{source}` key. */
  readonly missingText: string | null;
}

const LABELS: Readonly<Record<string, string | undefined>> = COVERAGE_LABELS;

/** Every coverage key except the denominators, sorted by key. */
export function coverageRows(manifest: RunManifestV1): CoverageRow[] {
  return Object.entries(manifest.coverage)
    .filter(([key]) => !key.startsWith(SOURCE_TOTAL_PREFIX))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, c]) => ({
      key,
      label: LABELS[key] ?? key,
      count: c.count,
      derivation: c.derivation,
      derivationLabel: DERIVATION_LABELS[c.derivation],
      note: c.note ?? null,
    }));
}

/** One row per manifest source, in manifest order. */
export function denominatorRows(manifest: RunManifestV1): DenominatorRow[] {
  return manifest.sources.map((s) => {
    const total = manifest.coverage[`${SOURCE_TOTAL_PREFIX}${s.name}`];
    return {
      source: s.name,
      sourceUrl: safeHttpUrl(s.url),
      capturedAt: s.captured_at,
      count: total?.count ?? null,
      derivation: total?.derivation ?? null,
      missingText: total === undefined ? COVERAGE_TEXTS.denominatorMissingFor(s.name) : null,
    };
  });
}
