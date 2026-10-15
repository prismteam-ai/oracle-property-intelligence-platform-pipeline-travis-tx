import { log } from "../core/log.js";
import type { RunContext, SourceAdapter, SourceOutcome } from "../core/run.js";
import { loadTcadRoll } from "./tcad-roll.js";

type Probe = { url: string; status: number | null; error?: string; server?: string | null };

async function probe(url: string, ctx: RunContext): Promise<Probe> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": ctx.config.userAgent },
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });
    await res.body?.cancel();
    return { url, status: res.status, server: res.headers.get("server") };
  } catch (err) {
    return { url, status: null, error: String(err) };
  }
}

async function egressCountry(ctx: RunContext): Promise<string | null> {
  try {
    const res = await fetch("https://ipinfo.io/country", {
      headers: { "user-agent": ctx.config.userAgent },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? (await res.text()).trim() : null;
  } catch {
    return null;
  }
}

export function egressGatedSource(args: {
  id: string;
  name: string;
  provides: string[];
  probeUrls: string[];
  limitation: string;
  loadFromFile?: (ctx: RunContext) => Promise<SourceOutcome | undefined>;
}): SourceAdapter {
  return {
    id: args.id,
    name: args.name,
    provides: args.provides,
    async run(ctx: RunContext): Promise<SourceOutcome> {
      const country = await egressCountry(ctx);
      const probes = await Promise.all(args.probeUrls.map((u) => probe(u, ctx)));
      const reachable = probes.every((p) => p.status !== null && p.status < 400);
      if (args.loadFromFile) {
        const loaded = await args.loadFromFile(ctx);
        if (loaded)
          return { ...loaded, detail: { ...loaded.detail, egressCountry: country, probes } };
      }
      log.warn("source_egress_gated", { source: args.id, country, reachable, probes });
      return {
        status: "blocked",
        limitation: reachable
          ? `${args.limitation} Source is reachable from this egress (${country ?? "unknown"}) but no ingest artifact has been supplied yet.`
          : `${args.limitation} Not reachable from egress country ${country ?? "unknown"} (HTTP ${probes.map((p) => p.status ?? "error").join(", ")}); run from US egress (AWS us-east-2 runner).`,
        detail: { egressCountry: country, probes },
      };
    },
  };
}

export const tcadAppraisalRoll = egressGatedSource({
  id: "tcad_appraisal_roll",
  name: "Travis Central Appraisal District appraisal-roll export",
  provides: ["parcels.year_built", "parcels.deed_date", "improvements"],
  probeUrls: ["https://traviscad.org/publicinformation", "https://travis.prodigycad.com/"],
  loadFromFile: loadTcadRoll,
  limitation:
    "Year built, improvement detail and deed/sale dates are only in the TCAD appraisal export; roof age falls back to permit evidence and ownership tenure is unavailable until it is ingested.",
});

export const bbbProfiles = egressGatedSource({
  id: "bbb_roofing_contractors",
  name: "BBB roofing-contractor profiles (Austin, TX)",
  provides: ["bbb_profiles"],
  probeUrls: ["https://www.bbb.org/us/tx/austin/category/roofing-contractors"],
  limitation: "BBB ratings require a BBB harvest; contractor BBB fields stay null until then.",
});
