// Operator command `npm --prefix pipeline/oracle-runtime run refresh-tcad-landing`
// (FR-003a, PO decision 2026-10-20).
//
// Makes ONE identified request (the project source client: same User-Agent, attempt budget
// 1, so even a 429 is not retried) to the TCAD public-information page, saves the HTML and
// a receipt beside it under pipeline/data/raw/tcad/ (gitignored), reads the certification
// date the page states, and rewrites only parcel.certification_date and
// parcel.certification_date_measurement in pipeline/docs/travis-sources.yaml. When the
// page states no certification date, the date is recorded as missing with the reason; the
// export file name's date is never used. Then the readiness validator runs again.
//
// `--html <saved page>` re-reads a page this command saved earlier, with its saved receipt's
// provenance, and makes no request (for a parser fix without a second request).
//
// OR-B1: before the request, the egress country is checked against the run's recorded
// egress (or ORACLE_EXPECT_EGRESS); a mismatch refuses with nothing sent. The country is
// saved in the page receipt and the catalog amendment (OR-M5).
//
// Exit codes: 0 validator PASS, 1 validator BLOCKED (passed through), 2 refused (nothing written).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { catalogEgressReference, checkEgress, type EgressCheck } from "../lib/egress.js";
import { redact } from "../lib/log.js";
import { createSourceClient, type SourceClient } from "../lib/source-client.js";
import { DEFAULT_REPO_ROOT } from "./blocked-evidence.js";
import type { Parcel } from "./assemble.js";
import type { CertificationDateMeasurement } from "./catalog.schema.js";
import { missingReason } from "./probes/common.js";
import { ChallengeFreePage } from "./probes/evidence.js";
import { findTcadLinks, TCAD_PUBLIC_INFO_URL } from "./probes/tcad.js";
import { main as runValidatorMain } from "./run-validator.js";
import { amendCatalog, DEFAULT_CATALOG_PATH, readCatalog } from "./write-catalog.js";

export const CERTIFICATION_METHOD = "certification date as stated in the page text";
const RAW_REL = "pipeline/data/raw/tcad";

/** What is saved beside the page: enough to re-read it offline with the same provenance. */
const SavedReceiptSchema = z.object({
  url: z.url(),
  status: z.int(),
  bytes: z.int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  captured_at: z.string(),
  user_agent: z.string(),
  attempts: z.int().positive(),
  outcome: z.string(),
  /** Egress country of the request (OR-B1); absent on receipts saved before the check existed. */
  egress_country: z.string().optional(),
});
type SavedReceipt = z.infer<typeof SavedReceiptSchema>;

export interface RefreshOptions {
  repoRoot?: string;
  catalogPath?: string;
  client?: SourceClient;
  /** Re-read this saved page (and its `.receipt.json`) instead of making a request. */
  htmlPath?: string;
  validate?: () => Promise<number>;
  out?: (line: string) => void;
  /** OR-B1 egress check before the request (default: Cloudflare trace). */
  egress?: (reference: string | null) => Promise<EgressCheck>;
  /** Amendment time (tests). */
  now?: () => Date;
}

class Refusal extends Error {}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 2026-02-03T04:05:06.000Z -> 20260203T040506Z */
function compactUtc(iso: string): string {
  return iso.replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
}

async function capturePage(
  root: string,
  client: SourceClient,
  egressCountry: string,
): Promise<{ html: string; receipt: SavedReceipt; pageRel: string }> {
  const result = await client.capture({
    url: TCAD_PUBLIC_INFO_URL,
    schema: ChallengeFreePage,
    bodyKind: "text",
    accept: "text/html",
    maxAttempts: 1,
  });
  const r = result.receipt;
  if (
    result.data === null ||
    r.status === null ||
    (r.outcome !== "ok" && r.outcome !== "throttled-then-ok")
  ) {
    throw new Refusal(
      `TCAD public-information page not captured (${missingReason(r)}); nothing written, no retry`,
    );
  }
  const receipt: SavedReceipt = {
    url: r.url,
    status: r.status,
    bytes: result.body.length,
    sha256: sha256(result.body),
    captured_at: r.captured_at,
    user_agent: r.user_agent,
    attempts: r.attempts,
    outcome: r.outcome,
    egress_country: egressCountry,
  };
  const pageRel = `${RAW_REL}/publicinformation-${compactUtc(r.captured_at)}.html`;
  const pageAbs = join(root, pageRel);
  mkdirSync(join(root, RAW_REL), { recursive: true });
  writeFileSync(pageAbs, result.body);
  writeFileSync(`${pageAbs}.receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  return { html: result.data, receipt, pageRel };
}

function readSavedPage(
  root: string,
  htmlPath: string,
): { html: string; receipt: SavedReceipt; pageRel: string } {
  const abs = isAbsolute(htmlPath) ? htmlPath : resolve(htmlPath);
  const receiptPath = `${abs}.receipt.json`;
  if (!existsSync(receiptPath)) {
    throw new Refusal(`no saved receipt ${relative(root, receiptPath)} beside the page`);
  }
  const pageRel = relative(root, abs).split(sep).join("/");
  if (!/^pipeline\/data\/raw\/tcad\/[^/]+$/.test(pageRel)) {
    throw new Refusal(`saved page must sit under ${RAW_REL}/ in this repository`);
  }
  const receipt = SavedReceiptSchema.parse(JSON.parse(readFileSync(receiptPath, "utf8")));
  const body = readFileSync(abs);
  if (sha256(body) !== receipt.sha256) {
    throw new Refusal(`saved page ${pageRel} does not match its receipt's SHA-256`);
  }
  return { html: body.toString("utf8"), receipt, pageRel };
}

export async function refreshTcadLanding(options: RefreshOptions = {}): Promise<number> {
  const root = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const catalogPath = options.catalogPath ?? DEFAULT_CATALOG_PATH;
  const out =
    options.out ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const say = (line: string): void => out(redact(line));

  try {
    const catalog = readCatalog(catalogPath);
    const current = catalog.parcel;
    if (!current) throw new Refusal("catalog has no parcel block; run discovery first");

    let page: { html: string; receipt: SavedReceipt; pageRel: string };
    if (options.htmlPath) {
      page = readSavedPage(root, options.htmlPath);
    } else {
      const check = await (
        options.egress ??
        ((reference: string | null) => checkEgress({ reference, requireReference: true }))
      )(catalogEgressReference(catalog));
      if (!check.ok) throw new Refusal(check.reason);
      say(`refresh-tcad-landing: egress country ${check.egress.country}`);
      page = await capturePage(root, options.client ?? createSourceClient(), check.egress.country);
    }
    say(
      `refresh-tcad-landing: ${options.htmlPath ? "re-read" : "captured"} ${page.receipt.url} (HTTP ${page.receipt.status}, ${page.receipt.bytes} bytes, attempts ${page.receipt.attempts}) -> ${page.pageRel}`,
    );

    const date = findTcadLinks(page.html, page.receipt.url).certification_date;
    const measurement: CertificationDateMeasurement = {
      value: date,
      ...(date === null
        ? {
            missing_reason: `the TCAD public-information page captured at ${page.receipt.captured_at} does not state a certification date; the export file name's date is not used (PO decision 2026-10-20)`,
          }
        : {}),
      source_url: page.receipt.url,
      captured_at: page.receipt.captured_at,
      method: CERTIFICATION_METHOD,
      page_path: page.pageRel,
      page_sha256: page.receipt.sha256,
    };
    const {
      certification_date: _date,
      certification_date_measurement: _measurement,
      ...rest
    } = current;
    const parcel: Parcel = {
      ...rest,
      ...(date === null ? {} : { certification_date: date }),
      certification_date_measurement: measurement,
    };
    amendCatalog(
      { ...catalog, parcel },
      {
        command: "refresh-tcad-landing",
        venue: "operator",
        fields: ["parcel.certification_date", "parcel.certification_date_measurement"],
        ref: `${page.pageRel} (SHA-256 ${page.receipt.sha256})`,
        ...(page.receipt.egress_country ? { egress_country: page.receipt.egress_country } : {}),
        ...(options.htmlPath ? { note: "re-read of a saved page; no request" } : {}),
      },
      catalogPath,
      (options.now ?? (() => new Date()))(),
    );
    say(
      date === null
        ? `refresh-tcad-landing: parcel.certification_date missing: ${measurement.missing_reason ?? ""}`
        : `refresh-tcad-landing: parcel.certification_date ${date}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say(`refresh-tcad-landing: refused: ${message}`);
    return 2;
  }

  const validate = options.validate ?? (() => runValidatorMain({ repoRoot: root }));
  return validate();
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const htmlPath = argValue("--html");
  void refreshTcadLanding(htmlPath ? { htmlPath } : {}).then((code) => {
    process.exitCode = code;
  });
}
