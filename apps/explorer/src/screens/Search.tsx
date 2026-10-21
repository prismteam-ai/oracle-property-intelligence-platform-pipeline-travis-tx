import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { pageWithRestart } from '@travis/api-client';
import { useApi } from '../api.js';
import { ErrorBox, Loading, Section } from '../components/common.js';
import { MapPlot, PermitCard, PropertyCard } from '../components/records.js';
import { fmtInt } from '../lib/format.js';

type Mode = 'aging' | 'permits' | 'tenure' | 'owners' | 'text';

const REPLACEMENTS_AND_REPAIRS = ['primary_roof_replacement', 'repair_or_coating'] as const;

const MODES: { id: Mode; label: string }[] = [
  { id: 'aging', label: 'Roofs older than N years' },
  { id: 'permits', label: 'Open and stalled roofing permits' },
  { id: 'tenure', label: 'Owner tenure over N years' },
  { id: 'owners', label: 'Absentee and out-of-area owners' },
  { id: 'text', label: 'Free-text permit search' },
];

interface Center {
  lat: number;
  lon: number;
  label: string;
}

interface Submitted {
  mode: Mode;
  center: Center | null;
  radius: number;
  roofAge: number;
  tenure: number;
  owners: 'absentee' | 'out_of_area';
  text: string;
  repairsOnly: boolean;
  cursor?: string;
  nonce: number;
}

/** Demo steps 7 and 8: the roofing-CRM questions, answered by the API with provenance. */
export function Search() {
  const api = useApi();
  const [mode, setMode] = useState<Mode>('aging');
  const [placeText, setPlaceText] = useState('');
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [centers, setCenters] = useState<
    {
      name: string;
      kind: string;
      lat: number;
      lon: number;
      basis: string;
      match_type: string;
      parcel_count: number;
    }[]
  >([]);
  const [center, setCenter] = useState<Center | null>(null);
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [radius, setRadius] = useState(5);
  const [roofAge, setRoofAge] = useState(15);
  const [tenure, setTenure] = useState(10);
  const [owners, setOwners] = useState<'absentee' | 'out_of_area'>('absentee');
  const [text, setText] = useState('re-roof');
  const [repairsOnly, setRepairsOnly] = useState(true);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);

  async function findPlace(e: FormEvent) {
    e.preventDefault();
    setPlaceError(null);
    try {
      const res = await api.searchCenters(placeText);
      setCenters(res.items);
      if (res.items.length === 0) setPlaceError('No search center matches that name.');
      const first = res.items[0];
      const second = res.items[1];
      // Exact match first; with several non-exact matches the user chooses which was meant.
      if (first && first.match_type === 'exact' && second?.match_type !== 'exact') {
        setCenter({ lat: first.lat, lon: first.lon, label: first.name });
      }
    } catch (error) {
      setPlaceError(String(error));
    }
  }

  function useTyped() {
    const la = Number(lat);
    const lo = Number(lon);
    if (lat.trim() !== '' && lon.trim() !== '' && Number.isFinite(la) && Number.isFinite(lo)) {
      setCenter({ lat: la, lon: lo, label: `${la}, ${lo}` });
    }
  }

  const query = useQuery({
    queryKey: ['search', submitted],
    enabled: submitted !== null,
    queryFn: async () => {
      const s = submitted as Submitted;
      const at = s.center ? { lat: s.center.lat, lon: s.center.lon, radius_miles: s.radius } : {};
      const base = (cursor: string | undefined) => ({ ...at, limit: 50, cursor });
      const workClass = s.repairsOnly ? { roof_work_class: [...REPLACEMENTS_AND_REPAIRS] } : {};
      if (s.mode === 'permits' || s.mode === 'text') {
        const fetchPermits = (cursor: string | undefined) =>
          s.mode === 'permits'
            ? api.searchPermits({
                ...base(cursor),
                status_group: ['open', 'stalled'],
                roofing_only: true,
                ...workClass,
              })
            : api.searchPermitText({ ...base(cursor), q: s.text });
        return { kind: 'permit' as const, ...(await pageWithRestart(fetchPermits, s.cursor)) };
      }
      const fetchProperties = (cursor: string | undefined) =>
        api.searchProperties({
          ...base(cursor),
          roof_age_min: s.mode === 'aging' ? s.roofAge : 0,
          open_permits: false,
          ...workClass,
          ...(s.mode === 'tenure' ? { owner_tenure_min: s.tenure } : {}),
          ...(s.mode === 'owners'
            ? s.owners === 'absentee'
              ? { absentee_owner: true }
              : { out_of_area_owner: true }
            : {}),
        });
      return { kind: 'property' as const, ...(await pageWithRestart(fetchProperties, s.cursor)) };
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted({
      mode,
      center,
      radius,
      roofAge,
      tenure,
      owners,
      text,
      repairsOnly,
      nonce: Date.now(),
    });
  }

  const result = query.data;
  const data = result?.page;
  const permits =
    result?.kind === 'permit'
      ? [...result.page.items].sort(
          (a, b) => (b.open_duration_days ?? -1) - (a.open_duration_days ?? -1),
        )
      : [];
  const points =
    result?.kind === 'property'
      ? result.page.items.flatMap((p) =>
          p.lat !== null && p.lon !== null ? [{ id: p.property_id, lat: p.lat, lon: p.lon }] : [],
        )
      : permits.flatMap((p) =>
          p.lat !== null && p.lon !== null ? [{ id: p.permit_id, lat: p.lat, lon: p.lon }] : [],
        );

  return (
    <Section title="Lead queries" step="7 and 8">
      <form onSubmit={submit} className="form">
        <fieldset>
          <legend>Question</legend>
          <select
            aria-label="Question"
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
          >
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {mode === 'aging' ? (
            <label>
              Roof older than (years){' '}
              <input
                type="number"
                min={0}
                value={roofAge}
                onChange={(e) => setRoofAge(Number(e.target.value))}
                aria-label="Roof age"
              />
            </label>
          ) : null}
          {mode === 'tenure' ? (
            <label>
              Owner tenure over (years){' '}
              <input
                type="number"
                min={0}
                value={tenure}
                onChange={(e) => setTenure(Number(e.target.value))}
                aria-label="Owner tenure"
              />
            </label>
          ) : null}
          {mode === 'owners' ? (
            <select
              aria-label="Owner kind"
              value={owners}
              onChange={(e) => setOwners(e.target.value as 'absentee' | 'out_of_area')}
            >
              <option value="absentee">Absentee owners</option>
              <option value="out_of_area">Out-of-area owners</option>
            </select>
          ) : null}
          {mode === 'text' ? (
            <input
              aria-label="Permit text"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          ) : (
            <label>
              <input
                type="checkbox"
                checked={repairsOnly}
                onChange={(e) => setRepairsOnly(e.target.checked)}
              />{' '}
              Replacements and repairs only (no accessory roofs or new construction)
            </label>
          )}
        </fieldset>

        <fieldset>
          <legend>Center</legend>
          <span className="inline">
            <input
              aria-label="Place"
              placeholder="City, alias or ZIP"
              value={placeText}
              onChange={(e) => setPlaceText(e.target.value)}
            />
            <button type="button" onClick={(e) => void findPlace(e)}>
              Find place
            </button>
          </span>
          {placeError ? <p className="error">{placeError}</p> : null}
          {centers.length > 0 ? (
            <ul className="centers">
              {centers.map((c) => (
                <li key={`${c.kind}-${c.name}`}>
                  <button
                    type="button"
                    onClick={() => setCenter({ lat: c.lat, lon: c.lon, label: c.name })}
                  >
                    {c.name}
                  </button>{' '}
                  <span className="muted">
                    {c.match_type} · {fmtInt(c.parcel_count)} parcels · {c.basis}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <span className="inline">
            <input
              aria-label="Latitude"
              placeholder="lat"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
            <input
              aria-label="Longitude"
              placeholder="lon"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
            />
            <button type="button" onClick={useTyped}>
              Use coordinates
            </button>
          </span>
          <p>
            Center:{' '}
            <strong data-testid="center">
              {center
                ? `${center.label} (${center.lat.toFixed(5)}, ${center.lon.toFixed(5)})`
                : 'none (county-wide)'}
            </strong>
            {center ? (
              <button type="button" onClick={() => setCenter(null)}>
                Clear
              </button>
            ) : null}
          </p>
          <label>
            Radius (miles){' '}
            <input
              type="number"
              min={0.1}
              max={25}
              step={0.1}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              aria-label="Radius"
            />
          </label>
        </fieldset>
        <button type="submit">Search</button>
      </form>

      {query.isFetching ? <Loading what="results" /> : null}
      {query.isError ? <ErrorBox error={query.error} /> : null}
      {result && data ? (
        <div data-testid="results">
          <p>
            <strong>{fmtInt(data.total)}</strong> match{data.total === 1 ? '' : 'es'}
            {data.area_note ? ` · ${data.area_note}` : ''}
            {result?.restarted ? ' · the cursor went stale, restarted from the first page' : ''}
          </p>
          <MapPlot center={center} radiusMiles={radius} points={points} />
          {result.kind === 'property'
            ? result.page.items.map((p) => <PropertyCard key={p.property_id} property={p} />)
            : permits.map((p) => <PermitCard key={p.permit_id} permit={p} />)}
          {data.next_cursor ? (
            <button
              type="button"
              onClick={() =>
                submitted && setSubmitted({ ...submitted, cursor: data.next_cursor ?? undefined })
              }
            >
              Next page
            </button>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}
