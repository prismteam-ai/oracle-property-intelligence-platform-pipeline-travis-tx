// The run's ProfileApi: profiles/travis-austin@1.0.0 as the Property Improvement transform
// consumes it (contracts/profile.md). Every roofing and status decision is the profile's.
//
// The one addition is D-4b's trade-type mapping for trade sub-permits: the profile marks a
// non-BP permit `trade_permit` (never Roofing) and leaves its type null; this adapter gives
// the ledger its own trade type (plan.md D-4b; agent-design oracle § B). The type is read
// from the Austin permit-type code, a source code → lexicon enum mapping, not a
// classification term. Since the PO decision of 2026-10-24 ("publish roofing only") the
// transform never emits a `trade_permit`: the type is internal ledger evidence only.
import type { AustinRow, ProfileApi } from "../transforms/austin-property-improvement.js";

/** Austin `permittype` code → lexicon `improvement_type` for trade sub-permits. */
export const TRADE_IMPROVEMENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  EP: "Electrical",
  MP: "MechanicalHVAC",
  PP: "Plumbing",
});

/** The shape of the profile module this adapter reads (index.ts of travis-austin@1.0.0). */
export interface TravisAustinProfileModule {
  PROFILE: { name: string; version: string; sha256: string };
  classifyPermit: (row: AustinRow) => {
    roofing: "roofing" | "not_roofing" | "needs_review";
    reason: string;
    improvement_type: "Roofing" | null;
    improvement_action: "Replacement" | null;
    profile_sha256: string;
  };
  classifyStatus: (word: string | null | undefined) => {
    class: "open" | "stalled" | "closed" | "exclude" | "needs_review";
    improvement_status: string | null;
    profile_sha256: string;
  };
}

export function profileApi(profile: TravisAustinProfileModule): ProfileApi {
  return {
    PROFILE: { ...profile.PROFILE },
    classifyPermit: (row) => {
      const c = profile.classifyPermit(row);
      const trade =
        c.reason === "trade_permit"
          ? (TRADE_IMPROVEMENT_TYPES[row.permittype ?? ""] ?? null)
          : null;
      return {
        roofing: c.roofing,
        reason: c.reason,
        improvement_type: c.improvement_type ?? trade,
        // The trade permit's nature of work is not established by the profile.
        improvement_action: c.improvement_action,
        sha256: c.profile_sha256,
      };
    },
    classifyStatus: (word) => {
      const s = profile.classifyStatus(word);
      return { class: s.class, improvement_status: s.improvement_status, sha256: s.profile_sha256 };
    },
  };
}
