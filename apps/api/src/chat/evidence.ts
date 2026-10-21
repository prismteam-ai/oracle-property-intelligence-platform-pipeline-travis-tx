import type { Limitation, Meta, Source, UnpublishedSource } from '@travis/contract';
import type { CenterPoint } from './guard.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type EvidenceKind =
  'property' | 'permit' | 'contractor' | 'business' | 'license' | 'search_center' | 'run';

/** One `evidence[]` item of the chat response (api-contract.md, ChatEvidence). */
export interface Evidence {
  kind: EvidenceKind;
  tool_call_id: string;
  property_id: string | null;
  permit_id: string | null;
  contractor_attribution_key: string | null;
  business_record_id: string | null;
  license_record_id: string | null;
  record_cid: string | null;
  source: Source | Record<string, never>;
  unpublished_source: UnpublishedSource | null;
}

const blank = (kind: EvidenceKind, toolCallId: string): Evidence => ({
  kind,
  tool_call_id: toolCallId,
  property_id: null,
  permit_id: null,
  contractor_attribution_key: null,
  business_record_id: null,
  license_record_id: null,
  record_cid: null,
  source: {},
  unpublished_source: null,
});

/** The citation-token kinds and the evidence field each one is checked against. */
export const CITABLE: Record<string, EvidenceKind> = {
  property: 'property',
  permit: 'permit',
  contractor: 'contractor',
  business: 'business',
  license: 'license',
  run: 'run',
};

/**
 * Builds `evidence[]` from this turn's tool results, never from model output (api-contract.md): every record a tool
 * returned, once, under the first tool call that returned it. Also keeps what the server-side checks need: the ids per
 * kind, every CID a tool returned, the search centers, and what kinds of records appeared (for the typed limitations).
 */
export class EvidenceCollector {
  readonly items: Evidence[] = [];
  private readonly ids = new Map<EvidenceKind, Set<string>>();
  /** Every CID any tool returned in this turn (record, property, data-group, manifest and group CIDs). */
  readonly cids = new Set<string>();
  readonly centers: CenterPoint[] = [];
  readonly seen = {
    properties: 0,
    permits: 0,
    permitsNeedsReview: 0,
    permitsWithoutContractor: 0,
    contractors: 0,
    candidates: 0,
    durationsAsOf: null as string | null,
  };

  constructor(private readonly currentRunId: string) {}

  /**
   * Whether a tool returned this id in this turn. A property is also returned by a permit record that names it
   * (`property_id` of a permit evidence item), so a permit list can cite the properties it is on.
   */
  has(kind: EvidenceKind, id: string): boolean {
    if (this.ids.get(kind)?.has(id)) return true;
    return kind === 'property' && this.permitProperties.has(id);
  }
  private readonly permitProperties = new Set<string>();

  private push(e: Evidence, id: string): void {
    let set = this.ids.get(e.kind);
    if (!set) this.ids.set(e.kind, (set = new Set()));
    if (set.has(id)) return;
    set.add(id);
    this.items.push(e);
  }

  private cid(...cs: unknown[]): void {
    for (const c of cs) if (typeof c === 'string' && c) this.cids.add(c);
  }

  private property(p: any, callId: string): void {
    if (!p?.property_id) return;
    this.seen.properties++;
    this.cid(p.record_cid, p.property_cid, p.data_group_cid);
    this.push(
      {
        ...blank('property', callId),
        property_id: p.property_id,
        record_cid: p.record_cid ?? null,
        source: p.source ?? {},
        unpublished_source: p.unpublished_source ?? null,
      },
      p.property_id,
    );
  }

  private permit(p: any, callId: string): void {
    if (!p?.permit_id) return;
    this.seen.permits++;
    if (p.status_group === 'needs_review' || p.roof_work_class === 'needs_review')
      this.seen.permitsNeedsReview++;
    if (p.open_duration_as_of) this.seen.durationsAsOf = p.open_duration_as_of;
    this.cid(p.record_cid, p.property_cid, p.data_group_cid);
    if (p.property_id) this.permitProperties.add(p.property_id);
    this.push(
      {
        ...blank('permit', callId),
        permit_id: p.permit_id,
        property_id: p.property_id ?? null,
        record_cid: p.record_cid ?? null,
        source: p.source ?? {},
        unpublished_source: p.unpublished_source ?? null,
      },
      p.permit_id,
    );
    const key = p.contractor?.contractor_attribution_key;
    if (!key) {
      this.seen.permitsWithoutContractor++;
      return;
    }
    // A contractor attribution has no record of its own: it is backed by the printed fields of the permit it came from.
    this.seen.contractors++;
    this.push(
      {
        ...blank('contractor', callId),
        contractor_attribution_key: key,
        permit_id: p.permit_id,
        source: p.source ?? {},
        unpublished_source: p.unpublished_source ?? null,
      },
      key,
    );
  }

  private business(b: any, callId: string): void {
    if (!b?.business_record_id) return;
    this.push(
      {
        ...blank('business', callId),
        business_record_id: b.business_record_id,
        unpublished_source: b.unpublished_source ?? null,
      },
      b.business_record_id,
    );
  }

  private license(l: any, callId: string): void {
    if (!l?.license_record_id) return;
    this.push(
      {
        ...blank('license', callId),
        license_record_id: l.license_record_id,
        unpublished_source: l.unpublished_source ?? null,
      },
      l.license_record_id,
    );
  }

  /** Records what one successful tool call returned. */
  add(tool: string, callId: string, out: any): void {
    switch (tool) {
      case 'resolve_search_center':
        for (const c of out?.items ?? []) {
          this.centers.push(c);
          this.push(blank('search_center', callId), `${c.name}|${c.kind}`);
        }
        break;
      case 'search_properties':
        for (const p of out?.items ?? []) this.property(p, callId);
        break;
      case 'get_property':
        this.property(out, callId);
        for (const p of out?.permits ?? []) this.permit(p, callId);
        break;
      case 'search_permits':
      case 'search_permit_text':
        for (const p of out?.items ?? []) this.permit(p, callId);
        break;
      case 'get_permit':
        this.permit(out, callId);
        if (out?.property) this.property(out.property, callId);
        break;
      case 'get_contractor': {
        const key = out?.contractor_attribution_key;
        if (!key) break;
        this.seen.contractors++;
        this.push({ ...blank('contractor', callId), contractor_attribution_key: key }, key);
        for (const c of out.registry_candidates ?? []) {
          this.seen.candidates++;
          this.business(c, callId);
        }
        for (const c of out.license_candidates ?? []) {
          this.seen.candidates++;
          this.license(c, callId);
        }
        break;
      }
      case 'search_businesses':
        for (const b of out?.items ?? []) this.business(b, callId);
        break;
      case 'search_licenses':
        for (const l of out?.items ?? []) this.license(l, callId);
        break;
      case 'get_run_summary': {
        const m = out?.meta;
        this.cid(m?.manifest_cid);
        for (const g of Object.values(m?.groups ?? {}) as any[])
          this.cid(g?.cid, g?.schema, g?.tables);
        // Run evidence has no record of its own (record_cid null, source {}); the response's run_id names the run.
        if (m?.run?.run_id === this.currentRunId)
          this.push(blank('run', callId), this.currentRunId);
        break;
      }
    }
  }
}

/** Server-added typed limitations (api-contract.md): taken from `/v1/meta.limitations`, plus this turn's counts. */
export function turnLimitations(meta: Meta, c: EvidenceCollector): Limitation[] {
  const pick = (pred: (l: Limitation) => boolean) => meta.limitations.filter(pred);
  const out: Limitation[] = [];
  if (c.seen.contractors > 0) out.push(...pick((l) => l.source === 'bbb.org'));
  if (c.seen.permits > 0) {
    out.push({
      source: 'austin-issued-construction-permits/3syk-w9eu',
      availability: 'supported_partial',
      source_access_status: 'available',
      incomplete_reason: 'needs_review',
      detail:
        `${c.seen.permitsNeedsReview} of the ${c.seen.permits} permits returned in this turn are needs_review (status or work class outside the profile's mapping). ` +
        `County-wide: ${meta.counts.permits_needs_review} permits and ${meta.counts.roofing_permits_needs_review} roofing permits are needs_review and left out of the open, stalled and closed counts and the open-permit signal.`,
      evidence: '/v1/meta counts.permits_needs_review, counts.roofing_permits_needs_review',
      records_request: null,
    });
    if (c.seen.permitsWithoutContractor > 0)
      out.push(...pick((l) => l.incomplete_reason === 'no_contractor_printed'));
  }
  if (c.seen.properties > 0) out.push(...pick((l) => l.incomplete_reason === 'partial_history'));
  return out;
}

/** Server-added assumptions: the basis of every search center a search used, and the identity rules that applied. */
export function turnAssumptions(c: EvidenceCollector, usedCenters: CenterPoint[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of usedCenters) {
    const k = `${s.name}|${s.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(
      `Search center ${s.name} (${s.kind}, ${s.match_type} match): ${s.parcel_count.toLocaleString('en-US')} parcels; ${s.basis} (those with coordinates); distances are measured from that centroid.`,
    );
  }
  if (c.seen.contractors > 0)
    out.push(
      'Contractors are the listed contractor as printed on the permit, not a verified identity.',
    );
  if (c.seen.candidates > 0)
    out.push(
      'Registry and license candidates are exact name matches for review, not verified identities.',
    );
  if (c.seen.durationsAsOf) out.push(`Open durations are computed as of ${c.seen.durationsAsOf}.`);
  return out;
}
