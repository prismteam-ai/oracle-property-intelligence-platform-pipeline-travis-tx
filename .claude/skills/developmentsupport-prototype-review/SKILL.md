---
name: developmentsupport-prototype-review
description: Review a Claude Design prototype export (design/ folder, screens, flows, tokens) against the feature list, the README demo transcript and the Google-theme design system, producing a feedback log for the Design Checkpoint. Use when the user has a Claude Design export or handoff and wants it reviewed, or mentions the Design Checkpoint or design review.
---

# Prototype review (Phase 2, Design Checkpoint)

## Inputs (all required)

1. `docs/feature-list.md`, plus the README demo transcript (and the task guide's demo map).
2. The prototype: `design/` exports (HTML, screenshots, `flows.md`, `tokens.json`) or a Claude Design handoff bundle.
3. The design system: `assessment-guide/design-system/` (`design-system.md`, `tokens.css`, `tokens.json`).

## Review tasks

1. **Coverage.** Each FEAT with UI and each demo transcript line has a screen. Flag any that do not.
2. **Journey completeness.** Each journey has a start state, key steps and an end state. Each screen has empty, loading, error, partial-data and populated states. Each has mobile (390), tablet (768) and desktop (1440) layouts, designed mobile-first per design-system § 14.1: full-bleed map with a bottom sheet on compact, the primary action in the thumb zone, and a visible button for every gesture.
3. **Data honesty.** Provenance (source + timestamp, or CID), confidence badges and "not available" states are visible wherever data is shown.
4. **Token compliance.** Flag hard-coded colors, fonts, radii or spacing that are not in the design-system tokens. Flag extensions that are not documented as gaps.
5. **Components.** Components from the design system are reused before new ones are created (reuse-first). Flag duplicates.
6. **Accessibility.** Contrast is 4.5:1 for text, focus states are visible, touch targets are 48 dp or more, and map controls are reachable by keyboard.
7. **Annotations.** Each journey has at least one screen with interaction notes.
8. **Signature moments.** Every § 14.2 pattern listed in this app's brief (`templates/design-brief.md`) is prototyped as a clickable interaction, with its reduced-motion fallback. The § 15 app switcher is present. Missing ones are Blocking.

## Output

Write `design/design-review-log.md` containing only this table (no preamble):

| # | Screen / journey | Issue type | Description | Severity | Recommendation | Resolution |
| --- | --- | --- | --- | --- | --- | --- |

Issue types: Coverage · Journey · State · Honesty · Token · Component · A11y · Annotation · Interaction. Severity: Blocking / Non-blocking.

Then reply with the counts by severity. The Design Checkpoint passes when every Blocking item is resolved as Incorporated. Non-blocking items may be Deferred, with a rationale. The user signs off. Finally, write `docs/02-design.md`, a table of *demo line → screen → state*.
