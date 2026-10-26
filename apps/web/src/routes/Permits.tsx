// The Permits list route (`/permits`, A-03 T056): a react-router lazy route module exporting
// `Component` only. The page and its state machine live in Permits.page.tsx; the loader
// (index → manifest → DuckDB-WASM → rows) in src/engine/load-permits.ts, which imports the
// engine chunk dynamically. No data, fixture or placeholder value lives here.
import type { ReactElement } from "react";
import { createPermitsLoader } from "../engine/load-permits";
import { PermitsPage } from "./Permits.page";

const loadPermits = createPermitsLoader();

export function Component(): ReactElement {
  return <PermitsPage load={loadPermits} />;
}
