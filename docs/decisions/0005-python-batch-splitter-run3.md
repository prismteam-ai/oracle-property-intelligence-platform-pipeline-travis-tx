---
id: ADR-0005
type: decision
parent: ARD-A
story: A-11
title: "One-run exception: the Python batch splitter is used for Run 3"
status: Accepted by the PO (HebaGaber) on 2026-10-25, for Run 3 only
date: 2026-10-25
---

# Python batch splitter for Run 3 (A-11)

## Context

The constitution and CLAUDE.md forbid Python outside PySpark/Glue. `pipeline/publish/scripts/split-into-batches.py` was written for Run 1 (run-log, 2026-10-23 10:27) because splitting 441,961 folders into batches with one shell fork per item costs tens of minutes. Run 1 and Run 2 reused the same batch boundaries, and a TypeScript rewrite would risk different boundaries and so different CAR CIDs.

## Decision

The PO approved using the existing script unchanged for Run 3. This is a one-run exception: it does not allow any new Python. A TypeScript replacement (with the same equal-count, sorted-folder cut) is left for the sequence-runner batching work carried in A-16.

## Consequences

- No new Python file is added. The script only hard-links files, so it handles no secrets and makes no network call.
- The exception is recorded in `specs/011-publish-and-runs/run-log.md` (2026-10-25).
