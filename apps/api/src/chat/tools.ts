import { tool, type ToolSet } from 'ai';
import { TOOLS } from '@travis/contract';
import { QueryError, type Queries } from '@travis/query';
import type { EvidenceCollector } from './evidence.js';
import type { CenterPoint, CoordinateGuard } from './guard.js';
import { registerPersonValues } from './langsmith.js';
import {
  personValuesOf,
  projectToolResult,
  resultCounts,
  summarizeToolResult,
} from './projection.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** One `tool_calls[]` item of the chat response, plus the timing the log line carries. */
export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'ok' | 'error' | 'rate_limited' | 'timeout';
  total: number | null;
  returned: number | null;
  result_summary: string;
  ms: number;
}

/** The query layer, called in-process (never over HTTP), with the MCP page sizes (api-contract.md, "MCP tools"). */
const RUN: Record<string, (q: Queries, i: any) => Promise<unknown>> = {
  resolve_search_center: (q, i) => q.searchCenters(i),
  search_properties: (q, i) => q.searchProperties(i),
  get_property: (q, i) =>
    q.getProperty(
      i.property_id !== undefined ? { property_id: i.property_id } : { geo_id: i.geo_id },
      20,
    ),
  search_permits: (q, i) => q.searchPermits(i),
  search_permit_text: (q, i) => q.searchPermitText(i),
  get_permit: (q, i) => q.getPermit(i.permit_id),
  get_contractor: (q, i) => q.getContractor(i.contractor_attribution_key),
  get_run_summary: (q) => q.getRunSummary(),
  search_businesses: (q, i) => q.searchBusinesses(i),
  search_licenses: (q, i) => q.searchLicenses(i),
};

const GUARDED = new Set(['search_properties', 'search_permits', 'search_permit_text']);

export interface TurnTools {
  tools: ToolSet;
  records: ToolCallRecord[];
  /** The search centers whose coordinates a search used (their basis goes into `assumptions`). */
  usedCenters: CenterPoint[];
  /** Server assumptions the tools add (a state suffix dropped from a place name). */
  notes: string[];
}

/**
 * Drops a trailing Texas suffix from a place name ("Pflugerville, TX", "Austin Texas"): search centers are the roll's
 * situs names, which never carry the state, so "Austin, TX" would otherwise match a one-parcel "AUSTIN TX" or nothing.
 * The agent's wrapper only: the shared REST and MCP lookup keeps the contract's matching.
 */
export function stripStateSuffix(q: string): string {
  const m = /^(.*?[^\s,])\s*(?:,\s*|\s+)(?:tx|texas)\.?\s*$/i.exec(q.trim());
  return m ? m[1]! : q;
}

export interface TurnToolsOptions {
  queries: () => Promise<Queries>;
  evidence: EvidenceCollector;
  guard: CoordinateGuard;
  personal: boolean;
  /** Milliseconds left in the turn; a tool that would outlive it answers `timeout`. */
  remainingMs: () => number;
  /** One structured log line per tool call: ids, counts and timings only. */
  log: (r: ToolCallRecord) => void;
}

/**
 * The agent's tools: the registry entries marked `agent` (packages/contract/src/tools.ts, the same that MCP serves, plus
 * search_businesses and search_licenses), with the registry's frozen descriptions and Zod input schemas (`limit` 20, max
 * 50; `open_permits` required in search_properties).
 */
export function buildTurnTools(o: TurnToolsOptions): TurnTools {
  const records: ToolCallRecord[] = [];
  const usedCenters: CenterPoint[] = [];
  const notes: string[] = [];
  const tools: ToolSet = {};
  for (const def of TOOLS.filter((t) => t.agent)) {
    const run = RUN[def.name];
    if (!run) throw new Error(`no query for agent tool ${def.name}`);
    tools[def.name] = tool({
      description: def.description,
      inputSchema: def.input as any,
      execute: async (input: any, { toolCallId }: { toolCallId: string }) => {
        const t0 = performance.now();
        const rec = (
          status: ToolCallRecord['status'],
          summary: string,
          counts: { total: number | null; returned: number | null } = {
            total: null,
            returned: null,
          },
        ) => {
          const r: ToolCallRecord = {
            id: toolCallId,
            name: def.name,
            args: input ?? {},
            status,
            ...counts,
            result_summary: summary,
            ms: Math.round(performance.now() - t0),
          };
          records.push(r);
          o.log(r);
          return r;
        };
        if (GUARDED.has(def.name)) {
          const g = o.guard.check(input?.lat, input?.lon);
          if (!g.ok) {
            rec('error', g.detail);
            return { error: 'coordinates_not_allowed', detail: g.detail };
          }
          if (g.center) usedCenters.push(g.center);
        }
        let query = input;
        if (def.name === 'resolve_search_center' && typeof input?.q === 'string') {
          const stripped = stripStateSuffix(input.q);
          if (stripped !== input.q) {
            query = { ...input, q: stripped };
            const note = `State suffix dropped from the place name: "${input.q}" → "${stripped}" (search centers are Travis County names).`;
            if (!notes.includes(note)) notes.push(note);
          }
        }
        const budget = o.remainingMs();
        if (budget <= 0) {
          rec('timeout', 'the turn deadline was reached before the query ran');
          return { error: 'timeout', detail: 'the turn deadline was reached' };
        }
        let timer: NodeJS.Timeout | undefined;
        try {
          const q = await o.queries();
          const out: any = await Promise.race([
            run(q, query),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new ToolTimeout()), budget);
            }),
          ]);
          if (def.name === 'resolve_search_center') o.guard.addCenters(out?.items ?? []);
          o.evidence.add(def.name, toolCallId, out);
          rec('ok', summarizeToolResult(def.name, out), resultCounts(out));
          if (o.personal) registerPersonValues(personValuesOf(def.name, out));
          return projectToolResult(def.name, out, { personal: o.personal });
        } catch (e) {
          if (e instanceof ToolTimeout) {
            rec('timeout', 'the query outlived the turn deadline');
            return { error: 'timeout', detail: 'the query outlived the turn deadline' };
          }
          if (e instanceof QueryError) {
            rec('error', `${e.code}${e.detail ? `: ${e.detail}` : ''}`);
            return { error: e.code, ...(e.detail ? { detail: e.detail } : {}) };
          }
          rec('error', 'internal_error');
          return { error: 'internal_error' };
        } finally {
          clearTimeout(timer);
        }
      },
    });
  }
  return { tools, records, usedCenters, notes };
}

class ToolTimeout extends Error {
  constructor() {
    super('tool timeout');
    this.name = 'ToolTimeout';
  }
}
