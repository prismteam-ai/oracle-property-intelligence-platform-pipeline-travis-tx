---
id: CT-A-01-receipt
parent: PLAN-A-01
---

# Contract: capture receipt and discovery run record (internal)

Matches the ARD § 6 internal contracts. Written by `source-client.ts` for every request; never published.

## Capture receipt

| Field | Type | Notes |
| --- | --- | --- |
| `url` | string | no credentials or tokens in the URL |
| `method` | string | `GET` / `HEAD` |
| `status` | int or `null` | `null` on timeout |
| `bytes` | int | response size |
| `sha256` | string | body digest |
| `captured_at` | UTC ISO-8601 | |
| `user_agent` | string | constant project UA (no email unless the PO consents) |
| `attempts` | int | 1 for 403/challenge/timeout; ≤ 5 for 429/5xx |
| `outcome` | `ok` \| `blocked` \| `throttled-then-ok` \| `failed` | |
| `geo_signal` | `none` or quoted text | only from the saved response (FR-006b) |
| `timeout_ms` | int or `null` | set only for a real timeout (never for a network error) |
| `blocked_reason` | `http-403` \| `challenge` \| `timeout` \| `null` | `challenge` only on an explicit signal |
| `error` | string, optional | network error with no response (for example "fetch failed"), stream error of a broken download, or "unexpected body" for a 2xx that fails its expected format |
| `challenge_signal` | string, optional | the quoted explicit challenge signal: `cf-mitigated: challenge` header, an interstitial title/body ("Just a moment...", "Attention Required", "Checking your browser"), or challenge markers on a 403/429/503. A Cloudflare `/cdn-cgi/challenge-platform/` beacon injected into a normal 200 page is **not** a signal |
| `incomplete_body` | `{bytes, content_length}`, optional | a 2xx download whose stream broke part-way |
| `resumes` | int 0..5, downloads only | HTTP Range resumes after a part-way drop (FR-003); absent on receipts written before 2026-10-20 (read as 0) |

## Guard behavior (tested in Vitest)

| Response | Attempts | Outcome | Run state |
| --- | --- | --- | --- |
| 2xx that parses with Zod | 1 | `ok` | unchanged |
| Explicit challenge (any status: `cf-mitigated: challenge`, interstitial body, or 403/429/503 with challenge markers) | 1 (never retried) | `blocked` (`challenge`) | `WAITING_HUMAN` |
| 2xx body that fails its parse with no challenge signal | 1 | `failed` (`error`: unexpected body) | `WAITING_HUMAN` |
| Network error, no response | 1 | `failed` (`error`, no `timeout_ms`) | `WAITING_HUMAN` |
| TCAD export: HTTP 200 whose stream breaks part-way, source advertises `Accept-Ranges: bytes` | 1 request + up to 5 Range resumes from the last byte, same identity, inside the 2 h total (FR-003, PO 2026-10-20) | `ok` when final size = advertised length; otherwise as the next row | unchanged on `ok` |
| TCAD export: HTTP 200 whose stream breaks part-way, no range support or 5 resumes used | 1 (no automatic retry) | `failed` (`error`, `incomplete_body`) | `WAITING_HUMAN`; next step: one more `resolve -- <key> captured` with the same identity, not a records request |
| 403 | 1 | `blocked` | `WAITING_HUMAN` |
| Timeout | 1 | `blocked` | `WAITING_HUMAN` |
| 429 / 5xx | ≤ 5, backoff 1 s base, 60 s cap, full jitter, honors `Retry-After` | `throttled-then-ok` or `failed` | `throttled-then-ok` → unchanged; `failed` → measurement `null` with "throttled: 5 attempts exhausted", that source `WAITING_HUMAN`, other sources continue (FR-006e) |
| TCAD export download: no data for 10 min, or 2 h total | 1 | `blocked` (`timeout_ms` = elapsed) | `WAITING_HUMAN` (FR-003) |

## Discovery run record

`run_id`, `started_at`, `state` (`DISCOVERING` \| `WAITING_HUMAN` \| `READY`), `blockers[]` (`source_key`, `receipt`, `records_request`, `next_step`), `validator` (`exit_code`, `report_path`, `vendored_sha256`). State transitions are in [data-model.md](../data-model.md#discovery-run-state-machine).
