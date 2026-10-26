# CLI contract: A-07

All commands run against the local Restate ingress (`RESTATE_INGRESS_URL`, default `http://localhost:8080`), never the database directly, following A-01–A-04's pattern. Every command prints its `job_id` as the last line of stdout on success. Each `<verb>` below runs as `npm --prefix pipeline/oracle-runtime run backbone -- <verb> [flags]` (the `backbone` script, `travis/backbone/cli.ts`) — an earlier draft of this file and `quickstart.md` showed a shorthand `EN <verb>` that was never wired to a real binary; TN02 caught it (2026-10-23) and both files now show the real command.

## Track A: identity

```
identity:load-registry --source tx-comptroller --scope travis
identity:resolve --scope austin-roofing-permits --registry-snapshot <digest>
```

- `load-registry`: exit 0 with the row count, watermark and snapshot digest printed; exit 1 and no write on an egress-check failure. Talks to the Restate ingress only; the registry's own database connection lives server-side, not behind a CLI flag.
- `resolve`: exit 0 with the five-state totals; never writes a company record for a non-`resolved` row.
- The manifest-coverage contribution shape (data-model.md's "Manifest coverage contribution") comes from `node pipeline/oracle-runtime/travis/runs/a07-coverage.ts`, which reads each track's own report JSON (T019/T020's `*-report.json` files) — there is no dedicated `identity:report` verb; an earlier draft of this file named one that was never built.

## Track B: BBB (stub only, D-2)

```
bbb:probe --max-pages 2 --max-profiles 5 --target stub
bbb:apply-status --resolved-list <path>
```

- `--target stub` is the only accepted value this story; `--target live` exits 2 with an error citing D-2, never makes a request.
- Stops at the first 403/challenge/robots-disallow response from the stub with the evidence fields in `data-model.md`'s BBB status record.
- **Not built this pass** (PO cost-mode scope decision, 2026-10-22): bbb.org is blocked by a Cloudflare challenge (A-01 receipts); neither verb exists yet.

## Track C: business/places (conditional)

```
business:transform --scope travis
places:probe-counts --release 2026-09-23.0 --county-fips 48453
places:clip --release 2026-09-23.0 --county-fips 48453 --licence-gate-result <pass|fail>
```

- `places:clip` refuses to run (exit 2) if the licence-gate result is `fail`; the caller then writes the "Places: not loaded · {reason}" limitation instead.
- **Not built this pass**: conditional on tracks A and D merging before 2026-10-23 12:00 EEST; none of these verbs exist yet.

## Track D: reconcile + roof age

```
reconcile:merge --entity-type property|owner|contractor
roof-age:audit --limit 25 --offset 0 --as-of-date 2026-10-22 --source-system travis-austin-permits --report <path>
roof-age:backfill --as-of-date 2026-10-22 --source-system travis-austin-permits --report <path> [--apply]
```

- `roof-age:backfill` without `--apply` is a dry run; `--apply` is gated behind D-21's approval and never runs unattended.
- `reconcile:merge` exit 1 if any input pair spans two TCAD ids (refused merge, counted per FR-018).

## Exit codes (all commands)

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | A domain-level refusal (egress check failed, cross-TCAD merge, licence gate fail) — logged, not a crash |
| 2 | A disallowed flag combination (e.g. `bbb --target live`) |
