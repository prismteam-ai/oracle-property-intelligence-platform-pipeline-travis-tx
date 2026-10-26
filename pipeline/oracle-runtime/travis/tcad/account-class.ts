// A-04 T022 (D-5): the TCAD account class. All four types load into `parcels`; only real
// property (R) is emitted in the County group (D-1 denominator); P, MH and MN are
// `out_of_scope` publicly (oracle disagreement #6). Meanings from the TCAD Export Layouts
// (Legacy 8.0.33, prop_type_cd: R Real, P Business Personal Property, M Mobile Home, MN
// Mineral; the 2026 JSON prints the mobile-home type as MH), recorded in travis-sources.yaml.
export const PROP_TYPES = ["R", "P", "MH", "MN"] as const;
export type PropType = (typeof PROP_TYPES)[number];

export function isPropType(v: unknown): v is PropType {
  return typeof v === "string" && (PROP_TYPES as readonly string[]).includes(v);
}

/** The County group (and the coverage denominator) holds R accounts only. */
export const countyEmit = (t: PropType): boolean => t === "R";

/** Public reason for an account that is loaded but never emitted. */
export const OUT_OF_SCOPE = "out_of_scope";
