// Vitest setup for apps/web: generous async limits. The default 1 s `findBy`/`waitFor` limit of
// Testing Library and the 5 s test timeout are fine on a laptop and too tight on a loaded CI
// runner (ERR-49: catalog, app-shell and lazy-route tests lost races only there). Every wait
// still ends as soon as its condition is true; the limits only decide when a real failure gives up.
import { configure } from "@testing-library/react";
import { vi } from "vitest";

configure({ asyncUtilTimeout: 10_000 });

// Vitest's own `vi.waitFor` gives up after 1 s by default: the same reason, the same fix.
const waitFor = vi.waitFor.bind(vi);
vi.waitFor = ((callback: Parameters<typeof waitFor>[0], options?: Parameters<typeof waitFor>[1]) =>
  waitFor(
    callback,
    typeof options === "number" ? options : { timeout: 10_000, interval: 50, ...options },
  )) as typeof vi.waitFor;
