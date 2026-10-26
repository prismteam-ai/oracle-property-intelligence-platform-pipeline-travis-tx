// travis-austin@1.0.0: the versioned roofing and status profile (A-02 Track B; FR-003,
// FR-004, FR-005, FR-009; AD-08, AD-26; contracts/profile.md).
//
// Every classification term lives in rules.json. This module only interprets it:
// - classifyPermit(row): exclude > trade permit > include > needs_review (rules.roofing.precedence);
// - classifyStatus(word): the AD-08 status lists; Expired stays Expired (class `stalled`,
//   improvement_status null, PO D-4a); unknown words are `needs_review`; exclude and
//   needs_review are never emitted;
// - digest(): SHA-256 of the Zod-parsed, recursively key-sorted JSON plus "\n" (research R-07);
//   PROFILE.sha256 is that digest as a generated constant (RULES_SHA256), so the module hashes
//   nothing at load and bundles for the browser (A-03 T012; no `node:` import here);
// - toSoqlInclude(), toSoqlSamplePopulation(), toSqlStatusMap(): generated query text.
import { z } from "zod";
import rulesJson from "./rules.json" with { type: "json" };

// ---------------------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------------------

const ImprovementStatus = z.enum(["Permitted", "InProgress", "Planned", "OnHold", "Completed"]);
export type ImprovementStatus = z.infer<typeof ImprovementStatus>;

const compiles = (pattern: string): boolean => {
  try {
    new RegExp(pattern, "i");
    return true;
  } catch {
    return false;
  }
};

const ExcludeRule = z.discriminatedUnion("match", [
  z.strictObject({
    id: z.string().min(1),
    field: z.enum(["work_class", "description", "permittype"]),
    match: z.literal("equals"),
    value: z.string().min(1),
    note: z.string(),
  }),
  z.strictObject({
    id: z.string().min(1),
    field: z.enum(["work_class", "description", "permittype"]),
    match: z.literal("regex"),
    pattern: z.string().min(1).refine(compiles, "pattern must compile"),
    note: z.string(),
  }),
]);
export type ExcludeRule = z.infer<typeof ExcludeRule>;

const STATUS_CLASSES = ["open", "stalled", "closed"] as const;

export const RulesSchema = z
  .strictObject({
    name: z.string().regex(/^[a-z0-9-]+$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    dataset: z.strictObject({ id: z.string(), url: z.url(), key: z.literal("permit_number") }),
    jurisdictions: z.record(
      z.string(),
      z.strictObject({ name: z.string(), hosts: z.array(z.string()).min(1) }),
    ),
    roofing: z.strictObject({
      include: z.strictObject({
        field: z.literal("description"),
        match: z.literal("substring_case_insensitive"),
        terms: z.array(z.string().min(1)).min(1),
      }),
      exclude: z.array(ExcludeRule).min(1),
      flags: z.literal("i"),
      trade_permit: z.strictObject({
        field: z.literal("permittype"),
        roofing_permittypes: z.array(z.string()).min(1),
        note: z.string(),
      }),
      needs_review: z.array(
        z.strictObject({
          id: z.string(),
          field: z.literal("work_class"),
          equals: z.string(),
          note: z.string(),
        }),
      ),
      precedence: z.tuple([
        z.literal("exclude"),
        z.literal("trade_permit"),
        z.literal("include"),
        z.literal("needs_review"),
      ]),
      published: z.strictObject({
        improvement_type: z.literal("Roofing"),
        improvement_action: z.literal("Replacement"),
      }),
    }),
    status_map: z.strictObject({
      open: z.array(z.string()).min(1),
      stalled: z.array(z.string()).min(1),
      closed: z.array(z.string()).min(1),
      exclude: z.array(z.string()),
      exclude_prefixes: z.array(z.string()),
      unmapped: z.literal("needs_review"),
    }),
    published_encoding: z.strictObject({
      by_word: z.record(z.string(), ImprovementStatus.nullable()),
      stalled_rule: z.string(),
      not_emitted: z.tuple([z.literal("exclude"), z.literal("needs_review")]),
    }),
    sample_population: z.strictObject({
      fields: z.array(z.enum(["description", "work_class"])).min(1),
      match: z.literal("substring_case_insensitive"),
      term: z.string().min(1),
    }),
  })
  .superRefine((r, ctx) => {
    const seen = new Map<string, string>();
    for (const cls of [...STATUS_CLASSES, "exclude"] as const) {
      for (const w of r.status_map[cls]) {
        if (seen.has(w))
          ctx.addIssue({
            code: "custom",
            message: `status word "${w}" is in ${seen.get(w)} and ${cls}`,
          });
        seen.set(w, cls);
      }
    }
    const encoded = r.published_encoding.by_word;
    for (const cls of STATUS_CLASSES) {
      for (const w of r.status_map[cls]) {
        if (!(w in encoded))
          ctx.addIssue({ code: "custom", message: `no published encoding for "${w}"` });
        const v = encoded[w];
        if (cls === "stalled" && v !== null)
          ctx.addIssue({ code: "custom", message: `stalled "${w}" must encode null` });
        if (cls === "closed" && v !== "Completed")
          ctx.addIssue({ code: "custom", message: `closed "${w}" must be Completed` });
        if (cls === "open" && (v === null || v === "Completed"))
          ctx.addIssue({ code: "custom", message: `open "${w}" must encode an open status` });
      }
    }
    for (const w of Object.keys(encoded)) {
      if (!STATUS_CLASSES.some((c) => r.status_map[c].includes(w)))
        ctx.addIssue({
          code: "custom",
          message: `encoded word "${w}" is not open, stalled or closed`,
        });
    }
  });
export type Rules = z.infer<typeof RulesSchema>;

// ---------------------------------------------------------------------------------------
// Digest (AD-26, research R-07)
// ---------------------------------------------------------------------------------------

const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return v;
};

/** The canonical form: Zod-parse, recursively sort keys, JSON.stringify, plus "\n". */
export const canonicalize = (raw: unknown): string =>
  JSON.stringify(sortKeys(RulesSchema.parse(raw))) + "\n";

// The SHA-256 of the canonical rules.json, equal to DIGEST. packages/query-core/scripts/gen-sql.ts
// rewrites the next line (it refuses to when the digest differs from DIGEST); test/digest.test.ts
// and query-core test/browser-safe.test.ts recompute it. Do not edit the value by hand.
export const RULES_SHA256 = "c8fd15cf8deb654c2959d7cca3b05560bc9830de2518c56a092bd87bdf53dfa6";

/** Node's crypto, fetched without an import statement so bundlers never resolve it. The browser
 *  never hashes (it reads RULES_SHA256); only tests and Node scripts recompute digests. */
interface NodeCrypto {
  createHash(algorithm: "sha256"): { update(data: string): { digest(encoding: "hex"): string } };
}
function nodeCrypto(): NodeCrypto {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const mod = proc?.getBuiltinModule?.("node:crypto") as NodeCrypto | undefined;
  if (!mod)
    throw new Error("profile digests are recomputed in Node only; the browser reads RULES_SHA256");
  return mod;
}

export const digestOf = (raw: unknown): string =>
  nodeCrypto().createHash("sha256").update(canonicalize(raw)).digest("hex");

export const RULES: Rules = RulesSchema.parse(rulesJson);

/** SHA-256 hex of this profile's canonical rules, recomputed (Node only). */
export const digest = (): string => digestOf(rulesJson);

export const PROFILE = Object.freeze({
  name: RULES.name,
  version: RULES.version,
  sha256: RULES_SHA256,
});
export const PROFILE_ID = `${PROFILE.name}@${PROFILE.version}`;

/**
 * Compare a rules object with the committed DIGEST. A different digest under the same
 * version means a rule changed without a version bump.
 */
export function verifyDigest(
  raw: unknown,
  committedDigest: string,
  committedVersion: string = PROFILE.version,
): { ok: boolean; reason?: string } {
  const actual = digestOf(raw);
  if (actual === committedDigest) return { ok: true };
  const version = RulesSchema.parse(raw).version;
  return {
    ok: false,
    reason:
      version === committedVersion
        ? `rules changed without a version bump (${version}): digest ${actual} != committed ${committedDigest}`
        : `version ${version} needs a new DIGEST and CHANGELOG entry: digest ${actual} != committed ${committedDigest}`,
  };
}

// ---------------------------------------------------------------------------------------
// Permit classification
// ---------------------------------------------------------------------------------------

/** An Austin `3syk-w9eu` row. Socrata omits null fields, so all but the key are optional. */
export const PermitRowSchema = z.object({
  permit_number: z.string().min(1),
  permittype: z.string().nullish(),
  work_class: z.string().nullish(),
  status_current: z.string().nullish(),
  description: z.string().nullish(),
});
export type PermitRow = z.input<typeof PermitRowSchema>;

export type RoofingVerdict = "roofing" | "not_roofing" | "needs_review";

export interface PermitClassification {
  permit_number: string;
  roofing: RoofingVerdict;
  /** `include_term`, an exclude id, `trade_permit`, a needs_review id, or `no_include_term`. */
  reason: string;
  improvement_type: "Roofing" | null;
  improvement_action: "Replacement" | null;
  profile: string;
  profile_sha256: string;
}

const compiledExcludes = RULES.roofing.exclude.map((rule) => ({
  rule,
  test:
    rule.match === "equals"
      ? (v: string): boolean => v === rule.value
      : (
          (re: RegExp) =>
          (v: string): boolean =>
            re.test(v)
        )(new RegExp(rule.pattern, RULES.roofing.flags)),
}));
const includeTerms = RULES.roofing.include.terms.map((t) => t.toUpperCase());

/** True when the description holds an include term (matches SoQL `upper(x) like '%T%'`). */
export const hasIncludeTerm = (description: string | null | undefined): boolean => {
  const d = (description ?? "").toUpperCase();
  return includeTerms.some((t) => d.includes(t));
};

export function classifyPermit(input: PermitRow): PermitClassification {
  const row = PermitRowSchema.parse(input);
  const result = (roofing: RoofingVerdict, reason: string): PermitClassification => ({
    permit_number: row.permit_number,
    roofing,
    reason,
    improvement_type: roofing === "roofing" ? RULES.roofing.published.improvement_type : null,
    improvement_action: roofing === "roofing" ? RULES.roofing.published.improvement_action : null,
    profile: PROFILE_ID,
    profile_sha256: PROFILE.sha256,
  });
  const field = (f: "work_class" | "description" | "permittype"): string => row[f] ?? "";

  for (const { rule, test } of compiledExcludes) {
    if (test(field(rule.field))) return result("not_roofing", rule.id);
  }
  const included = hasIncludeTerm(row.description);
  const isTrade = !RULES.roofing.trade_permit.roofing_permittypes.includes(field("permittype"));
  if (isTrade && (included || RULES.roofing.needs_review.some((n) => field(n.field) === n.equals)))
    return result("not_roofing", "trade_permit");
  if (included) return result("roofing", "include_term");
  const review = RULES.roofing.needs_review.find((n) => field(n.field) === n.equals);
  if (review) return result("needs_review", review.id);
  return result("not_roofing", "no_include_term");
}

// ---------------------------------------------------------------------------------------
// Status classification (AD-08, D-4a)
// ---------------------------------------------------------------------------------------

export type StatusClass = "open" | "stalled" | "closed" | "exclude" | "needs_review";

export interface StatusClassification {
  /** The source word exactly as printed (never relabelled). */
  status_word: string | null;
  class: StatusClass;
  improvement_status: ImprovementStatus | null;
  /** False for exclude and needs_review: such permits are never emitted. */
  emit: boolean;
  profile: string;
  profile_sha256: string;
}

export function classifyStatus(word: string | null | undefined): StatusClassification {
  const w = word ?? null;
  const sm = RULES.status_map;
  const cls: StatusClass =
    w === null || w === ""
      ? "needs_review"
      : (STATUS_CLASSES.find((c) => sm[c].includes(w)) ??
        (sm.exclude.includes(w) || sm.exclude_prefixes.some((p) => w.startsWith(p))
          ? "exclude"
          : sm.unmapped));
  const emit = !(RULES.published_encoding.not_emitted as readonly string[]).includes(cls);
  return {
    status_word: w,
    class: cls,
    improvement_status: emit && w !== null ? (RULES.published_encoding.by_word[w] ?? null) : null,
    emit,
    profile: PROFILE_ID,
    profile_sha256: PROFILE.sha256,
  };
}

/** The jurisdiction id (e.g. `austin`) for a source URL, or null when the host is unmapped. */
export function jurisdictionOf(url: string): string | null {
  const host = new URL(url).host;
  return Object.entries(RULES.jurisdictions).find(([, j]) => j.hosts.includes(host))?.[0] ?? null;
}

// ---------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------

const soqlString = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const soqlLike = (field: string, term: string): string =>
  `upper(${field}) like ${soqlString(`%${term.toUpperCase()}%`)}`;

/** SoQL `$where` predicate for the include terms (pushed down; excludes run in TS). */
export const toSoqlInclude = (): string =>
  `(${RULES.roofing.include.terms.map((t) => soqlLike(RULES.roofing.include.field, t)).join(" OR ")})`;

/** SoQL `$where` predicate for the AC-3 sample population. */
export const toSoqlSamplePopulation = (): string =>
  `(${RULES.sample_population.fields.map((f) => soqlLike(f, RULES.sample_population.term)).join(" OR ")})`;

/** SoQL predicate for an `equals` exclude rule (the only kind SoQL can express exactly). */
export function toSoqlExcludeEquals(id: string): string {
  const rule = RULES.roofing.exclude.find((r) => r.id === id);
  if (rule?.match !== "equals") throw new Error(`exclude ${id} is not an equals rule`);
  return `${rule.field} = ${soqlString(rule.value)}`;
}

const sqlString = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** DuckDB view mapping the published `improvement_status` enum to `status_class`. */
export function toSqlStatusMap(): string {
  const pairs = new Map<string, string>();
  let hasNull = false;
  for (const cls of STATUS_CLASSES) {
    for (const w of RULES.status_map[cls]) {
      const v = RULES.published_encoding.by_word[w] ?? null;
      if (v === null) hasNull = true;
      else pairs.set(v, cls);
    }
  }
  const sorted = [...pairs.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  // Every row, and the NULL → stalled rule, belongs to one of the profile's own jurisdictions:
  // a permit from any other jurisdiction finds no row (status_class empty, needs_review).
  const rows = Object.keys(RULES.jurisdictions)
    .sort()
    .flatMap((j) => [
      ...sorted.map(([s, c]) => `  (${sqlString(j)}, ${sqlString(s)}, ${sqlString(c)})`),
      ...(hasNull ? [`  (${sqlString(j)}, NULL, 'stalled')`] : []),
    ]);
  return [
    "-- GENERATED by @countylens/profile-travis-austin toSqlStatusMap(). Do not edit by hand.",
    `-- profile: ${PROFILE_ID}`,
    `-- profile_sha256: ${PROFILE.sha256}`,
    "-- source: profiles/travis-austin@1.0.0/rules.json (jurisdictions + status_map + published_encoding)",
    "-- Maps (jurisdiction, published lexicon enum improvement_status) to status_class (open | stalled | closed).",
    `-- D-4a: NULL means stalled only for the profile's jurisdictions (${Object.keys(RULES.jurisdictions).sort().join(", ")}) and only when ${RULES.published_encoding.stalled_rule}.`,
    "-- Excluded and needs_review permits are never emitted, so a NULL status from these jurisdictions is an Expired source word.",
    "-- A jurisdiction or status with no row has no status_class (needs_review).",
    "-- Join on jurisdiction, and with IS NOT DISTINCT FROM on the status so the NULL row matches.",
    "CREATE OR REPLACE VIEW travis_austin_status_map AS",
    "SELECT * FROM (VALUES",
    rows.join(",\n"),
    ") AS t(jurisdiction, improvement_status, status_class);",
    "",
  ].join("\n");
}
