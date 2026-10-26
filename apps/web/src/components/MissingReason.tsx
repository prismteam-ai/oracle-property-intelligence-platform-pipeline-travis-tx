// The Missing-reason element (A-03 T055; plan § "Atlas element map" → Extensions): the Atlas § 8
// Not-available pill (§ 2.4 colours, `do_not_disturb_on`) extended so the reason label is visible
// text after the icon, not only a tooltip (TC-022 reads visible cells). The label is
// `missingLabel(field, reason)` from @countylens/shared, the only source of the wording
// (FR-011); an unknown reason throws naming it, so the pill is never blank, "—", "N/A" or a raw
// code. `data-field` / `data-reason` carry the entry for row-detail readers. Render-only.
import type { ReactElement } from "react";
import type { MissingReason as Reason } from "@countylens/contract";
import { missingLabel } from "@countylens/shared";
import { StatusPill } from "./StatusPill";

export interface MissingReasonProps {
  /** The view column the entry is about (contract `missing[].field`). */
  readonly field: string;
  /** One of the contract's closed list of reasons (contract `missing[].reason`). */
  readonly reason: Reason;
  /** A compact visible label; the full label stays the text and the tooltip (StatusPill). */
  readonly short?: string | undefined;
}

export function MissingReason({ field, reason, short }: MissingReasonProps): ReactElement {
  return (
    <StatusPill
      status="unavailable"
      text={missingLabel(field, reason)}
      data={{ field, reason }}
      short={short}
    />
  );
}
