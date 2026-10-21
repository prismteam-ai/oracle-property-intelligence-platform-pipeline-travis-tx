import type { PermitSummary, PropertySummary } from '@travis/contract';
import { fmtDays, fmtTime, fmtYears, haversineMiles } from '../lib/format.js';
import { Provenance } from './common.js';

const addressLine = (p: PropertySummary['address']) =>
  [p.line1, p.city, p.zip].filter(Boolean).join(', ') || 'address text unavailable';

export function BbbBadge({ bbb }: { bbb: PermitSummary['bbb'] }) {
  if (bbb.status === 'available') return <span className="badge ok">BBB {bbb.rating}</span>;
  return (
    <span className="badge warn" title={bbb.note ?? undefined}>
      BBB {bbb.status}
      {bbb.incomplete_reason ? ` (${bbb.incomplete_reason})` : ''}
    </span>
  );
}

export function PropertyCard({ property: p }: { property: PropertySummary }) {
  return (
    <article className="card" data-testid="property-card">
      <h3>{addressLine(p.address)}</h3>
      <dl className="ids">
        <dt>property_id</dt>
        <dd>{p.property_id}</dd>
        <dt>geo_id</dt>
        <dd>{p.geo_id ?? 'n/a'}</dd>
      </dl>
      <p>
        Roof age <strong>{p.roof_age_years === null ? 'n/a' : `${p.roof_age_years} y`}</strong> ·
        basis <strong>{p.roof_age_basis ?? 'none'}</strong> ({p.roof_age_confidence} confidence)
        {p.roof_year ? ` · roof year ${p.roof_year}` : ''}
        {p.year_built ? ` · built ${p.year_built}` : ''}
      </p>
      <p>
        Coordinates{' '}
        {p.lat !== null && p.lon !== null ? (
          <code>
            {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
          </code>
        ) : (
          'n/a'
        )}
        {p.coordinate_basis ? ` (${p.coordinate_basis})` : ''}
        {p.distance_miles != null ? ` · ${p.distance_miles.toFixed(2)} mi from center` : ''}
      </p>
      <p>
        Roofing permits: {p.roofing_permit_counts.open} open · {p.roofing_permit_counts.stalled}{' '}
        stalled · {p.roofing_permit_counts.closed} closed
        {p.owner_tenure_years !== null ? ` · owner tenure ${fmtYears(p.owner_tenure_years)}` : ''}
        {p.owner_absentee ? ' · absentee owner' : ''}
        {p.owner_out_of_area ? ' · out-of-area owner' : ''}
      </p>
      {p.roof_age_caveats.length > 0 ? (
        <p className="muted">{p.roof_age_caveats.join(' ')}</p>
      ) : null}
      <Provenance source={p.source} recordCid={p.record_cid} />
    </article>
  );
}

export function PermitCard({ permit: p }: { permit: PermitSummary }) {
  return (
    <article className="card" data-testid="permit-card">
      <h3>
        {p.permit_id}{' '}
        <span className={`badge ${p.status_group === 'closed' ? '' : 'warn'}`}>
          {p.status_group}
        </span>
      </h3>
      <dl className="ids">
        <dt>property_id</dt>
        <dd>{p.property_id}</dd>
        <dt>geo_id</dt>
        <dd>{p.geo_id ?? 'n/a'}</dd>
      </dl>
      <p>{p.description}</p>
      <p>
        {p.status} (observed {fmtTime(p.status_observed_at)}, {p.status_source}) · class{' '}
        <strong>{p.roof_work_class}</strong> · open duration{' '}
        <strong>{fmtDays(p.open_duration_days)}</strong>
        {p.open_since ? ` since ${p.open_since.slice(0, 10)} (${p.open_since_basis})` : ''}
      </p>
      <p>
        {p.contractor ? (
          <>
            Contractor <strong>{p.contractor.company_name ?? p.contractor.printed_name}</strong>
            {p.contractor.company_name ? (
              <>
                {' '}
                (printed contact <span>{p.contractor.printed_name}</span>)
              </>
            ) : null}{' '}
            · {p.contractor.identity_status}
          </>
        ) : (
          <>No contractor printed on the permit</>
        )}{' '}
        · <BbbBadge bbb={p.bbb} />
      </p>
      {p.match_snippet ? <p className="muted">…{p.match_snippet.text}…</p> : null}
      <Provenance source={p.source} recordCid={p.record_cid} />
    </article>
  );
}

/** A coordinate plot: centre, radius ring and the hits, scaled to the radius. No tiles, no external requests. */
export function MapPlot({
  center,
  radiusMiles,
  points,
}: {
  center: { lat: number; lon: number } | null;
  radiusMiles: number;
  points: { id: string; lat: number; lon: number }[];
}) {
  if (!center) return null;
  const size = 320;
  const half = size / 2;
  const milesPerDegLat = 69.0;
  const milesPerDegLon = 69.17 * Math.cos((center.lat * Math.PI) / 180);
  const scale = (half - 12) / Math.max(radiusMiles, 0.1);
  return (
    <svg
      role="img"
      aria-label={`Plot of ${points.length} results within ${radiusMiles} miles`}
      viewBox={`0 0 ${size} ${size}`}
      className="plot"
    >
      <circle cx={half} cy={half} r={half - 12} className="ring" />
      <circle cx={half} cy={half} r={4} className="center" />
      {points.map((point) => {
        const x = half + (point.lon - center.lon) * milesPerDegLon * scale;
        const y = half - (point.lat - center.lat) * milesPerDegLat * scale;
        const inside =
          haversineMiles(center.lat, center.lon, point.lat, point.lon) <= radiusMiles * 1.05;
        return inside ? (
          <circle key={point.id} cx={x} cy={y} r={3} className="dot">
            <title>{point.id}</title>
          </circle>
        ) : null;
      })}
    </svg>
  );
}
