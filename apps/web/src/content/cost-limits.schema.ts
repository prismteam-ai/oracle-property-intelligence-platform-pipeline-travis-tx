// The row schema of `cost-limits.generated.json` (A-16 T004, AC-4, AC-5; frozen-interfaces.md
// "Cost/limits JSON"). `scripts/build-cost-limits.mjs` writes the file from `docs/cost.md` and
// `docs/source-limits.md` at build time; the Coverage page reads it and parses it with this schema,
// so a doc change that breaks the shape fails the build, not the page. A figure the docs call "not
// available" keeps `null` and a `missingReason`; it is never filled with a zero (AC-5).
import { z } from "zod";

/** `YYYY-MM-DD`, a calendar day in UTC. */
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A non-empty trimmed display string (markdown markers already removed). */
const Text = z.string().min(1);

export const CostRow = z
  .object({
    component: Text,
    /** Idle (fixed) cost per month, as the doc words it; null only with a missingReason. */
    idle: Text.nullable(),
    perUse: Text.nullable(),
    whoPays: Text.nullable(),
    /** The doc's "Seen in the bill" cell (additive to the frozen shape). */
    seenInBill: Text.nullable(),
    missingReason: Text.nullable(),
  })
  .strict();
export type CostRow = z.infer<typeof CostRow>;

const Amount = z
  .object({
    /** Gross usage or credit, in USD, exactly as the doc's total row; null with a reason. */
    usd: z.number().nullable(),
    /** The window the figure covers, e.g. "7 full days to 2026-10-24". */
    window: Text,
    missingReason: Text.nullable(),
  })
  .strict();

export const CostSection = z
  .object({
    /** Last full billed UTC day (the doc's "As of billing date"). */
    asOf: Day,
    /** The doc's source sentence (Cost Explorer call and grouping). */
    source: Text,
    /** "$0.00" fixed per month, from the doc's headline. */
    fixedPerMonth: Text,
    gross: Amount,
    credits: Amount,
    /** The day after `asOf` when the doc carries a partial, estimated row for it; else null. */
    partialDay: z
      .object({ day: Day, grossUsd: z.number(), creditUsd: z.number() })
      .strict()
      .nullable(),
    /** The monthly budget sentence; null with a reason when the doc has none. */
    budget: z
      .object({
        text: Text.nullable(),
        limitUsd: z.number().nullable(),
        missingReason: Text.nullable(),
      })
      .strict(),
    rows: z.array(CostRow).min(1),
  })
  .strict();
export type CostSection = z.infer<typeof CostSection>;

export const LimitStatus = z.enum(["measured", "not_measured", "blocked"]);
export type LimitStatus = z.infer<typeof LimitStatus>;

export const LimitRow = z
  .object({
    source: Text,
    throughput: Text.nullable(),
    pageSize: Text.nullable(),
    fullCapture: Text.nullable(),
    rateLimit: Text.nullable(),
    antiBot: Text.nullable(),
    optimisation: Text.nullable(),
    status: LimitStatus,
    /** UTC days a blocked source refused access (empty unless blocked). */
    blockedDates: z.array(Day),
    missingReason: Text.nullable(),
  })
  .strict()
  .superRefine((row, ctx) => {
    if (row.status === "blocked" && row.blockedDates.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["blockedDates"],
        message: "a blocked row needs dates",
      });
    }
    if (row.status === "not_measured" && row.missingReason === null) {
      ctx.addIssue({
        code: "custom",
        path: ["missingReason"],
        message: "not measured needs a reason",
      });
    }
  });
export type LimitRow = z.infer<typeof LimitRow>;

/** A row of the doc's § 3 table (publication and read path), shown under the source table. */
export const PathLimitRow = z.object({ step: Text, measured: Text, limit: Text }).strict();
export type PathLimitRow = z.infer<typeof PathLimitRow>;

export const LimitsSection = z
  .object({
    asOf: Day,
    rows: z.array(LimitRow).min(1),
    readPath: z.array(PathLimitRow),
  })
  .strict();
export type LimitsSection = z.infer<typeof LimitsSection>;

export const CostLimits = z.object({ cost: CostSection, limits: LimitsSection }).strict();
export type CostLimits = z.infer<typeof CostLimits>;
