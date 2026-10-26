# Contract: MCP server (`POST /mcp`, Streamable HTTP + stdio)

Owner: `oracle`. Full detail: `../design-oracle.md`. Shared types: `../data-model.md`.

## Transport

- `POST /mcp` — stateless Streamable HTTP, its own Lambda (separate from the agent Lambda and the existing query-API Lambda), `@modelcontextprotocol/sdk` (version pinned per `../research.md`).
- `GET /health` — 200, no `Authorization` header needed.
- A local stdio build for Claude Desktop / Claude Code, documented in `docs/mcp.md`.

## Auth

- `Authorization: Bearer <token>` required on every call except `/health`. Token read from SSM SecureString at cold start (Powertools Parameters + cache); missing parameter → fail fast with a clear log line, no default (AD-10, AD-14). No token or wrong token → `401`, and no DuckDB bind/query runs for that request.
- Browser `Origin` allowlist: empty by default — no legitimate browser origin should call `/mcp` directly; the website's own "Try a tool" control goes through a server-side tRPC proxy (`mcpProxy.callTool`) that calls the same tool functions in process and uses no token at all (it never imports the auth module), so the token never reaches the browser.
- Rate limit: 5 rps, burst 10, at the route level (its own CDK throttle, not stage-wide); beyond it, `429`.

## The six tools (AD-21, exact names; each `inputSchema` is the matching query-core Zod schema, unchanged)

| Tool | Input (= query-core schema) | Output |
| --- | --- | --- |
| `search_properties` | `SearchPropertiesInput` | `ResultEnvelope<ExploreRow>` |
| `list_permits` | `ListPermitsInput` | `ResultEnvelope<PermitRow>` |
| `get_property` | `GetPropertyInput` | `ResultEnvelope<PropertyDetail>` |
| `get_coverage` | `GetCoverageInput` | `{coverage, run, derivation_labels}` |
| `list_runs` | `ListRunsInput` | `{runs, latest}` |
| `get_schema` | `GetSchemaInput` | `{views, uncarried, enums, tool_inputs}` |

No seventh tool, no SQL tool, ever (P0-13).

## Row cap and truncation

- `MAX_ROWS = 1000`. When a call's true count exceeds the row cap, the response carries `truncated: true` and `total` (the real count) — never a silent cut.

## Empty-result reasons (never invented rows)

`out_of_scope` (location outside Travis County), `not_found` (unknown record/permit identifier), `no_match` (valid filter, zero rows), `field_not_published` (the filtered field is null on every candidate row — e.g. `owner_is_out_of_area`), `run_not_found` (unknown `manifest_cid`).

## Verify on the hosted `/mcp` URL

See `../design-oracle.md` § "How to verify on the hosted `/mcp` URL" and `../quickstart.md`.
