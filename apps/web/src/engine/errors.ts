// Engine failures of the browser read path (A-03 T054). Kept apart from duckdb-wasm.ts so the
// route can recognise them without importing the engine chunk statically (the chunk is
// lazy-loaded; plan § Constitution Check, the 300 KB gate).
import { PERMITS_TEXTS } from "@countylens/shared";

/** DuckDB-WASM could not be loaded, instantiated or opened: the page shows the fixed text. */
export class EngineStartError extends Error {
  override readonly name = "EngineStartError";

  constructor(cause: unknown) {
    super(PERMITS_TEXTS.engineFailure, { cause });
  }
}

/**
 * A listed row does not match contract/v1 `v_roofing_permit` (ERR-11): the banner shows the fixed
 * text; `detail` (which row and field, the schema's own message) is for `console.error` only.
 */
export class PermitRowsError extends Error {
  override readonly name = "PermitRowsError";
  readonly detail: string;

  constructor(detail: string) {
    super(PERMITS_TEXTS.rowsUnreadable);
    this.detail = detail;
  }
}
