// The contractor resolution badge (A-13 T027; AC-5, FR-005; AD-24 five states: resolved,
// candidate, ambiguous, conflicting, unresolved). The word is the row's `contractor.resolution`
// as published; a row without one is `unresolved` (the views' default). Colours follow Atlas
// § 2.4: resolved → Verified, candidate → Info, ambiguous / conflicting → Warning, unresolved →
// Not available. `data-contractor-resolution` carries the state. Render-only.
import type { ReactElement } from "react";
import { StatusPill, type StatusKind } from "./StatusPill";

const STATUS: Readonly<Record<string, StatusKind>> = {
  resolved: "verified",
  candidate: "info",
  ambiguous: "warning",
  conflicting: "warning",
  unresolved: "unavailable",
};

export interface ContractorBadgeProps {
  readonly resolution: string | null;
}

export function ContractorBadge({ resolution }: ContractorBadgeProps): ReactElement {
  const state = resolution ?? "unresolved";
  return (
    <span data-contractor-resolution={state}>
      <StatusPill status={STATUS[state] ?? "info"} icon="badge" text={`Contractor ${state}`} />
    </span>
  );
}
