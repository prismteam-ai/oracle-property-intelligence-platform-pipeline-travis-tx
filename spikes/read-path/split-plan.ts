// Simulates elephant-cli TableWriter part sealing (tables-export.service.js @ 44bb182) for one table:
// push(): seal when (compressed offset + pending est) + rowEst > cap; drain(): flush a row group when
// pending >= 64 MiB. Compressed size of a flushed group = pending * RATIO (measured: v1g bytes / sum est).
// Usage: tsx split-plan.ts <est.csv> <ratio> <capBytes>  -> JSON [{start,end,groups:[rows...]}] (rowid ranges)
import { readFileSync } from "node:fs";
const [file, ratioArg, capArg] = process.argv.slice(2);
const est = readFileSync(file, "utf8").trim().split("\n").map(Number);
const RATIO = Number(ratioArg), CAP = Number(capArg), BUDGET = 64 * 2 ** 20;
const parts: { start: number; end: number; groups: number[] }[] = [];
let cur: { start: number; end: number; groups: number[] } | null = null;
let offset = 0, pending = 0, pendingRows = 0;
const flush = () => { if (!pendingRows) return; cur ??= { start: -1, end: -1, groups: [] }; cur.groups.push(pendingRows); offset += pending * RATIO; pending = 0; pendingRows = 0; };
for (let i = 0; i < est.length; i++) {
  const held = offset + pending;
  if (held > 0 && held + est[i] > CAP) { flush(); parts.push(cur!); cur = null; offset = 0; }
  if (!cur) cur = { start: i, end: i, groups: [] };
  cur.end = i; pending += est[i]; pendingRows++;
  if (pending >= BUDGET) flush();
}
flush(); if (cur) parts.push(cur);
console.log(JSON.stringify(parts));
