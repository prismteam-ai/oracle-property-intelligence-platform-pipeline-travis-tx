// T023: the ArcGIS `TCAD.TC_USER.TCAD_PARCELS` count-only probe (research R7, FR-003b,
// FR-003c). One `returnCountOnly=true` request with a 60 s timeout, no paging. GIS is never
// the property population: the gap is measured against the TCAD roll, and a missing count
// gives `gap_pct: unknown` with a reason (oracle risk 3).
import { z } from "zod";
import type { CaptureReceipt } from "../../lib/source-client.js";
import type { Measurement } from "../catalog.schema.js";
import { missingReason, nullMeasurement, stopsSource, type ProbeDeps } from "./common.js";

export const TCAD_GIS_LAYER_URL =
  "https://gis.traviscountytx.gov/server1/rest/services/CIPStoryMap/Main_Location_Map2/MapServer/6";
export const GIS_TIMEOUT_MS = 60_000;

const METHOD = "returnCountOnly";
const CountResponse = z.looseObject({ count: z.int().nonnegative() });

export function gisCountUrl(layerUrl: string = TCAD_GIS_LAYER_URL): string {
  return `${layerUrl}/query?where=1%3D1&returnCountOnly=true&f=json`;
}

export interface GisProbe {
  status: "available" | "blocked";
  receipts: CaptureReceipt[];
  blocked_receipt: CaptureReceipt | null;
  receipt: CaptureReceipt;
  url: string;
  gis_feature_count: Measurement;
}

export interface GisProbeOptions {
  layerUrl?: string;
  timeoutMs?: number;
}

export async function probeGisCount(
  deps: ProbeDeps,
  opts: GisProbeOptions = {},
): Promise<GisProbe> {
  const layerUrl = opts.layerUrl ?? TCAD_GIS_LAYER_URL;
  const url = gisCountUrl(layerUrl);
  const { receipt, data } = await deps.client.capture({
    url,
    schema: CountResponse,
    accept: "application/json",
    timeoutMs: opts.timeoutMs ?? GIS_TIMEOUT_MS,
  });
  const stopped = stopsSource(receipt) || data === null;
  const reason =
    receipt.blocked_reason === "timeout"
      ? `timeout after ${receipt.timeout_ms ?? 0} ms at ${receipt.captured_at}`
      : missingReason(receipt);
  return {
    status: stopped ? "blocked" : "available",
    receipts: [receipt],
    blocked_receipt: stopped ? receipt : null,
    receipt,
    url: layerUrl,
    gis_feature_count:
      stopped || data === null
        ? nullMeasurement(url, receipt.captured_at, reason, METHOD)
        : { value: data.count, source_url: url, captured_at: receipt.captured_at, method: METHOD },
  };
}

export interface Gap {
  gap_pct: number | "unknown";
  gap_reason?: string;
}

/** Gap between the roll (always the denominator) and the GIS count, in percent of the roll. */
export function computeGap(assessed: Measurement, gis: Measurement): Gap {
  if (assessed.value === null) {
    return {
      gap_pct: "unknown",
      gap_reason: `roll count missing: ${assessed.missing_reason ?? "not measured"}`,
    };
  }
  if (gis.value === null) {
    return {
      gap_pct: "unknown",
      gap_reason: `GIS count missing: ${gis.missing_reason ?? "not measured"}`,
    };
  }
  const pct = gapPercent(assessed.value, gis.value);
  if (pct === "unknown") {
    return { gap_pct: "unknown", gap_reason: "roll count is 0; a percentage is undefined" };
  }
  return { gap_pct: pct };
}

/**
 * CR2-9: the one gap rule. |roll - gis| / roll in percent, rounded to 3 decimals; the roll is
 * always the denominator, so a roll of 0 or less gives "unknown".
 */
export function gapPercent(roll: number, gis: number): number | "unknown" {
  if (!(roll > 0)) return "unknown";
  const pct = (Math.abs(roll - gis) / roll) * 100;
  return Math.round(pct * 1000) / 1000;
}
