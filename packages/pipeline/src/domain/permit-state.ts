export enum PermitState {
  Completed = "completed",
  Open = "open",
  Expired = "expired",
  Abandoned = "abandoned",
  Unknown = "unknown",
}

const STATE_BY_STATUS_PREFIX: readonly (readonly [string, PermitState])[] = [
  ["final", PermitState.Completed],
  ["expired", PermitState.Expired],
  ["void", PermitState.Abandoned],
  ["withdrawn", PermitState.Abandoned],
  ["cancelled", PermitState.Abandoned],
  ["aborted", PermitState.Abandoned],
  ["active", PermitState.Open],
  ["pending", PermitState.Open],
  ["on hold", PermitState.Open],
  ["suspended", PermitState.Open],
  ["re review", PermitState.Open],
  ["inactive pending", PermitState.Open],
];

export function permitStateOf(status: string | undefined): PermitState {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return PermitState.Unknown;
  const match = STATE_BY_STATUS_PREFIX.find(([prefix]) => normalized.startsWith(prefix));
  return match?.[1] ?? PermitState.Unknown;
}

export function isUnfinished(state: PermitState): boolean {
  return state === PermitState.Open || state === PermitState.Expired;
}
