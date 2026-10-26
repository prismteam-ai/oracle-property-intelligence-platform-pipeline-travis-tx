// One-off operator command `npm --prefix pipeline/oracle-runtime run backfill-amendments`
// (offline, no network; review findings OR-M5, OR-m2, OR-n2, CR-3).
//
// The committed catalog was changed by offline commands before they recorded amendments.
// This command records that history ONCE, from git history and the committed evidence,
// and migrates the fields the review added, without changing any measured value:
// - `amendments[]`: the past changes (rescan-tcad, refresh-tcad-landing, record-gis-runner,
//   reprobe-jurisdictions, explain-blocked, reconcile-parcel-gap and the hand-written
//   approved exception), each with the time basis stated in its note;
// - `discovery_run_id: travis-2`: the run that wrote the catalog (and whose
//   waiting_human_hours it records); `resolve` refuses any other run;
// - tcad_gis: its operator-side stop moves from `blocked_evidence` to
//   `operator_blocked_evidence` (the row is available), and its earlier stop files are
//   listed as superseded;
// - the four re-probed permit rows get `reprobe_count`, `reprobed_at`,
//   `reprobe_url_changed` and the evidence they supersede (the files are never edited).
// It refuses (exit 2, nothing written) when the catalog already carries amendments or a
// run id, so it cannot run twice.
//
// `-- --venue` (CR2-3 / OR-N2, offline): stamps `venue` on every amendment that has none:
// record-gis-runner ran on the US GitHub Actions runner ("runner"), every other command on
// the operator's network ("operator"). It records its own amendment and refuses (exit 2)
// when every amendment already has a venue, so it runs once only.
//
// Exit codes: 0 written, 2 refused.
import { pathToFileURL } from "node:url";
import { redact } from "../lib/log.js";
import type { Amendment, Catalog, Jurisdiction, Source } from "./catalog.schema.js";
import { amendCatalog, DEFAULT_CATALOG_PATH, readCatalog } from "./write-catalog.js";

export const DISCOVERY_RUN_ID = "travis-2";
const BASIS_COMMIT = (sha: string): string =>
  `time is the commit time of ${sha}; the command ran shortly before it`;

/** The past offline changes, oldest first (git history and docs/evidence/A-01.md). */
export const PAST_AMENDMENTS: readonly Amendment[] = [
  {
    command: "rescan-tcad",
    venue: "operator",
    at: "2026-10-20T06:12:39Z",
    fields: [
      "parcel.identifier_name",
      "parcel.identifier_layout_name",
      "parcel.identifier_proven",
      "parcel.identifier_format",
    ],
    ref: "pipeline/data/raw/tcad/2026_20Certified_20JSON_20SUPP_200_2007182026.zip (export SHA-256 6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346)",
    note: `recorded by backfill-amendments; ${BASIS_COMMIT("b93bc44")}`,
  },
  {
    command: "refresh-tcad-landing",
    venue: "operator",
    at: "2026-10-20T06:19:52.331Z",
    fields: ["parcel.certification_date_measurement"],
    ref: "pipeline/data/raw/tcad/publicinformation-20261020T061952Z.html (SHA-256 1d5dd5c3c4fe4ae4800023bcd9d0365f42316090839a4323c23b6cf61f9a27bf)",
    note: "recorded by backfill-amendments; time is the page capture time; one identified request, egress not recorded (made before the egress check existed)",
  },
  {
    command: "record-gis-runner",
    venue: "runner",
    at: "2026-10-20T08:05:12Z",
    fields: [
      "parcel.gis_feature_count",
      "parcel.gis_feature_count_measurement",
      "parcel.gap_pct",
      "parcel.gap_reason",
      "parcel.discrepancy_explanation",
      "sources[tcad_gis]",
    ],
    ref: "https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39387019700 (body SHA-256 751ea63e3a6565108c8af9faa18aedf81990818d913a97002fcd8887aa160b6f)",
    egress_country: "US",
    note: `recorded by backfill-amendments; ${BASIS_COMMIT("fdf16d8")}; the request ran on the US GitHub Actions runner at 2026-10-20T07:31:05Z`,
  },
  {
    command: "reprobe-jurisdictions",
    venue: "operator",
    at: "2026-10-20T08:53:13.590Z",
    fields: [
      "permits.jurisdictions[austin]",
      "permits.jurisdictions[bee_cave]",
      "permits.jurisdictions[rollingwood]",
      "permits.jurisdictions[san_leanna]",
    ],
    ref: "docs/evidence/blocked/jurisdiction-rollingwood-20261020T085309Z.md, docs/evidence/blocked/jurisdiction-san_leanna-20261020T085313Z.md",
    egress_country: "EG",
    note: "recorded by backfill-amendments; time is the last re-probe capture; egress EG (operator network, VPN off) per docs/decisions/DEC-A-01-source-access.md D-3, not checked by the command at the time; the San Leanna re-probe was a request to a firewall-blocked site (deviation D-3)",
  },
  {
    command: "explain-blocked",
    venue: "operator",
    at: "2026-10-20T08:56:20Z",
    fields: [
      "permits.jurisdictions[*].blocked_explanation",
      "permits.jurisdictions[*].notes",
      "sources[bbb].next_step",
      "enrichment.bbb.next_step",
    ],
    ref: "PO decision 2026-10-20 (no request filed); committed evidence files; no request made",
    note: `recorded by backfill-amendments; ${BASIS_COMMIT("9ae3f5f")}`,
  },
  {
    command: "reconcile-parcel-gap",
    venue: "operator",
    at: "2026-10-20T10:46:22Z",
    fields: [
      "parcel.account_breakdown",
      "parcel.gap_reconciliation",
      "parcel.gap_reason",
      "parcel.discrepancy_explanation",
      "parcel.separately_assessed_without_geometry",
    ],
    ref: "pipeline/data/raw/tcad/2026_20Certified_20JSON_20SUPP_200_2007182026.zip (export SHA-256 6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346)",
    note: `recorded by backfill-amendments; ${BASIS_COMMIT("14b88ee")}`,
  },
  {
    command: "hand edit (no command)",
    venue: "operator",
    at: "2026-10-20T11:10:06Z",
    fields: ["approved_exceptions[parcel]"],
    ref: "PO approval 2026-10-20 (HebaGaber)",
    note: `recorded by backfill-amendments; ${BASIS_COMMIT("e5f5d77")}; the entry was written by hand and is replaced by approve-exception`,
  },
];

const GIS_SUPERSEDED = [
  "docs/evidence/blocked/tcad_gis-20261019T210845Z.md",
  "docs/evidence/blocked/tcad_gis-20261019T212423Z.md",
  "docs/evidence/blocked/tcad_gis-20261020T053344Z.md",
];

/** The re-probes of 2026-10-20, from the committed evidence files (OR-m2). */
export const PAST_REPROBES: Readonly<
  Record<
    string,
    { at: string; url_changed: boolean; superseded: Jurisdiction["superseded_evidence"] }
  >
> = {
  austin: {
    at: "2026-10-20T08:52:56.645Z",
    url_changed: false,
    superseded: [
      {
        evidence_path: "docs/evidence/blocked/jurisdiction-austin-20261019T210901Z.md",
        superseded_by:
          "re-probe at 2026-10-20T08:52:56.645Z answered HTTP 200 (no new evidence file)",
      },
    ],
  },
  bee_cave: {
    at: "2026-10-20T08:53:06.060Z",
    url_changed: true,
    superseded: [
      {
        evidence_path: "docs/evidence/blocked/jurisdiction-bee_cave-20261019T210913Z.md",
        superseded_by:
          "probe of a new evidence URL at 2026-10-20T08:53:06.060Z answered HTTP 200 (no new evidence file)",
      },
    ],
  },
  rollingwood: {
    at: "2026-10-20T08:53:09.863Z",
    url_changed: true,
    superseded: [
      {
        evidence_path: "docs/evidence/blocked/jurisdiction-rollingwood-20261019T210933Z.md",
        superseded_by: "docs/evidence/blocked/jurisdiction-rollingwood-20261020T085309Z.md",
      },
    ],
  },
  san_leanna: {
    at: "2026-10-20T08:53:13.590Z",
    url_changed: false,
    superseded: [
      {
        evidence_path: "docs/evidence/blocked/jurisdiction-san_leanna-20261019T210935Z.md",
        superseded_by: "docs/evidence/blocked/jurisdiction-san_leanna-20261020T085313Z.md",
      },
    ],
  },
};

class Refusal extends Error {}

function migrateGis(source: Source): Source {
  if (source.key !== "tcad_gis" || source.status !== "available" || !source.blocked_evidence) {
    return source;
  }
  const { blocked_evidence: stop, ...rest } = source;
  return {
    ...rest,
    operator_blocked_evidence: stop,
    superseded_evidence: GIS_SUPERSEDED.map((path) => ({
      evidence_path: path,
      superseded_by: stop.evidence_path,
    })),
  };
}

/** The migrated catalog (pure); refuses a catalog that was already migrated. */
export function backfill(catalog: Catalog): Catalog {
  if ((catalog.amendments ?? []).length > 0) {
    throw new Refusal("the catalog already carries amendments; the backfill runs once only");
  }
  if (catalog.discovery_run_id !== undefined) {
    throw new Refusal(`the catalog already records run ${catalog.discovery_run_id}`);
  }
  const { county, state, slug, fips, snapshot_time, ...rest } = catalog;
  const out: Catalog = {
    county,
    state,
    slug,
    fips,
    snapshot_time,
    discovery_run_id: DISCOVERY_RUN_ID,
    ...rest,
    sources: catalog.sources.map(migrateGis),
    amendments: [...PAST_AMENDMENTS],
  };
  if (catalog.permits) {
    out.permits = {
      ...catalog.permits,
      jurisdictions: catalog.permits.jurisdictions.map((row) => {
        const past = PAST_REPROBES[row.key];
        if (!past) return row;
        return {
          ...row,
          reprobe_count: 1,
          reprobed_at: past.at,
          reprobe_url_changed: past.url_changed,
          ...(past.superseded ? { superseded_evidence: past.superseded } : {}),
        };
      }),
    };
  }
  return out;
}

/** Where each past command ran (CR2-3 / OR-N2): only record-gis-runner ran on a CI runner. */
export function venueOf(command: string): "operator" | "runner" {
  return command === "record-gis-runner" ? "runner" : "operator";
}

/** The catalog with `venue` on every amendment (pure); refuses when none is missing. */
export function backfillVenue(catalog: Catalog): Catalog {
  const list = catalog.amendments ?? [];
  if (!list.some((a) => a.venue === undefined)) {
    throw new Refusal(
      "every amendment already records its venue; the venue backfill runs once only",
    );
  }
  return {
    ...catalog,
    amendments: list.map((a) => (a.venue === undefined ? { ...a, venue: venueOf(a.command) } : a)),
  };
}

export interface BackfillOptions {
  /** CR2-3: stamp the amendment venues instead of the one-off history backfill. */
  venue?: boolean;
  catalogPath?: string;
  now?: () => Date;
  out?: (line: string) => void;
}

export function main(options: BackfillOptions = {}): number {
  const out =
    options.out ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const catalogPath = options.catalogPath ?? DEFAULT_CATALOG_PATH;
  const now = (options.now ?? (() => new Date()))();
  if (options.venue) {
    try {
      const next = backfillVenue(readCatalog(catalogPath));
      amendCatalog(
        next,
        {
          command: "backfill-amendments --venue",
          venue: "operator",
          fields: ["amendments[*].venue"],
          ref: "docs/reviews/CR-A-01.md CR2-3 / OR-N2; the record-gis-runner amendment note (US GitHub Actions runner)",
          note: "offline migration; record-gis-runner is runner, every other command operator; no measured value changed",
        },
        catalogPath,
        now,
      );
      out("backfill-amendments: recorded the venue of every amendment");
      return 0;
    } catch (error) {
      out(
        redact(
          `backfill-amendments: refused: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return 2;
    }
  }
  try {
    const next = backfill(readCatalog(catalogPath));
    amendCatalog(
      next,
      {
        command: "backfill-amendments",
        venue: "operator",
        fields: [
          "amendments (history)",
          "discovery_run_id",
          "sources[tcad_gis].operator_blocked_evidence",
          "sources[tcad_gis].superseded_evidence",
          "permits.jurisdictions[austin,bee_cave,rollingwood,san_leanna].reprobe_*",
        ],
        ref: "git history (b93bc44, 0f5922a, fdf16d8, 9ae3f5f, 14b88ee, e5f5d77) and docs/evidence/",
        note: "one-off migration for the review findings; no measured value changed",
      },
      catalogPath,
      now,
    );
    out(
      `backfill-amendments: recorded ${PAST_AMENDMENTS.length} past amendments; discovery_run_id ${DISCOVERY_RUN_ID}`,
    );
    return 0;
  } catch (error) {
    out(
      redact(
        `backfill-amendments: refused: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main({ venue: process.argv.slice(2).includes("--venue") });
}
