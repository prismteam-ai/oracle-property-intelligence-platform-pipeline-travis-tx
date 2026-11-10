import { isPlausibleDate, wholeYearsBetween } from "./iso-date.js";
import { isUnfinished, type PermitState, permitStateOf } from "./permit-state.js";

export interface PermitDates {
  status: string | undefined;
  appliedDate: string | undefined;
  issueDate: string | undefined;
  expiresDate: string | undefined;
}

export interface PermitLifecycle {
  state: PermitState;
  unfinished: boolean;
  openSince: string | undefined;
  yearsOpen: number | undefined;
  pastExpiry: boolean;
}

export function permitLifecycle(
  { status, appliedDate, issueDate, expiresDate }: PermitDates,
  asOf: string,
): PermitLifecycle {
  const state = permitStateOf(status);
  const unfinished = isUnfinished(state);
  const start = issueDate ?? appliedDate;
  const openSince = unfinished && start && isPlausibleDate(start, asOf) ? start : undefined;

  return {
    state,
    unfinished,
    openSince,
    yearsOpen: openSince === undefined ? undefined : wholeYearsBetween(openSince, asOf),
    pastExpiry: unfinished && expiresDate !== undefined && expiresDate < asOf,
  };
}
