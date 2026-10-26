// Display names of the run manifest's `sources[].name` (test plan § 3, data-model.md § UI
// mappings). A fixed UI map: an unmapped source is a build gap and fails loudly, never a blank.
export const SOURCE_LABELS = Object.freeze({
  "austin-3syk-w9eu": "City of Austin Issued Construction Permits (3syk-w9eu)",
  "tcad-2026-certified-json": "TCAD 2026 certified export",
  // A-11 Run 3 (ADR 0004): the one source an address point comes from.
  "austin-address-points": "City of Austin address points (LOCATION_address_points)",
});
export type SourceName = keyof typeof SOURCE_LABELS;

export function isSourceName(name: string): name is SourceName {
  return Object.hasOwn(SOURCE_LABELS, name);
}

/** The display name of a manifest source; throws, naming the source, when it is not mapped. */
export function sourceLabel(name: string): string {
  if (!isSourceName(name)) {
    throw new Error(`No display name for manifest source "${name}"`);
  }
  return SOURCE_LABELS[name];
}
