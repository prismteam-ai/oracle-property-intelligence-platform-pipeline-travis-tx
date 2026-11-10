import { daysBefore } from "./iso-date.js";

export enum WindowKind {
  Full = "full",
  Since = "since",
}

export type IngestWindow = { kind: WindowKind.Full } | { kind: WindowKind.Since; since: string };

export function windowAfter(watermark: string | undefined, lookbackDays: number): IngestWindow {
  if (watermark === undefined) return { kind: WindowKind.Full };
  return { kind: WindowKind.Since, since: daysBefore(watermark, lookbackDays) };
}
