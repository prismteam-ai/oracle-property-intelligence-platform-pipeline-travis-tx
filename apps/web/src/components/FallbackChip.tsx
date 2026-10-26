// The fallback chip (A-03 T042, G-C3; plan § Atlas element map → Extensions "Badge / status
// pill → FallbackChip"): a § 2.4 Warning / partial pill reading `fallback · {host}` when the
// Filebase gateway served the read (TC-032…034); nothing when the CID copy served it. The text
// comes from `fallbackLabel` (data/fetch-by-cid), so the label has one source. Render-only.
import type { ReactElement } from "react";
import { fallbackLabel, type ReadSource } from "../data/fetch-by-cid";
import { StatusPill } from "./StatusPill";

export interface FallbackChipProps {
  readonly source: ReadSource;
}

export function FallbackChip({ source }: FallbackChipProps): ReactElement | null {
  const label = fallbackLabel(source);
  if (label === null) return null;
  return <StatusPill status="warning" text={label} />;
}
