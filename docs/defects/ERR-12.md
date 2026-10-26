---
id: ERR-12
type: defect
feature: FEAT-A03
story: A-03
test_case: A-03-TC-NF-03
ac_reference: A-03-AC-2
severity: Medium
status: Closed
found_by: smeargle
found_date: 2026-10-21
fix_branch: 003-walking-skeleton
fix_commit: 660f73ccfe1805673e0b0efae38c0bb002ea75b5
retest_date: 2026-10-21
closed_date: 2026-10-21
---

# ERR-12: Runs page – Copy CID button computes Arial 13.33px, outside the Atlas tokens

## Brief description

On the Runs page the CID copy button (`button[aria-label="Copy CID"]`, `CidDisplay`) computes `font-family: Arial` and `font-size: 13.333px`: the browser's default button font. Neither value is in the Atlas `tokens.css` set, so TC-NF-03's run-time token check fails on it. Buttons do not inherit the page font, and the CSS Module never sets one; stylelint cannot catch a missing declaration.

## Related requirement

- **Story:** A-03 · **AC:** A-03-AC-2 (also AC-3 where the CID display appears) · **Requirement:** NFR-003 (Atlas tokens only) · **Test case:** A-03-TC-NF-03

## Environment

| Item | Value |
| --- | --- |
| URL | https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/runs |
| Build | `1380ad3` (Amplify branch preview `003-walking-skeleton`) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Chromium (Playwright) · macOS · 390, 768 and 1440 px |
| Role | anonymous (public page) |

## Preconditions and test data

- The Runs page shows the run card with its manifest CID and copy button.

## Steps to reproduce

1. Open https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/runs in a private window and wait for the run card.
2. In DevTools (or Playwright), read `getComputedStyle(document.querySelector('button[aria-label="Copy CID"]'))` → `fontFamily`, `fontSize`.
3. Compare with the `:root` custom properties of `tokens.css` (smeargle screenshots `docs/evidence/img/A-03-smeargle-runs-{390,768,1440}.png`).

## Expected result

The button's font comes from the Atlas tokens: it inherits the surrounding typescale (Roboto, the token size of its context), so TC-NF-03 reports zero violations.

## Actual result

`font-family: Arial`, `font-size: 13.3333px` on every `Copy CID` button.

## Impact and severity

- **Impact:** TC-NF-03 (Atlas tokens only) fails on the Runs page; the same button appears on the Permits rows.
- **Severity:** Medium because nothing visible breaks (the button shows an icon), but a P1 conformance case fails.

## Suggested investigation area

`apps/web/src/components/CidDisplay.module.css` `.copy`.

## Evidence

- [x] Screenshots `docs/evidence/img/A-03-smeargle-runs-{390,768,1440}.png`
- [x] Red unit run before the fix: `.copy: declares font: inherit, or a token font-family and font-size` failed
- [x] Hosted re-test (TC-NF-03): PASS in hosted run 2 (build `fbdb68b`)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | `.copy` resets border, padding and background but sets no font; a `<button>` takes the user-agent font (Arial 13.33px). |
| Fix | `.copy` declares `font: inherit` (the surrounding Atlas typescale from `tokens.css`). Stylelint's strict-value list now also covers the `font` shorthand (only tokens or `inherit`); stylelint stays green. Commit: _(filled after commit)_ on `003-walking-skeleton`. |
| Tests | `apps/web/test/app-shell.test.tsx` › "ERR-12: every <button> sets its font from the tokens …" › "finds the app's buttons (Copy CID, Retry)", ".copy: declares font: inherit, or a token font-family and font-size", ".retry: declares font: inherit, or a token font-family and font-size". |
| Re-test | TC-NF-03 PASS in hosted run 2 (build `fbdb68b`, 2026-10-21); `smeargle` re-check 6/6 PASS at 390 / 768 / 1440, 0 token violations |
| Status | ☒ Closed (2026-10-21) ☐ Reopened · Re-tested: PASS in hosted run 2 (build `fbdb68b`, 2026-10-21) |
