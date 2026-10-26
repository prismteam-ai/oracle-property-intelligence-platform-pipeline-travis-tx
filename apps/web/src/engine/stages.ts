// Stage texts of the Permits load (A-03 T054/T056): what the linear progress bar announces in
// `aria-valuetext` while the engine starts and the published tables are bound (FR-008, TC-024).
export const STAGE_TEXTS = Object.freeze({
  engine: "Starting the query engine",
  manifest: "Reading the run manifest",
  bind: "Binding the published tables",
  query: "Listing permits",
});

export type Stage = keyof typeof STAGE_TEXTS;
