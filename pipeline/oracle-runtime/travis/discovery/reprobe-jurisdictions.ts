// Operator command `npm --prefix pipeline/oracle-runtime run reprobe-jurisdictions -- <key>...`
//
// Re-probes, once, the evidence page of permit rows whose evidence fetch FAILED at the live
// run (network error, HTTP 404, HTTP 406 or 5xx), using the profile's current evidence_url
// and the jurisdiction evidence probe of the workflow (project source client: same
// User-Agent, attempt budget 1, no retry, one request at a time). Each named row is rebuilt
// with the workflow's own assembly (assemble-permits.ts) from its profile entry plus the new
// evidence, so its class and status follow the existing rules. A probe that fails again
// writes a new evidence file under docs/evidence/blocked/ and the row points at it; a probe
// that succeeds drops blocked_evidence and stamps evidence_captured_at. Every other part of
// the catalog is left byte-identical. Then the readiness validator runs again.
//
// Refused before any request (exit 2, nothing sent, nothing written):
// - a row whose recorded stop is a 403, a challenge, a timeout or any `outcome: blocked`
//   (constitution: stop on 403/challenge, no retry, no identity change);
// - a row that is not blocked, an unknown or duplicate key, a status other than network
//   error / 404 / 406 / 5xx;
// - a row whose saved stop response names a web application firewall, whatever its status
//   (OR-M2: San Leanna's HTTP 406 names Mod Security; that is a block, not a failure);
// - a row already re-probed once: `reprobe_count` on the row (OR-m2), or, for rows written
//   before that field, more than one evidence file for it;
// - a host name that does not resolve locally (a local DNS failure is not evidence about
//   the source, so nothing is sent and nothing is recorded);
// - an egress country that differs from the run's recorded egress or ORACLE_EXPECT_EGRESS
//   (OR-B1), checked after every other rule and before the first request.
//
// A re-probed row records `reprobe_count`, `reprobed_at`, `reprobe_url_changed` (a new URL
// makes it a new probe rather than a re-probe of the same page) and the evidence file it
// supersedes; the committed evidence files are never edited. The change is recorded in
// `amendments[]` with the egress country (OR-M5).
//
// Exit codes: 0 validator PASS, 1 validator BLOCKED (passed through), 2 refused (nothing written).
import { lookup } from "node:dns/promises";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { catalogEgressReference, checkEgress, type EgressCheck } from "../lib/egress.js";
import { redact } from "../lib/log.js";
import { createSourceClient, type SavedResponse, type SourceClient } from "../lib/source-client.js";
import {
  TRAVIS_JURISDICTION_PROFILE,
  type JurisdictionProfileEntry,
} from "../profiles/jurisdictions.js";
import { BLOCKED_EVIDENCE_DIR } from "./assemble.js";
import { assembleJurisdictionRow, defaultJurisdictionEvidencePath } from "./assemble-permits.js";
import type { AustinLocatedEntry } from "./austin-issued.js";
import {
  DEFAULT_REPO_ROOT,
  readEvidenceFrontMatter,
  readEvidenceResponse,
  renderBlockedEvidence,
  writeBlockedEvidence,
} from "./blocked-evidence.js";
import { firewallBlock } from "./jurisdiction-explanation.js";
import type { Catalog, Jurisdiction } from "./catalog.schema.js";
import { missingReason } from "./probes/common.js";
import { probeEvidencePage, type EvidenceProbe } from "./probes/evidence.js";
import { main as runValidatorMain } from "./run-validator.js";
import { amendCatalog, DEFAULT_CATALOG_PATH, readCatalog } from "./write-catalog.js";

const KeysSchema = z
  .array(z.string().regex(/^[a-z][a-z0-9_]*$/, "a key is snake_case"))
  .min(1, "name at least one jurisdiction key");

export interface ReprobeOptions {
  repoRoot?: string;
  catalogPath?: string;
  client?: SourceClient;
  profile?: readonly JurisdictionProfileEntry[];
  /** Local name resolution check; defaults to node:dns lookup (no request to the source). */
  resolveHost?: (host: string) => Promise<void>;
  now?: () => Date;
  validate?: () => Promise<number>;
  out?: (line: string) => void;
  /** OR-B1 egress check before the first request (default: Cloudflare trace). */
  egress?: (reference: string | null) => Promise<EgressCheck>;
}

class Refusal extends Error {}

const defaultResolveHost = async (host: string): Promise<void> => {
  await lookup(host);
};

/** Why a row may not be re-probed, or null when it may (it failed, it was not blocked). */
export function reprobeRefusal(
  row: Jurisdiction,
  front: Record<string, unknown> | null,
  evidenceFiles: number,
  saved: SavedResponse | null = null,
): string | null {
  if ((row.reprobe_count ?? 0) >= 1) {
    return `row ${row.key} was re-probed already (reprobe_count ${row.reprobe_count ?? 0}, at ${row.reprobed_at ?? "unknown"}); a row is re-probed once only`;
  }
  const be = row.blocked_evidence;
  if (row.status !== "blocked" || !be) {
    return `row ${row.key} is ${row.status} with no failed evidence; only failed rows are re-probed`;
  }
  const firewall = firewallBlock(saved);
  if (firewall !== null) {
    return `row ${row.key} was blocked by ${firewall} (HTTP ${be.http_status ?? "none"}); it is never requested again`;
  }
  if (be.outcome === "blocked" || front?.outcome === "blocked") {
    return `row ${row.key} was blocked (outcome blocked); it is never requested again`;
  }
  if (be.http_status === 403 || front?.http_status === 403) {
    return `row ${row.key} answered HTTP 403; it is never requested again`;
  }
  if (front?.blocked_reason !== undefined || front?.challenge_signal !== undefined) {
    return `row ${row.key} recorded a challenge or block (${String(front.blocked_reason ?? "challenge")}); it is never requested again`;
  }
  if (be.timeout_ms !== undefined) {
    return `row ${row.key} timed out; a timeout is a block and is never requested again`;
  }
  const s = be.http_status;
  if (s !== undefined && s !== 404 && s !== 406 && !(s >= 500 && s < 600)) {
    return `row ${row.key} failed with HTTP ${s}; only a network error, 404, 406 or 5xx is re-probed`;
  }
  if (evidenceFiles > 1) {
    return `row ${row.key} already has ${evidenceFiles} evidence files; it was re-probed once already`;
  }
  return null;
}

/** The rebuilt row with its re-probe record and the evidence it supersedes (OR-m2). */
export function withReprobe(
  next: Jurisdiction,
  previous: Jurisdiction,
  newEvidencePath: string | null,
  probe: { at: string; status: number | null },
): Jurisdiction {
  const oldPath = previous.blocked_evidence?.evidence_path;
  const oldUrl = previous.blocked_evidence?.url ?? previous.evidence_url;
  const superseded = [...(previous.superseded_evidence ?? [])];
  if (oldPath !== undefined && oldPath !== newEvidencePath) {
    superseded.push({
      evidence_path: oldPath,
      superseded_by:
        newEvidencePath ??
        `re-probe at ${probe.at} answered HTTP ${probe.status ?? "none"} (no new evidence file)`,
    });
  }
  return {
    ...next,
    reprobe_count: (previous.reprobe_count ?? 0) + 1,
    reprobed_at: probe.at,
    reprobe_url_changed: oldUrl !== next.evidence_url,
    ...(superseded.length > 0 ? { superseded_evidence: superseded } : {}),
  };
}

function evidenceFileCount(root: string, key: string): number {
  let names: string[];
  try {
    names = readdirSync(join(root, BLOCKED_EVIDENCE_DIR));
  } catch {
    return 0;
  }
  return names.filter((n) => n.startsWith(`jurisdiction-${key}-`) && n.endsWith(".md")).length;
}

function locatedFrom(catalog: Catalog): AustinLocatedEntry[] {
  const austin = catalog.sources.find((s) => s.key === "austin_permits");
  return austin?.located_in_other_jurisdictions ?? [];
}

function rowState(row: Jurisdiction): string {
  const be = row.blocked_evidence;
  const evidence = be
    ? `blocked_evidence ${be.outcome} ${be.http_status ?? be.error ?? ""} (${be.evidence_path})`
    : `evidence HTTP ${row.evidence_http_status ?? "none"} at ${row.evidence_captured_at}`;
  return `${row.spec_class} / ${row.status}, ${evidence}`;
}

export async function reprobeJurisdictions(
  keys: readonly string[],
  options: ReprobeOptions = {},
): Promise<number> {
  const root = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const catalogPath = options.catalogPath ?? DEFAULT_CATALOG_PATH;
  const profile = options.profile ?? TRAVIS_JURISDICTION_PROFILE;
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const out =
    options.out ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const say = (line: string): void => out(redact(line));

  try {
    const parsed = KeysSchema.safeParse(keys);
    if (!parsed.success) throw new Refusal(parsed.error.issues[0]?.message ?? "bad keys");
    if (new Set(parsed.data).size !== parsed.data.length) throw new Refusal("duplicate key");

    const catalog = readCatalog(catalogPath);
    const permits = catalog.permits;
    if (!permits) throw new Refusal("catalog has no permits block; run discovery first");

    // 1. Every check before any request: one refused key refuses the whole command.
    const targets: Array<{ row: Jurisdiction; entry: JurisdictionProfileEntry }> = [];
    for (const key of parsed.data) {
      const row = permits.jurisdictions.find((r) => r.key === key);
      if (!row) throw new Refusal(`no permit row with key ${key}`);
      const entry = profile.find((e) => e.key === key);
      if (!entry) throw new Refusal(`no profile entry with key ${key}`);
      const path = row.blocked_evidence?.evidence_path;
      const front = path ? readEvidenceFrontMatter(root, path) : null;
      const saved = path ? readEvidenceResponse(root, path) : null;
      const why = reprobeRefusal(row, front, evidenceFileCount(root, key), saved);
      if (why) throw new Refusal(why);
      targets.push({ row, entry });
    }
    for (const { entry } of targets) {
      const host = new URL(entry.evidence_url).hostname;
      try {
        await resolveHost(host);
      } catch {
        throw new Refusal(
          `host ${host} does not resolve from this machine (local DNS failure); nothing was sent, nothing recorded`,
        );
      }
    }

    // OR-B1: same egress as the run, or nothing is sent.
    const check = await (
      options.egress ??
      ((reference: string | null) => checkEgress({ reference, requireReference: true }))
    )(catalogEgressReference(catalog));
    if (!check.ok) throw new Refusal(check.reason);
    const egressCountry = check.egress.country;
    say(`reprobe-jurisdictions: egress country ${egressCountry}`);

    // 2. One request per row, one at a time, attempt budget 1 (inside probeEvidencePage).
    const client = options.client ?? createSourceClient();
    const deps = { client, now: options.now ?? (() => new Date()) };
    const probes = new Map<string, EvidenceProbe>();
    for (const { entry } of targets) {
      probes.set(entry.key, await probeEvidencePage(deps, entry.evidence_url));
    }

    // 3. Rebuild only those rows with the workflow's assembly; write evidence, then catalog.
    const located = locatedFrom(catalog);
    const rebuilt = new Map<string, Jurisdiction>();
    const evidenceWrites: Array<{ path: string; content: string }> = [];
    for (const { row, entry } of targets) {
      const probe = probes.get(entry.key) as EvidenceProbe;
      const stop = probe.blocked_receipt;
      const receipt = stop ?? probe.receipts.at(-1);
      const newPath = stop ? defaultJurisdictionEvidencePath(entry.key, stop) : null;
      if (stop && newPath) {
        evidenceWrites.push({
          path: newPath,
          content: renderBlockedEvidence({
            path: newPath,
            subject: { kind: "jurisdiction", key: entry.key },
            receipt: stop,
            identity: "unchanged",
            egressCountry,
          }),
        });
      }
      const next = withReprobe(assembleJurisdictionRow(entry, probe, located), row, newPath, {
        at: receipt?.captured_at ?? (options.now ?? (() => new Date()))().toISOString(),
        status: receipt?.status ?? null,
      });
      rebuilt.set(entry.key, next);
      say(
        `reprobe-jurisdictions: ${entry.key} ${entry.evidence_url} -> ${
          receipt
            ? stop
              ? missingReason(receipt)
              : `HTTP ${receipt.status ?? "none"} (${receipt.outcome}) at ${receipt.captured_at}`
            : "no receipt"
        }`,
      );
      say(`reprobe-jurisdictions: ${entry.key} before: ${rowState(row)}`);
      say(`reprobe-jurisdictions: ${entry.key} after:  ${rowState(next)}`);
    }
    for (const w of evidenceWrites) writeBlockedEvidence(root, w.path, w.content);
    amendCatalog(
      {
        ...catalog,
        permits: {
          ...permits,
          jurisdictions: permits.jurisdictions.map((r) => rebuilt.get(r.key) ?? r),
        },
      },
      {
        command: "reprobe-jurisdictions",
        venue: "operator",
        fields: targets.map(({ entry }) => `permits.jurisdictions[${entry.key}]`),
        ref:
          evidenceWrites.length > 0
            ? evidenceWrites.map((w) => w.path).join(", ")
            : "no new evidence file (every re-probe answered)",
        egress_country: egressCountry,
      },
      catalogPath,
      (options.now ?? (() => new Date()))(),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say(`reprobe-jurisdictions: refused: ${message}`);
    return 2;
  }

  const validate = options.validate ?? (() => runValidatorMain({ repoRoot: root }));
  return validate();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void reprobeJurisdictions(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
