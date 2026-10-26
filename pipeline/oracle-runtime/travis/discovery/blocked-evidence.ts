// T037: the committed evidence file for a blocked or failed source (FR-006, FR-007b).
//
// One Markdown file per stop receipt under docs/evidence/blocked/, with `id`/`parent` front
// matter, the HTTP status, timeout or network error, capture time, URL, attempts, User-Agent, outcome,
// geo signal, the saved response headers and a body excerpt with the SHA-256 of the whole
// body. Everything is passed through the logger's redaction (credential URLs, token query
// values, bearer tokens, registered secrets, home paths) plus a Windows home-path rule, and
// cookie/auth/token headers were already dropped by the source client (`safeHeaders`).
//
// The catalog's `blocked_evidence.evidence_path` names the same file (assemble.ts); the
// workflow writes it from the journaled receipt, so a replay never asks the source again.
//
// OR-B1: the sentence "No retry with a changed identity was made" is written only when it
// is true: for a stop inside the workflow or a command that passed the egress check
// (`identity: "unchanged"`, the default). An operator retest outside the workflow
// (`identity: "operator-retest"`) says so instead. The egress country, when known, is in
// the front matter.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { redact } from "../lib/log.js";
import { safeHeaders, type CaptureReceipt, type SavedResponse } from "../lib/source-client.js";
import { BLOCKED_EVIDENCE_DIR } from "./assemble.js";
import { resumesText } from "./probes/common.js";

/** The story the evidence belongs to (front matter `parent`, constitution XIX). */
export const EVIDENCE_PARENT = "A-01";

/** Repository root (this file is pipeline/oracle-runtime/travis/discovery/). */
export const DEFAULT_REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export interface EvidenceSubject {
  kind: "source" | "jurisdiction";
  key: string;
}

export interface RenderInput {
  /** Repository-relative path, under docs/evidence/blocked/. */
  path: string;
  subject: EvidenceSubject;
  receipt: CaptureReceipt;
  /** Extra secrets to redact (for example the Socrata app token). */
  secrets?: readonly string[];
  /**
   * "unchanged": the request kept the run's identity and egress (workflow, or a command that
   * passed the egress check); "operator-retest": an operator request outside the workflow.
   */
  identity?: "unchanged" | "operator-retest";
  /** Egress country of the request (Cloudflare trace loc), when it was checked. */
  egressCountry?: string;
}

/** The identity sentence of the evidence file; true for its context only (OR-B1). */
export function identitySentence(identity: RenderInput["identity"]): string {
  return identity === "operator-retest"
    ? "This request was an operator retest outside the discovery workflow (see docs/decisions/DEC-A-01-source-access.md); the workflow's no-retry and same-identity guarantee does not cover it, and no challenge was solved (FR-006a)."
    : "No retry with a changed identity was made and no challenge was solved (FR-006a).";
}

const WINDOWS_HOME = /[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\\s"']+/g;
// eslint-disable-next-line no-control-regex -- control characters are what we replace
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const FILE_NAME = /^[A-Za-z0-9._-]+\.md$/;

/** Redaction used for every string that reaches an evidence file. */
export function sanitizeEvidenceText(text: string, secrets: readonly string[] = []): string {
  return redact(text, secrets).replace(WINDOWS_HOME, "~").replace(CONTROL, "?");
}

/** `EV-A-01-blocked-<file name without .md>`. */
export function evidenceId(relPath: string): string {
  return `EV-${EVIDENCE_PARENT}-blocked-${basename(relPath).replace(/\.md$/, "")}`;
}

function assertEvidencePath(relPath: string): void {
  const normalized = posix.normalize(relPath);
  if (
    relPath.startsWith("/") ||
    normalized !== relPath ||
    posix.dirname(relPath) !== BLOCKED_EVIDENCE_DIR ||
    !FILE_NAME.test(posix.basename(relPath))
  ) {
    throw new Error(
      `blocked-evidence: path must be a .md file directly under ${BLOCKED_EVIDENCE_DIR}/`,
    );
  }
}

export function renderBlockedEvidence(input: RenderInput): string {
  assertEvidencePath(input.path);
  const { receipt, subject } = input;
  const secrets = input.secrets ?? [];
  const clean = (s: string): string => sanitizeEvidenceText(s, secrets);

  const front: Record<string, string | number> = {
    id: evidenceId(input.path),
    parent: EVIDENCE_PARENT,
    subject: `${subject.kind}:${subject.key}`,
  };
  if (receipt.timeout_ms !== null) front.timeout_ms = receipt.timeout_ms;
  else if (receipt.status !== null) front.http_status = receipt.status;
  front.captured_at = receipt.captured_at;
  front.url = clean(receipt.url);
  front.method = receipt.method;
  front.attempts = receipt.attempts;
  if (receipt.resumes !== undefined && receipt.resumes > 0) front.resumes = receipt.resumes;
  front.user_agent = receipt.user_agent;
  front.outcome = receipt.outcome;
  if (receipt.blocked_reason !== null) front.blocked_reason = receipt.blocked_reason;
  if (receipt.error !== undefined) front.error = clean(receipt.error);
  if (receipt.challenge_signal !== undefined) {
    front.challenge_signal = clean(receipt.challenge_signal);
  }
  if (receipt.incomplete_body !== undefined) {
    front.bytes_received = receipt.incomplete_body.bytes;
    if (receipt.incomplete_body.content_length !== null) {
      front.content_length = receipt.incomplete_body.content_length;
    }
  }
  front.geo_signal = clean(receipt.geo_signal);
  if (input.egressCountry !== undefined) front.egress_country = input.egressCountry;
  front.body_bytes = receipt.stop_evidence?.body_bytes ?? receipt.bytes;
  front.body_sha256 = receipt.sha256;
  if (receipt.rate_limits_observed !== null) {
    front.rate_limits_observed = clean(receipt.rate_limits_observed);
  }

  const incomplete = receipt.incomplete_body;
  const what =
    receipt.timeout_ms !== null
      ? `timed out after ${receipt.timeout_ms} ms`
      : receipt.status === null
        ? `failed with a network error before any HTTP response (${clean(receipt.error ?? "no message")})`
        : incomplete !== undefined
          ? `answered HTTP ${receipt.status} and the body stream broke at ${incomplete.bytes} of ${incomplete.content_length ?? "an unknown number of"} bytes (${clean(receipt.error ?? "stream ended early")})`
          : `answered HTTP ${receipt.status}`;
  const lines: string[] = [
    "---",
    stringify(front, { lineWidth: 0 }).trimEnd(),
    "---",
    "",
    `# Blocked evidence: ${subject.kind} ${subject.key}`,
    "",
    `The source ${what} at ${receipt.captured_at} after ${receipt.attempts} attempt(s)${resumesText(receipt)} with the project User-Agent; outcome \`${receipt.outcome}\`. ${identitySentence(input.identity)} Geo signal: ${front.geo_signal === "none" ? "none" : `"${String(front.geo_signal)}"`} (FR-006b).`,
    "",
    "## Response headers",
    "",
  ];

  const saved = receipt.stop_evidence;
  if (saved === undefined) {
    lines.push(
      "Not captured: no saved response is attached to this receipt (for example a reused earlier observation).",
      "",
      "## Body excerpt",
      "",
      `Not captured. Whole body: ${receipt.bytes} bytes, SHA-256 \`${receipt.sha256}\`.`,
      "",
    );
    return lines.join("\n");
  }

  const headers = safeHeaders(saved.headers, secrets);
  const names = Object.keys(headers).sort();
  if (names.length === 0) lines.push("No response headers (no HTTP response was received).");
  else {
    lines.push("```text");
    for (const name of names) lines.push(clean(`${name}: ${headers[name] ?? ""}`));
    lines.push("```");
  }

  const excerpt = Buffer.from(saved.excerpt_base64, "base64");
  const excerptText = clean(excerpt.toString("utf8")).replace(/`{3,}/g, "'''");
  lines.push(
    "",
    "## Body excerpt",
    "",
    `First ${excerpt.byteLength} of ${saved.body_bytes} bytes. SHA-256 of the whole body: \`${receipt.sha256}\`.`,
    "",
    "```text",
    excerptText.length > 0 ? excerptText : "(empty body)",
    "```",
    "",
  );
  return lines.join("\n");
}

/** Writes one evidence file atomically under `<repoRoot>/docs/evidence/blocked/`. */
export function writeBlockedEvidence(repoRoot: string, relPath: string, content: string): string {
  assertEvidencePath(relPath);
  const target = join(repoRoot, relPath);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, target);
  return target;
}

/**
 * The front matter of a committed evidence file, or null when the file is missing or has
 * none. Used to read what the catalog row does not keep (blocked_reason, challenge_signal).
 */
export function readEvidenceFrontMatter(
  repoRoot: string,
  relPath: string,
): Record<string, unknown> | null {
  assertEvidencePath(relPath);
  const target = join(repoRoot, relPath);
  if (!existsSync(target)) return null;
  const match = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(target, "utf8"));
  if (!match?.[1]) return null;
  const front: unknown = parse(match[1], { schema: "core" });
  return front !== null && typeof front === "object" && !Array.isArray(front)
    ? (front as Record<string, unknown>)
    : null;
}

/** The text inside the first ```text fence after `heading`, or null. */
function fencedAfter(text: string, heading: string): string | null {
  const at = text.indexOf(`\n${heading}\n`);
  if (at < 0) return null;
  const open = text.indexOf("```text\n", at);
  if (open < 0) return null;
  const close = text.indexOf("\n```", open + 8);
  return close < 0 ? null : text.slice(open + 8, close);
}

/**
 * The saved stop response of a committed evidence file (status, safe headers, body
 * excerpt), or null when the file is missing or saved none. Used to re-read what a stop
 * said (for example a web application firewall naming itself, OR-M2) without a request.
 */
export function readEvidenceResponse(repoRoot: string, relPath: string): SavedResponse | null {
  const front = readEvidenceFrontMatter(repoRoot, relPath);
  if (front === null) return null;
  const text = readFileSync(join(repoRoot, relPath), "utf8");
  const body = fencedAfter(text, "## Body excerpt");
  if (body === null) return null;
  const headers: Record<string, string> = {};
  for (const line of (fencedAfter(text, "## Response headers") ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const status = typeof front.http_status === "number" ? front.http_status : null;
  return { status, headers, body };
}
