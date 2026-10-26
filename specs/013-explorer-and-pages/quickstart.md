# Quickstart: validate A-13 on the hosted URL

Prerequisites: the branch is pushed and `https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com/build.json` shows the branch head SHA; `CountyLensApi` deployed with `explore.search` (D-13).

1. Unit and build checks (local, not evidence): `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm exec tsx scripts/bundle-size.ts` → ≤ 300 KB gzipped excluding duckdb chunks.
2. Hosted suite: `RUNTIME_URL=https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com pnpm --filter @countylens/e2e e2e -g "A-13"` → every `@scenario:A-13-TC-*` passes; Verify cases on one worker.
3. Demo walk: `/` → Open → `/runs` → `/tx/travis/coverage` → `?mode=sql` → `/data/manifest` → Verify → `/runs/compare` → Filters (place, 5 mi, roof ≥ 15; 5 → 3 mi) → open/stalled ≥ 5 yrs.
4. Network checks: Verify requests only to `gateway.pinata.cloud` and `ipfs.filebase.io`; Filters calls `/api/trpc/explore.search`; `/` loads no `duckdb`/`.wasm`.
5. Scan: the no-sample-data spec reports 0 placeholders over every route in `route-list.ts` and every Coming soon item.
6. Responsive: `smeargle` at 390 / 768 / 1440 on every route; Lighthouse-profile vitals on Hub, Catalog, Runs log, Legal (LCP < 2.5 s, CLS < 0.1).
7. Waits for A-11: 3-run Compare, full-county counts and denominators, scale p95, Catalog from `tables-export.json`, multi-run log.
