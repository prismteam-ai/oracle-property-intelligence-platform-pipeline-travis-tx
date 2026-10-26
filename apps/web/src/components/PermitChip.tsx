// The permit chip of an Explore row and the Property drawer (A-13 T027; AC-5, FR-005; contracts/
// ui-routes.md). An open or stalled roofing permit reads "Stalled {x} yrs · …" / "Open {x} yrs ·
// …" with {x} = the row's `open_years`; while `status_raw` has no lexicon carrier (ADR-0002) the
// status part says what the dates show ("open past expiry, never closed" for a stalled permit,
// PO 2026-10-26), and once a carrier exists
// "source says {status_raw}" ("Expired" for a stalled permit). `data-permit-chip` carries the
// status class and `data-open-days` the row's exact `open_days`. Any
// other permit shows its number and status class as published (no chip hook). Render-only.
import type { ExplorePermit } from "@countylens/query-core";
import { EXPLORE_TEXTS } from "@countylens/shared";
import type { ReactElement } from "react";
import { StatusPill } from "./StatusPill";

export interface PermitChipProps {
  readonly permit: ExplorePermit;
  /** The source's status text once a lexicon carrier exists; null/absent while it has none. */
  readonly statusRaw?: string | null;
  /** Results table: show "Stalled {x} yrs" only; the full text stays the pill's text and tooltip. */
  readonly compact?: boolean;
}

export function permitChipText(permit: ExplorePermit, statusRaw: string | null): string | null {
  const x = permit.open_years;
  if (x === null) return null;
  if (permit.status_class === "stalled") {
    return statusRaw === null ? EXPLORE_TEXTS.stalledNoCarrier(x) : EXPLORE_TEXTS.stalledExpired(x);
  }
  if (permit.status_class === "open") {
    return statusRaw === null
      ? EXPLORE_TEXTS.openNoCarrier(x)
      : EXPLORE_TEXTS.openSourceSays(x, statusRaw);
  }
  return null;
}

export function PermitChip({
  permit,
  statusRaw = null,
  compact = false,
}: PermitChipProps): ReactElement {
  const text = permitChipText(permit, statusRaw);
  if (text === null) {
    return (
      <span>
        {permit.number ?? "permit"} · {permit.status_class ?? "status class not published"}
      </span>
    );
  }
  return (
    <span data-permit-chip={permit.status_class ?? ""} data-open-days={permit.open_days ?? ""}>
      <StatusPill
        status={permit.status_class === "stalled" ? "warning" : "info"}
        text={text}
        short={
          compact
            ? `${permit.status_class === "stalled" ? "Stalled" : "Open"} ${String(permit.open_years)} yrs`
            : undefined
        }
      />
    </span>
  );
}
