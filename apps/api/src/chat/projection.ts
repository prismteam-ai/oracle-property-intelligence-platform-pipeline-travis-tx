import { sanitizeDeep, sanitizeText } from './sanitize.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * What the model sees of each tool result (decisions.md section 20, "Agent tools"): ids, CIDs, signals and `source.url`,
 * never `source_http_request` or `unpublished_source` (the evidence table carries those), long text cut, every string
 * sanitized. Personal data (owner name, mailing address, applicant, contractor phone and address) only when the question
 * asks about ownership or contact. The full records go to the evidence collector, not to the model.
 */
export interface ProjectionOptions {
  /** The question asks about ownership or contact. */
  personal: boolean;
}

/** Description length in a list (the detail view gets the full 1,000-character cap). */
export const LIST_TEXT_MAX = 300;

const OWNERSHIP =
  /\b(owner|owners|owned|owns|ownership|deed|landlord|mailing|who\s+lives|resident)\b/i;
const CONTACT =
  /\b(contact|phone|telephone|call|reach|e-?mail|address\s+of\s+the\s+(owner|contractor))\b/i;

/** Whether the latest question asks about ownership or contact (decisions.md section 20, "Personal data"). */
export function asksPersonal(question: string): boolean {
  return OWNERSHIP.test(question) || CONTACT.test(question);
}

const addr = (a: any): string | null =>
  a ? [a.line1, a.line2, a.city, a.state, a.zip].filter((x) => x).join(', ') || null : null;

const nonEmpty = <T>(xs: T[] | null | undefined): T[] | undefined =>
  xs && xs.length > 0 ? xs : undefined;

function property(p: any): Record<string, unknown> {
  return {
    property_id: p.property_id,
    geo_id: p.geo_id,
    address: addr(p.address),
    year_built: p.year_built,
    roof_age_years: p.roof_age_years,
    roof_year: p.roof_year,
    roof_age_basis: p.roof_age_basis,
    roof_age_confidence: p.roof_age_confidence,
    roof_age_caveats: nonEmpty(p.roof_age_caveats),
    last_roofing_permit: p.last_roofing_permit,
    roofing_permit_counts: p.roofing_permit_counts,
    owner_tenure_years: p.owner_tenure_years,
    owner_absentee: p.owner_absentee,
    owner_out_of_area: p.owner_out_of_area,
    distance_miles: p.distance_miles,
    match_reasons: p.match_reasons,
    record_cid: p.record_cid,
    source_url: p.source?.url ?? null,
  };
}

function permit(p: any, o: ProjectionOptions, textMax: number): Record<string, unknown> {
  const c = p.contractor;
  return {
    permit_id: p.permit_id,
    property_id: p.property_id,
    permit_class: p.permit_class,
    work_class: p.work_class,
    description: p.description ? sanitizeText(p.description, textMax) : p.description,
    roof_work_class: p.roof_work_class,
    status: p.status,
    status_group: p.status_group,
    applied_date: p.applied_date,
    issued_date: p.issued_date,
    expires_date: p.expires_date,
    completed_date: p.completed_date,
    completed_date_evidence: p.completed_date_evidence,
    open_since: p.open_since,
    open_duration_days: p.open_duration_days,
    open_duration_as_of: p.open_duration_as_of,
    days_since_expiry: p.days_since_expiry,
    contractor: c
      ? {
          contractor_attribution_key: c.contractor_attribution_key,
          company_name: c.company_name || null,
          printed_name: c.printed_name || null,
          trade: c.trade || null,
          ...(o.personal ? { phone: c.phone || null } : {}),
        }
      : null,
    bbb_status: p.bbb?.status ?? null,
    distance_miles: p.distance_miles,
    match_snippet: p.match_snippet?.text,
    bm25_score: p.bm25_score,
    record_cid: p.record_cid,
    source_url: p.source?.url ?? null,
  };
}

/** Drops null fields of a list item (a missing field reads as unknown) to keep the page small. */
const compact = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

function page(r: any, item: (x: any) => Record<string, unknown>) {
  const items = (r.items ?? []).map((x: any) => compact(item(x)));
  // a source URL shared by every item (the TCAD export for properties) is given once for the page
  const urls = new Set(items.map((i: any) => i.source_url));
  const shared = items.length > 1 && urls.size === 1 ? (items[0].source_url as string) : undefined;
  return {
    total: r.total,
    returned: items.length,
    area_note: r.area_note ?? null,
    has_more: r.next_cursor != null,
    ...(shared ? { source_url: shared } : {}),
    items: shared ? items.map(({ source_url: _u, ...rest }: any) => rest) : items,
  };
}

function business(b: any, o: ProjectionOptions): Record<string, unknown> {
  const a = b.address;
  return {
    business_record_id: b.business_record_id,
    source: b.source,
    name: b.name,
    record_id: b.record_id,
    sos_file_number: b.sos_file_number,
    organization_type: b.organization_type,
    status_code: b.status_code,
    status_date: b.status_date,
    right_to_transact: b.right_to_transact,
    naics_code: b.naics_code,
    address: o.personal ? addr(a) : a ? [a.city, a.state, a.zip].filter((x) => x).join(', ') : null,
    scope: b.scope,
    candidate_of: b.candidate_of,
    source_url: b.unpublished_source?.url ?? null,
  };
}

function license(l: any): Record<string, unknown> {
  return {
    license_record_id: l.license_record_id,
    source: l.source,
    license_number: l.license_number,
    license_type: l.license_type,
    license_subtype: l.license_subtype,
    holder_name: l.holder_name,
    business_name: l.business_name,
    issue_date: l.issue_date,
    expiration_date: l.expiration_date,
    business_city: l.business_city,
    business_county: l.business_county,
    source_url: l.unpublished_source?.url ?? null,
  };
}

function runSummary(r: any): Record<string, unknown> {
  const m = r.meta;
  const c = m.counts;
  return {
    county: m.county,
    run: m.run,
    manifest_cid: m.manifest_cid,
    deploy_id: m.deploy?.deploy_id,
    published_group_archives: Object.keys(m.groups ?? {}).length,
    counts: {
      properties: c.properties,
      with_roof_age: c.with_roof_age,
      permits: c.permits,
      permits_joined_to_property: c.permits_joined_to_property,
      roofing_permits: c.roofing_permits,
      open_roofing_permits: c.open_roofing_permits,
      stalled_roofing_permits: c.stalled_roofing_permits,
      roofing_permits_needs_review: c.roofing_permits_needs_review,
      permits_needs_review: c.permits_needs_review,
      permit_contractor_attributions: c.permit_contractor_attributions,
      business_records: c.business_records,
      license_records: c.license_records,
    },
    limitations: (m.limitations ?? []).map((l: any) => ({
      source: l.source,
      incomplete_reason: l.incomplete_reason,
      detail: sanitizeText(l.detail ?? '', 240),
    })),
    runs: (r.runs ?? []).map((x: any) => ({
      run_id: x.run_id,
      started_at: x.started_at,
      finished_at: x.finished_at,
      manifest_cid: x.manifest_cid,
    })),
  };
}

/**
 * The server's reading of a resolve_search_center result, next to the items (decisions.md section 20: the agent asks when
 * only non-exact search centers come back; api-contract.md: no match is a place outside Travis County).
 */
export function centerGuidance(items: any[]): string {
  if (items.length === 0)
    return 'No Travis County search center matches this name: the place is outside Travis County (outcome out_of_county), unless it is a misspelling to ask about.';
  const exact = items.filter((c) => c.match_type === 'exact');
  if (exact.length === 0)
    return 'Only prefix or alias matches: do not search and do not resolve another name in their place; ask the user which place they meant, naming the candidates (outcome needs_clarification). Searches around these centers are rejected.';
  const best = exact.reduce((a, b) => (b.parcel_count > a.parcel_count ? b : a));
  const bigger = items.find(
    (c) => c !== best && c.parcel_count >= 10 * Math.max(1, best.parcel_count),
  );
  if (best.parcel_count < 50 && bigger)
    return `The exact match ${best.name} has only ${best.parcel_count} parcels while ${bigger.name} has ${bigger.parcel_count}: ask which one the user meant (outcome needs_clarification).`;
  return `Use ${best.name} (${best.kind}, exact match, ${best.parcel_count} parcels).`;
}

/** The model's view of one successful tool result. */
export function projectToolResult(tool: string, out: any, o: ProjectionOptions): unknown {
  let v: unknown;
  switch (tool) {
    case 'resolve_search_center':
      v = { items: out.items, guidance: centerGuidance(out.items ?? []) };
      break;
    case 'search_properties':
      v = page(out, property);
      break;
    case 'get_property':
      v = {
        ...property(out),
        owner: out.owner
          ? {
              ...(o.personal
                ? {
                    owner_name: out.owner.owner_name,
                    mailing_address: addr(out.owner.mailing_address),
                  }
                : {}),
              deed_date: out.owner.deed_date,
              owner_tenure_years: out.owner.owner_tenure_years,
              owner_absentee: out.owner.owner_absentee,
              owner_out_of_area: out.owner.owner_out_of_area,
            }
          : null,
        permits_total: out.permits_total,
        permits_truncated: out.permits_truncated,
        permits: (out.permits ?? []).map((p: any) => permit(p, o, LIST_TEXT_MAX)),
      };
      break;
    case 'search_permits':
    case 'search_permit_text':
      v = page(out, (p) => permit(p, o, LIST_TEXT_MAX));
      break;
    case 'get_permit':
      v = {
        ...permit(out, o, 1000),
        property: out.property ? property(out.property) : null,
        applicant: null,
        applicant_unavailable_reason: out.applicant_unavailable_reason,
      };
      break;
    case 'get_contractor':
      v = {
        contractor_attribution_key: out.contractor_attribution_key,
        identity_status: out.identity_status,
        company_name: out.company_name,
        printed_names: (out.printed_names ?? []).slice(0, 5),
        trade: out.trade,
        ...(o.personal ? { phone: out.phone, address: out.address } : {}),
        permit_count: out.permit_count,
        open_permit_count: out.open_permit_count,
        roofing_permit_count: out.roofing_permit_count,
        needs_review_permit_count: out.needs_review_permit_count,
        registry_candidates: (out.registry_candidates ?? []).map((c: any) => ({
          business_record_id: c.business_record_id,
          source: c.source,
          name: c.name,
          taxpayer_number: c.taxpayer_number,
          sos_file_number: c.sos_file_number,
          scope: c.scope,
          match_method: c.match_method,
          status: c.status,
        })),
        license_candidates:
          out.license_candidates == null
            ? null
            : out.license_candidates.map((c: any) => ({
                license_record_id: c.license_record_id,
                source: c.source,
                name: c.name,
                license_number: c.license_number,
                license_type: c.license_type,
                matched_field: c.matched_field,
                match_method: c.match_method,
                status: c.status,
              })),
        official_identity: out.official_identity,
        bbb_status: out.bbb?.status ?? null,
      };
      break;
    case 'search_businesses':
      v = { ...page(out, (b) => business(b, o)), matcher_version: out.matcher_version };
      break;
    case 'search_licenses':
      v = { ...page(out, license), matcher_version: out.matcher_version };
      break;
    case 'get_run_summary':
      v = runSummary(out);
      break;
    default:
      v = out;
  }
  return sanitizeDeep(dropUndefined(v));
}

function dropUndefined(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropUndefined);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = dropUndefined(x);
    return o;
  }
  return v;
}

/** The person values a personal view of this result shows (registered so traces can hide them in any text). */
export function personValuesOf(tool: string, out: any): (string | null | undefined)[] {
  const owner = out?.owner;
  const m = owner?.mailing_address;
  const phones = (ps: any[] | undefined) => (ps ?? []).map((p) => p?.contractor?.phone);
  switch (tool) {
    case 'get_property':
      return [owner?.owner_name, m?.line1, m?.line2, addr(m), ...phones(out?.permits)];
    case 'get_permit':
    case 'search_permits':
    case 'search_permit_text':
      return [out?.contractor?.phone, ...phones(out?.items)];
    case 'get_contractor':
      return [out?.phone, out?.address];
    default:
      return [];
  }
}

/** One line for `tool_calls[].result_summary` and the logs: counts only, no record text. */
export function summarizeToolResult(tool: string, out: any): string {
  switch (tool) {
    case 'resolve_search_center': {
      const items = out.items ?? [];
      if (items.length === 0) return 'no search center matches';
      return `${items.length} search centers: ${items
        .slice(0, 3)
        .map((c: any) => `${c.name} (${c.kind}, ${c.match_type})`)
        .join(', ')}`;
    }
    case 'search_properties':
    case 'search_permits':
    case 'search_permit_text':
    case 'search_businesses':
    case 'search_licenses':
      return `${out.total} matches, ${out.items?.length ?? 0} returned${out.area_note ? `; ${out.area_note}` : ''}`;
    case 'get_property':
      return `property ${out.property_id} with ${out.permits?.length ?? 0} of ${out.permits_total ?? 0} permits`;
    case 'get_permit':
      return `permit ${out.permit_id} (${out.status_group})`;
    case 'get_contractor':
      return `contractor ${out.contractor_attribution_key}: ${out.permit_count} permits, ${out.registry_candidates?.length ?? 0} registry and ${out.license_candidates?.length ?? 0} license candidates`;
    case 'get_run_summary':
      return `run ${out.meta?.run?.run_id}`;
    default:
      return 'ok';
  }
}

/** `total` and `returned` of a result, when it is a page. */
export function resultCounts(out: any): { total: number | null; returned: number | null } {
  if (out && typeof out === 'object' && Array.isArray(out.items))
    return {
      total: typeof out.total === 'number' ? out.total : out.items.length,
      returned: out.items.length,
    };
  return { total: null, returned: null };
}
