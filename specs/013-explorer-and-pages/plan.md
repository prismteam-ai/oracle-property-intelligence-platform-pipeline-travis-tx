# Implementation Plan: Explorer UI with its hub, legal, catalog and Coming soon pages

**Branch**: `013-explorer-and-pages` | **Date**: 2026-10-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/013-explorer-and-pages/spec.md`; technical direction from [agent-design.md](agent-design.md) (metagross, read-only, 2026-10-21).

**PO decisions used** (run-log, 2026-10-21): D-1 A-11 added to `depends_on`; D-2 Ready, size exception, Verify on Pinata + Filebase (AM-01); D-3 Part 2 built after Part 1; R2 pre-approved ("i approve your recommendations"): D-4 denominators from the manifest only, else "denominator not in this run's manifest"; D-5 ARD wins on what, metagross on how (agent-design Disagreements rows 1–9); D-6 Watch demo and PR links from config, hidden until set; D-7 exactly the story's Coming soon list, the timeline scrubber and gateway race stay Coming soon; D-8 Legal = facts with links, no legal advice; TC-061 runs only on A-03's own build. **Pending (R3):** AC-6 wording, Filters searches run on the server (AM-06); this plan assumes it.

## Summary

Extend the A-03 web app (`apps/web`) from two routes (Runs, Permits) to the full A-13 explorer and its content pages, every value read from published files. Part 1: Runs (+ Compare, run chain), Coverage, Data · Manifest, Verify (Pinata + Filebase, SHA-256 in the browser), Explore · Filters (List view, server-side search), Explore · SQL (DuckDB-WASM in the browser, lazy), Property drawer, Help · MCP. Part 2 (wave 3): Hub at `/`, Legal ×3, Data · Catalog (Parquet footers), Runs · Log (manifest timestamps), Coming soon items with a static skeleton, county selector, and a no-sample-data scan. One additive tRPC procedure, `explore.search`, built on a single `query-core` builder. No contract or manifest change.

## Technical Context

**Language/Version**: TypeScript 5.x everywhere (Node 22 on Lambda, browser ES2022)

**Primary Dependencies**: React 19.3.1, react-router 7.18.4, Vite 8.3.4 (existing); `@trpc/client` via `packages/api-client` (existing); `@duckdb/duckdb-wasm` 1.33.1-dev57.0 (existing, SQL panel only); `hyparquet` 1.31.2 (new, MIT, no dependencies, pinned exact, published 2026-09-27; Catalog lazy chunk only; research R4); Zod (existing)

**Storage**: none new. Reads `runs/index.json` (same origin), manifests and table parts by CID through the CloudFront CID copy with the Filebase fallback (existing `fetch-by-cid`); `site-links.json` written at build time

**Testing**: Vitest (+ Testing Library) for units; Playwright on the hosted URL only (`tests/e2e`, `RUNTIME_URL` guard); `scripts/bundle-size.ts`; Lighthouse-profile web-vitals in Playwright; `smeargle` responsive tests

**Target Platform**: browsers at 390 / 768 / 1440 (mobile-first); AWS Lambda (eu-north-1, region from config) for `explore.search`

**Project Type**: Turborepo web application (`apps/web`, `apps/api`, `packages/*`, `infra/`)

**Performance Goals**: search p95 < 3 s (20 runs), first load ≤ 8 s with progress bar (NFR-001); LCP < 2.5 s, CLS < 0.1, INP < 200 ms on mobile 4G (NFR-002)

**Constraints**: initial JS ≤ 300 KB gzipped excluding DuckDB, Hub graph ≤ 150 KB target; no DuckDB request on `/`; Verify never uses the CID copy; Atlas tokens and components only; every value from a published file or static text

**Scale/Scope**: 17 routes (13 Part 1 + Part 2 pages, plus Coming soon items); today 1 published run (35 permits, 14 parcels, 27 artifacts); full county (≈ 493k properties, ≈ 2.4M permits) arrives with A-04 → A-07 → A-11

## Kit Agent Ownership *(mandatory, constitution XIII–XVII)*

Copied from `stories/A-13-explorer-and-pages.md` and [agent-design.md](agent-design.md).

| Role | Agent(s) | Skills loaded | What it decided (cite agent-design.md) |
|------|----------|---------------|----------------------------------------|
| Design consult | `metagross` | build-frontend-backends, frontend-bug-fix, responsive-design-tests, apply-engineering-guidelines | Filters on `explore.search` (Answer 8), SQL-only lazy DuckDB (1), direct published-file reads for Hub/Catalog/Log (2), events from manifest timestamps (3), `site-links.json` (4), `ComingSoonSkeleton` (5), scan denylist/allowlist (6), web-vitals method (7), simple-CORS Verify with backoff (9), Parquet-footer Catalog (10), `source_total:*` denominators for A-11 (11), TC-061 by branch (12), four groups (13) |
| Builder | `metagross` (one subagent per group G1–G4) | the same four skills | the patterns below |
| Reviewer(s) | `metagross`, `audino` (+ `frontend-bug-fix`) | — | architecture and pattern fidelity (metagross); UI vs `02-design.md` and Atlas, states, a11y (audino); each 0–100, ≥ 75, in `docs/reviews/CR-A-13.md` |
| Verify | Playwright demo lines 1–8 (D-2 to D-9) + every page and Coming soon item + no-sample-data scan; `smeargle` at 390/768/1440 | responsive-design-tests | on the Amplify preview of `013-explorer-and-pages`, then `https://countylens.aldarraj.com` |

**Patterns the code must show** (from metagross):

| Pattern | Where |
| --- | --- |
| One query builder for every Explore search, shared by API (and later agent/MCP) | `packages/query-core/src/explore.ts` (`exploreSearchSql`), used by `apps/api/src/routers/explore.ts` |
| Zod-bounded additive procedure (≤ 1,000 rows, `as_of` from the bound run) | `apps/api/src/routers/explore.ts`, registered in `routers/index.ts` |
| Subpath exports + `sideEffects:false` so the Hub doesn't pull views/gazetteer | `packages/query-core/package.json` (`./gazetteer`, `./builders`) |
| Fixed UI strings in one place, imported by tests | `packages/shared/src/labels.ts` (extended) |
| Lazy engine: only `?mode=sql` imports `engine/duckdb-wasm` | `apps/web/src/routes/ExploreSql.tsx` |
| Published-file readers with Zod and explicit error states | `apps/web/src/data/{run-chain,run-events,coverage-rows,parquet-meta,site-links,verify-lane}.ts` |
| Static non-animated skeleton, `aria-hidden`, no text nodes | `apps/web/src/components/ComingSoonSkeleton.tsx` |
| Route list as data, read by the scan | `apps/web/src/routes/route-list.ts` |
| Config-switched links (no code change) | `infra/src/web-stack.ts` → `amplify.yml` → `public/site-links.json` |
| Provenance + MissingReason on every row | existing `components/Provenance.tsx`, `components/MissingReason.tsx` |

## Constitution Check

*Re-checked after Phase 1 design: all ✅, no Complexity Tracking rows.*

| # | Article | Check for this plan | Status |
|---|---------|---------------------|--------|
| I | Outcome first | Every AC is proven on the hosted preview, then `countylens.aldarraj.com`, with the published Travis run; A-11-dependent proofs wait (no fake runs) | ✅ |
| II–IV | Stack | TypeScript only; CDK only (`infra/src/web-stack.ts` additive variables), region from config; Turborepo layout; `packages/api-client` is the one client | ✅ |
| V–VI | Contracts and LLM | Zod on `explore.search` input, `site-links.json`, every published file read; no LLM call in this story | ✅ (VI N/A) |
| VII–IX | Operations | `explore.search` reuses the A-03 Powertools logger/tracer/metrics (`apps/api/src/observability.ts`) and the existing alarms; no new queue | ✅ |
| X | Quality gates | Vitest per group, Playwright on the hosted URL, ESLint, Prettier, `tsc`, gitleaks, bundle-size in CI | ✅ |
| XI | Data honesty | `<Provenance/>` on every row; `<MissingReason/>` for every gap; no sample data; scan with real-CID allowlist; BBB shows the published `not_checked`, not a relabel | ✅ |
| XII | Secrets | none; link URLs are public config; MCP token never in the browser | ✅ |
| XIII–XV | Owner agents | Kit Agent Ownership filled; agent-design.md saved verbatim; metagross builds each group | ✅ |
| XVI | Owner review | metagross + audino score the whole branch, ≥ 75, one round (L5) | ✅ |
| XVIII–XXIII | Delivery | G4 PASS (2026-10-21); G5/G6 pre-checked in parallel; tests first per task; branch `013-explorer-and-pages`; defects as `docs/defects/ERR-50+` | ✅ |
| Addendum | Task A | A1 Runs/Coverage from manifest; A2 counts with derivation; A3 Compare + chain; A4 Verify on two independent gateways, CIDv1, never the copy; A5 UI lead finder + SQL; Query DB never exposed; only elephant-cli output read; stop on 403 | ✅ |

## Project Structure

### Documentation (this feature)

```text
specs/013-explorer-and-pages/
├── spec.md · agent-design.md · run-log.md
├── plan.md            # this file
├── research.md        # Phase 0
├── data-model.md      # Phase 1
├── quickstart.md      # Phase 1
├── contracts/
│   ├── explore-search.md   # tRPC explore.search input/output
│   ├── site-links.md       # public/site-links.json
│   └── ui-routes.md        # routes, URL params, fixed strings
└── tasks.md           # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── query-core/src/explore.ts, places.ts (+ package.json exports)        # G1
├── shared/src/labels.ts, urls.ts                                         # G1
apps/api/src/routers/explore.ts, index.ts                                 # G1
apps/web/src/
├── App.tsx, components/AppShell.*, routes/route-list.ts                  # G1
├── data/{run-chain,run-events,coverage-rows,parquet-meta,site-links,verify-lane}.ts   # G1
├── routes/{Runs,RunsCompare,Coverage,DataManifest,DataVerify,Explore,ExploreFilters,ExploreSql,PropertyDrawer,HelpMcp}.*   # G2
├── components/{FilterSheet,ResultRow,PermitChip,ContractorBadge,VerifyLane}.*         # G2
├── routes/{Hub,DataCatalog,RunsLog,LegalData,LegalPrivacy,LegalTerms,ComingSoon}.*     # G3
├── components/{ComingSoonSkeleton,CountySelect}.*, content/{legal,coming-soon}.ts      # G3
apps/web/test/*.test.ts(x)               # each group its own files
tests/e2e/A-13*.spec.ts, fixtures/prototype-placeholders.json, runs.spec.ts (TC-061, TC-014)   # G4
infra/src/web-stack.ts, infra/test/*, amplify.yml, scripts/bundle-size.ts                     # G4
```

**Structure Decision**: extend the existing Turborepo; the Hub lives at `/` in `apps/web` (no `apps/hub`); `/permits` stays (A-03 TC-012). File ownership per group is exclusive (agent-design Answer 13).

## Data flow

```text
runs/index.json (same origin) ──► Hub chip, Runs, Log, Compare ──► manifest by CID (CloudFront CID copy → Filebase "fallback")
manifest.coverage / sources[] / artifacts[] ──► Coverage, Runs deltas, Manifest, Catalog (artifacts + Parquet footers by Range), Log (timestamps)
Explore Filters ──► api-client ──► /api/trpc/explore.search (Lambda) ──► query-core exploreSearchSql ──► DuckDB over the same published Parquet
Explore SQL ──► lazy DuckDB-WASM in the browser ──► views.sql over the published Parquet (read-only)
Verify ──► plain GET gateway.pinata.cloud + ipfs.filebase.io ──► WebCrypto SHA-256 ──► compare with manifest (never the CID copy)
site-links.json (build time, from CDK context) ──► Hub CRM card, Watch demo, PR links
```

Integration points: `packages/api-client` (tRPC), `fetch-by-cid` (existing read path, ADR-0001), the two public gateways, CDK `CountyLensApi`/`CountyLensWeb`, Amplify build (`amplify.yml`). Test approach: Vitest per module and page (tests first, each group its own files), CDK assertions, bundle-size gate, Playwright on `RUNTIME_URL` only (one test per TC, Verify on one worker, `page.route()` for faults), smeargle at 390/768/1440, Lighthouse-profile vitals.

## Build groups and waves (light lane L4)

| Group | Owns | Wave | Est. |
| --- | --- | --- | --- |
| G1 Data and query layer | query-core, shared, api router, web `data/*`, `App.tsx`, `AppShell.*`, `route-list.ts`, `app-shell.test.tsx` | 1 | ~100 min |
| G2 Explorer pages | Part 1 routes and components | 2 | ~150 min |
| G3 Content pages | Part 2 routes, `ComingSoonSkeleton`, `CountySelect`, content files | 3 (after every Part 1 task is green) | ~90 min |
| G4 Tests and infra | `tests/e2e/**`, fixtures, `infra/**`, `amplify.yml`, `bundle-size.ts` | 1–3 | ~100 min |

Integration check after each wave: `pnpm test`, `pnpm typecheck`, `pnpm lint`, bundle-size.

## Deploys (asked at D-13, laptop only, AM-08)

1. `CountyLensApi` (adds `explore.search`; additive, current web keeps working).
2. `CountyLensWeb` (Amplify variables `VITE_PINATA_GATEWAY_HOST`, `CRM_URL`, `DEMO_VIDEO_URL`, `PR_URL`, empty link values).
Stack order per ARD § 11 as amended by AM-02. Then push the branch; Amplify builds the preview.

## Dependencies on later stories (no fakes)

| Needs | From | Until then |
| --- | --- | --- |
| Runs 1–3, `previousManifestCid` chain | A-11 | single run; Compare explains why (FR-001b) |
| `source_total:*` coverage keys (denominators) | A-11 (recorded input) | "denominator not in this run's manifest · A-01 source {name}" |
| full-county tables, scale p95 | A-04, A-11 | p95 measured on the published slice and labelled so; AC-6 hosted proof waits |
| addresses, tenure, owner area | A-04 | MissingReason |
| contractor resolution, BBB status | A-07 | MissingReason, `not_checked` |
| `tables-export.json` in the manifest | A-11 | columns from Parquet footers; "table export not in this run's manifest" |
| any manifest key A-11 adds | A-11 | must ship in `packages/contract` (strict schema) and the web first |

## Complexity Tracking

None.
