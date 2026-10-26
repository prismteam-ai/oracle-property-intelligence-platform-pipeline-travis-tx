// The Runs page's "Server check" line (A-03 T042, G-C3; contracts/api.md `runs.summary`; plan
// § Atlas element map → Server check). One call per page load through the shared tRPC client
// (packages/api-client, the only one). The line is secondary text with its own "from the API"
// provenance: the page's counts come only from the manifest (FR-009), and an API failure is
// `unavailable`, never a page error.
import { useTRPC } from "@countylens/api-client/react";
import { useQuery } from "@tanstack/react-query";

export type ServerCheck =
  | { readonly kind: "pending" }
  | { readonly kind: "ok"; readonly rows: number; readonly durationMs: number }
  | { readonly kind: "unavailable" };

export function serverCheckText(check: ServerCheck): string {
  switch (check.kind) {
    case "pending":
      return "Server check: pending";
    case "ok":
      return `Server check: ${check.rows} rows · ${Math.round(check.durationMs)} ms · from the API (runs.summary)`;
    case "unavailable":
      return "Server check: unavailable";
  }
}

/** `runs.summary({ manifestCid })` for the run on the page; one request, one retry (api-client). */
export function useServerCheck(manifestCid: string): ServerCheck {
  const trpc = useTRPC();
  const query = useQuery(trpc.runs.summary.queryOptions({ manifestCid }));
  if (query.isSuccess) {
    return {
      kind: "ok",
      rows: query.data.roofingPermitRows,
      durationMs: query.data.queryDurationMs,
    };
  }
  if (query.isError) return { kind: "unavailable" };
  return { kind: "pending" };
}
