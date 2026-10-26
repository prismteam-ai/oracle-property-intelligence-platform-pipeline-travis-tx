---
id: ERR-49
type: defect
kind: test defect (race, only loses on a loaded machine)
feature: FEAT-A13
story: A-13
test_case: apps/web/test/catalog.test.tsx "valid definition lists" (unit test, CI workspace job)
ac_reference: AC-10, FR-010
severity: Low
status: Closed (fixed, 12 of 12 repeated runs and the full turbo pipeline pass locally; CI re-check on the commit that records it)
found_by: "CI run 39819086782 (workspace job: typecheck, lint, test, synth failed after 81 s on 9fbf5ff / 28fe75e)"
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: (this commit)
retest_date: 2026-10-22
---

# ERR-49: Web unit tests lost timing races on the loaded CI runner (Catalog, shell, Explore)

## Brief description

The CI `workspace` job failed at "Typecheck, lint, test, synth (Turborepo)" and the hosted job was skipped. Reproduced locally with the CI environment under the parallel turbo run: `catalog.test.tsx > valid definition lists`, `expected undefined to be '20'`.

## Root cause

Since ERR-41 (progressive Catalog render) `data-state="ready"` means the table list is painted; a row's count arrives with its own Parquet footer. The test waited for `ready` and then read `data-rows` at once, so it passed when the machine was idle and failed under load.

The second CI run (0967d68) failed the same job on two more Catalog tests with the same race (footer reads counted right after `ready`; a failed footer's reason read before it was attempted). Stressing the web suite on this machine (8 copies at once, a harsher load than CI) then exposed the general cause: Testing Library's default 1 s `waitFor` limit, Vitest's own 1 s `vi.waitFor` limit and a few explicit 5 s limits are fine on an idle laptop and too tight on a runner.

## Fix

- `apps/web/test-setup.ts` (new, registered in `vitest.config.ts`): `asyncUtilTimeout` 10 s and a 10 s default for `vi.waitFor`; `testTimeout` and `hookTimeout` 30 s. Every wait still ends as soon as its condition holds.
- Catalog tests wait for the footer-derived values; two app-shell/county-select explicit 5 s waits raised to 20 s; two Explore tests wrap an immediate assertion in a wait; the 250 ms debounce test only asserts "not yet called" when its own wait really took < 200 ms.
- The page is unchanged.

Result: before, every parallel copy failed several tests; after, 8 of 8 parallel copies pass (one file, `arrow-rows-real`, is excluded from that stress only: it fails in all simultaneous copies because they share a fixture file, which a single CI run does not do), and the full turbo pipeline passes 21 of 21 tasks.

## Impact

Test-only. It cost one CI cycle (the hosted job was skipped for that run).
