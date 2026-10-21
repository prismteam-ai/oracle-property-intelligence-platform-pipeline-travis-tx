import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api.js';
import { ErrorBox, Loading, Section } from '../components/common.js';
import { BbbBadge, PermitCard, PropertyCard } from '../components/records.js';
import { useMeta, useRuns } from '../hooks.js';
import { fmtInt, fmtTime } from '../lib/format.js';

/** Demo step 2: uploaded records by source, with collection timestamps and provenance. */
export function Records() {
  const api = useApi();
  const meta = useMeta();
  const runs = useRuns();
  const sample = useQuery({
    queryKey: ['records-sample'],
    queryFn: async () => {
      const [properties, permits] = await Promise.all([
        api.searchProperties({ roof_age_min: 0, open_permits: false, limit: 2 }),
        api.searchPermits({ limit: 2 }),
      ]);
      return { properties, permits };
    },
  });
  if (meta.isPending) return <Loading what="records by source" />;
  if (meta.isError) return <ErrorBox error={meta.error} />;
  const m = meta.data;
  const c = m.counts;
  const run = runs.data?.items.find((r) => r.run_id === m.run.run_id);
  const fetched = (needle: string) =>
    run?.sources?.find((s) => s.dataset.includes(needle))?.fetched_at ?? null;
  const bbb = m.limitations.find((l) => l.source === 'bbb.org');
  const bbbNote = bbb
    ? `BBB ${bbb.source_access_status} (${bbb.incomplete_reason ?? bbb.availability})`
    : 'BBB status as the API reports it';

  const rows: {
    kind: string;
    count: number;
    source: string;
    collected: string | null;
    note?: string;
  }[] = [
    {
      kind: 'Property',
      count: c.properties,
      source: 'tcad-2026-certified-appraisal-export',
      collected: fetched('tcad-2026'),
    },
    {
      kind: 'Permit',
      count: c.permits,
      source: 'austin-issued-construction-permits/3syk-w9eu',
      collected: fetched('austin-issued'),
    },
    {
      kind: 'Ownership',
      count: c.owners,
      source: 'tcad-2026-certified-appraisal-export (owner and mailing fields)',
      collected: fetched('tcad-2026'),
    },
    {
      kind: 'Contractor (attribution)',
      count: c.permit_contractor_attributions,
      source: 'printed on the Austin permit export',
      collected: fetched('austin-issued'),
      note: `${fmtInt(c.bbb_profiles)} BBB profiles loaded · ${bbbNote}`,
    },
    {
      kind: 'Coordinates',
      count: c.with_coordinates,
      source: 'travis-tnr-tcad-parcels',
      collected: fetched('travis-tnr'),
    },
    ...Object.entries(c.by_source).map(([key, s]) => ({
      kind: s.kind === 'business' ? 'Business' : 'License',
      count: s.rows_loaded,
      source: `${key} (${s.dataset})`,
      collected: s.fetched_at as string | null,
    })),
  ];

  return (
    <>
      <Section title="Uploaded records by source" step="2">
        <table>
          <thead>
            <tr>
              <th>Records</th>
              <th>Loaded</th>
              <th>Source</th>
              <th>Collected</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.source}`}>
                <td>{r.kind}</td>
                <td className="num">{fmtInt(r.count)}</td>
                <td>{r.source}</td>
                <td>{fmtTime(r.collected)}</td>
                <td>{r.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Sample records with provenance">
        {sample.isPending ? <Loading what="sample records" /> : null}
        {sample.isError ? <ErrorBox error={sample.error} /> : null}
        {sample.data ? (
          <>
            <h3>Properties</h3>
            {sample.data.properties.items.map((p) => (
              <PropertyCard key={p.property_id} property={p} />
            ))}
            <h3>Permits with contractor and BBB status</h3>
            {sample.data.permits.items.map((p) => (
              <div key={p.permit_id}>
                <PermitCard permit={p} />
                <p className="muted">
                  Contractor attribution{' '}
                  {p.contractor ? (
                    <code>{p.contractor.contractor_attribution_key}</code>
                  ) : (
                    'none printed'
                  )}{' '}
                  · <BbbBadge bbb={p.bbb} />
                </p>
              </div>
            ))}
          </>
        ) : null}
      </Section>
    </>
  );
}
