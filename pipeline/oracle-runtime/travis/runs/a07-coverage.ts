// A-07 T053 (contracts/report.md § "Required metrics", data-model.md § "Manifest coverage
// contribution"): assembles the six required manifest-coverage rows from each track's own
// report JSON files — never a direct Query DB read (AD-04, query-db-loading-matching
// "Handoff to publication"). This module only hands off the shape; A-11's manifest builder
// publishes it.
//
// Tracks B (BBB) and C (business/places) built no report files this pass (the PO's cost-mode
// scope decision, 2026-10-22): their rows degrade to the documented-gap shape rather than
// crashing, reusing the same "<Group>: not loaded · {reason}" limitation pattern FR-013 already
// established for a licence-gate failure, with reason `track_not_built`.
import { readFileSync } from "node:fs";

export type ManifestDerivation = "published_rows" | "capture_receipt" | "aggregate_match";

export interface ManifestCoverageRow {
  metric: string;
  value: unknown;
  derivation: ManifestDerivation;
  limitation: string | null;
}

export interface AssembleA07CoverageOptions {
  /** Track A, T020's resolution-report.json. Required: Track A always builds this run. */
  identityReportPath: string;
  /** Track B, T034's status-report.json. Undefined when Track B was not built this pass. */
  bbbReportPath?: string | undefined;
  /** Track C, T042's business-coverage-report.json. Undefined when Track C was not built. */
  businessReportPath?: string | undefined;
  /** Track C, T043/T045's overture-probe-report.json / tables-export.json. Undefined likewise. */
  placesReportPath?: string | undefined;
  /** Track D, T056/T057's merge report (either file: both carry all three entity types' current
   *  state via ReconcileReport, so whichever one exists is equally complete). Required. */
  mergeReportPath: string;
  /** Track D, T060's full-roll-report.json. Required: Track D always builds this run. */
  roofAgeReportPath: string;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return null;
    throw error;
  }
}

function fiveStateTotalsRow(identityReport: Record<string, unknown>): ManifestCoverageRow {
  const nested = identityReport.fiveStateTotals as Record<string, unknown> | undefined;
  const source = nested ?? identityReport;
  const totals = {
    resolved: Number(source.resolved ?? 0),
    candidate: Number(source.candidate ?? 0),
    ambiguous: Number(source.ambiguous ?? 0),
    conflicting: Number(source.conflicting ?? 0),
    unresolved: Number(source.unresolved ?? 0),
  };
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  const permitTotal = Number(identityReport.permitTotal ?? sum);
  return {
    metric: "contractor_five_state_totals",
    value: totals,
    derivation: "aggregate_match",
    limitation:
      sum === permitTotal
        ? null
        : `five-state sum ${sum} does not equal permit total ${permitTotal}`,
  };
}

function bbbStatusRow(bbbReportPath: string | undefined): ManifestCoverageRow {
  const report = bbbReportPath === undefined ? null : readJson(bbbReportPath);
  if (report === null) {
    return {
      metric: "bbb_status_counts",
      value: null,
      derivation: "aggregate_match",
      limitation: "BBB: not run this pass · track_not_built",
    };
  }
  const resolved = Number(report.resolved ?? 0);
  return {
    metric: "bbb_status_counts",
    value: { resolved, counts: report.counts ?? {}, coveragePct: report.coveragePct ?? null },
    derivation: "aggregate_match",
    limitation: resolved === 0 ? "not computable: 0 resolved companies" : null,
  };
}

function businessCountRow(businessReportPath: string | undefined): ManifestCoverageRow {
  const report = businessReportPath === undefined ? null : readJson(businessReportPath);
  if (report === null) {
    return {
      metric: "business_count",
      value: null,
      derivation: "capture_receipt",
      limitation: "Business: not loaded this pass · track_not_built",
    };
  }
  const loaded = Number(report.loadedCount ?? 0);
  const source = Number(report.sourceCount ?? loaded);
  return {
    metric: "business_count",
    value: { loadedCount: loaded, sourceCount: source },
    derivation: "capture_receipt",
    limitation:
      loaded === source
        ? null
        : `loaded count ${loaded} differs from source count ${source} at the watermark`,
  };
}

function placesCountRow(placesReportPath: string | undefined): ManifestCoverageRow {
  const report = placesReportPath === undefined ? null : readJson(placesReportPath);
  if (report === null) {
    return {
      metric: "places_count_by_category",
      value: null,
      derivation: "published_rows",
      limitation: "Places: not loaded · track_not_built",
    };
  }
  const gatePassed = report.licenceGatePassed === true;
  return {
    metric: "places_count_by_category",
    value: gatePassed ? (report.countsByCategory ?? report.counts ?? null) : null,
    derivation: "published_rows",
    limitation: gatePassed
      ? null
      : `Places: not loaded · ${String(report.reason ?? "licence_gate_failed")}`,
  };
}

function mergeCountsRow(mergeReportPath: string): ManifestCoverageRow {
  const report = readJson(mergeReportPath);
  const entityTypes = (report?.entityTypes ?? {}) as Record<
    string,
    { refused?: unknown } | undefined
  >;
  const refusedEntityTypes = Object.entries(entityTypes)
    .filter(([, v]) => Number(v?.refused ?? 0) > 0)
    .map(([k]) => k);
  return {
    metric: "merge_counts",
    value: entityTypes,
    derivation: "aggregate_match",
    limitation:
      refusedEntityTypes.length === 0
        ? null
        : `refused cross-TCAD merges on: ${refusedEntityTypes.join(", ")}`,
  };
}

function roofAgeCoverageRow(roofAgeReportPath: string): ManifestCoverageRow {
  const report = readJson(roofAgeReportPath) ?? {};
  const apply = report.apply as Record<string, unknown> | undefined;
  const coverage = (apply?.coverage ?? report.coverage ?? report) as Record<string, unknown>;
  const byBasis = (coverage.byBasis ?? {}) as Record<string, unknown>;
  const total = coverage.total ?? null;
  const basisSum = Object.values(byBasis).reduce((a: number, b) => a + Number(b ?? 0), 0);
  const sumMismatch = total !== null && basisSum !== Number(total);
  return {
    metric: "roof_age_coverage",
    value: {
      byBasis,
      byConfidence: coverage.byConfidence ?? {},
      total,
      ...(report.coveragePctByBasis !== undefined ? { pctByBasis: report.coveragePctByBasis } : {}),
      ...(report.coveragePctByConfidence !== undefined
        ? { pctByConfidence: report.coveragePctByConfidence }
        : {}),
    },
    derivation: "aggregate_match",
    limitation: sumMismatch
      ? `roof-age basis counts (${basisSum}) do not sum to the reported total (${String(total)})`
      : null,
  };
}

/** Assembles the six required manifest-coverage rows (contracts/report.md) for this A-07 run. */
export function assembleA07Coverage(options: AssembleA07CoverageOptions): ManifestCoverageRow[] {
  const identityReport = readJson(options.identityReportPath);
  if (identityReport === null) {
    throw new Error(`a07-coverage: identity report not found at ${options.identityReportPath}`);
  }
  return [
    fiveStateTotalsRow(identityReport),
    bbbStatusRow(options.bbbReportPath),
    businessCountRow(options.businessReportPath),
    placesCountRow(options.placesReportPath),
    mergeCountsRow(options.mergeReportPath),
    roofAgeCoverageRow(options.roofAgeReportPath),
  ];
}
