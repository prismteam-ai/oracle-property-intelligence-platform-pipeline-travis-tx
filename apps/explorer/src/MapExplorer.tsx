import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent, MapMouseEvent } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { callTool, fmt, type Row } from "./api.js";

type Center = { latitude: number; longitude: number; radiusMiles: number; resolvedFrom: string };
type Result = { center: Center; stats: Row; results: Row[]; method: string };

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const AUSTIN = { latitude: 30.2672, longitude: -97.7431 };

function circle(lat: number, lon: number, miles: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([
      lon + (miles / (69 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a),
      lat + (miles / 69) * Math.sin(a),
    ]);
  }
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [pts] },
  };
}

export function MapExplorer() {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [center, setCenter] = useState(AUSTIN);
  const [radius, setRadius] = useState(2);
  const [minAge, setMinAge] = useState(15);
  const [minOpenYears, setMinOpenYears] = useState(0);
  const [mode, setMode] = useState<"roofs" | "permits">("roofs");
  const [place, setPlace] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapEl.current || map.current) return;
    const m = new maplibregl.Map({
      container: mapEl.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [AUSTIN.longitude, AUSTIN.latitude],
      zoom: 11,
    });
    m.addControl(new maplibregl.NavigationControl(), "top-right");
    m.on("load", () => {
      m.addSource("radius", {
        type: "geojson",
        data: circle(AUSTIN.latitude, AUSTIN.longitude, 2),
      });
      m.addLayer({
        id: "radius",
        type: "line",
        source: "radius",
        paint: { "line-color": "#2563eb", "line-width": 2 },
      });
      m.addSource("hits", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "hits",
        type: "circle",
        source: "hits",
        paint: {
          "circle-radius": 5,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1,
        },
      });
      m.on("click", "hits", (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (f?.properties?.prop_id) void openProperty(String(f.properties.prop_id));
      });
    });
    m.on("click", (e: MapMouseEvent) => {
      if (m.queryRenderedFeatures(e.point, { layers: ["hits"] }).length) return;
      setCenter({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
    });
    map.current = m;
  }, []);

  useEffect(() => {
    const src = map.current?.getSource("radius") as GeoJSONSource | undefined;
    src?.setData(circle(center.latitude, center.longitude, radius));
  }, [center, radius]);

  async function search() {
    setBusy(true);
    setError(null);
    try {
      const base = place.trim()
        ? { place: place.trim(), radiusMiles: radius }
        : { ...center, radiusMiles: radius };
      const r =
        mode === "roofs"
          ? await callTool<Result>("find_aged_roof_properties", {
              ...base,
              minRoofAgeYears: minAge,
              limit: 200,
            })
          : await callTool<Result>("find_open_roofing_permits", {
              ...base,
              minOpenYears,
              includeExpiredWithoutFinal: false,
              limit: 200,
            });
      setResult(r);
      setCenter({ latitude: r.center.latitude, longitude: r.center.longitude });
      const features = r.results
        .filter((x) => x.latitude !== null && x.longitude !== null)
        .map((x) => ({
          type: "Feature" as const,
          properties: {
            prop_id: x.prop_id ?? null,
            color: mode === "roofs" ? "#dc2626" : "#d97706",
          },
          geometry: {
            type: "Point" as const,
            coordinates: [Number(x.longitude), Number(x.latitude)],
          },
        }));
      (map.current?.getSource("hits") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features,
      });
      map.current?.flyTo({
        center: [r.center.longitude, r.center.latitude],
        zoom: radius > 4 ? 11 : 13,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openProperty(propId: string) {
    try {
      setDetail(await callTool<Row>("get_property", { propId }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function useGps() {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPlace("");
        setCenter({ latitude: p.coords.latitude, longitude: p.coords.longitude });
      },
      (e) => setError(`GPS unavailable: ${e.message}`),
    );
  }

  const property = detail?.property as Row | undefined;
  const roofing = (detail?.roofingPermits as Row[] | undefined) ?? [];

  return (
    <div className="map-layout">
      <aside className="panel">
        <div className="seg">
          <button className={mode === "roofs" ? "active" : ""} onClick={() => setMode("roofs")}>
            Aged roofs
          </button>
          <button className={mode === "permits" ? "active" : ""} onClick={() => setMode("permits")}>
            Open roofing permits
          </button>
        </div>
        <label>
          Place (optional)
          <input
            value={place}
            placeholder="e.g. Pflugerville"
            onChange={(e) => setPlace(e.target.value)}
          />
        </label>
        <div className="muted small">
          Or click the map to drop a pin, or{" "}
          <button className="link" onClick={useGps}>
            use my GPS
          </button>
          .<br />
          Center: {center.latitude.toFixed(5)}, {center.longitude.toFixed(5)}
        </div>
        <label>
          Radius: {radius} mi
          <input
            type="range"
            min={0.25}
            max={10}
            step={0.25}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          />
        </label>
        {mode === "roofs" ? (
          <label>
            Roof age ≥ {minAge} years
            <input
              type="range"
              min={0}
              max={60}
              value={minAge}
              onChange={(e) => setMinAge(Number(e.target.value))}
            />
          </label>
        ) : (
          <label>
            Open ≥ {minOpenYears} years
            <input
              type="range"
              min={0}
              max={30}
              step={0.5}
              value={minOpenYears}
              onChange={(e) => setMinOpenYears(Number(e.target.value))}
            />
          </label>
        )}
        <button className="primary" disabled={busy} onClick={search}>
          {busy ? "Searching…" : "Search"}
        </button>
        {error && <p className="error">{error}</p>}
        {result && (
          <div className="stack small">
            <div className="muted">{result.center.resolvedFrom}</div>
            <div className="kv">
              {Object.entries(result.stats).map(([k, v]) => (
                <span key={k} className="contents">
                  <span>{k.replaceAll("_", " ")}</span>
                  <b>{fmt(v)}</b>
                </span>
              ))}
            </div>
            <p className="muted">{result.method}</p>
            <ul className="results">
              {result.results.map((r) => (
                <li
                  key={String(r.permit_number ?? r.prop_id)}
                  onClick={() => r.prop_id && openProperty(String(r.prop_id))}
                >
                  {mode === "roofs" ? (
                    <>
                      <b>{fmt(r.situs_address)}</b>
                      <span>
                        Roof {String(r.roof_year ?? "—")} · {fmt(r.roof_age_years)} yrs ·{" "}
                        {fmt(r.roof_age_basis)} ({fmt(r.roof_evidence_permit_number)})
                      </span>
                      <span>
                        {fmt(r.owner_name)} · {fmt(r.owner_location_class)} ·{" "}
                        {fmt(r.distance_miles)} mi
                      </span>
                    </>
                  ) : (
                    <>
                      <b>
                        {fmt(r.permit_number)} · {fmt(r.status)} ·{" "}
                        {Math.round((Number(r.open_days ?? 0) / 365.25) * 10) / 10} yrs open
                      </b>
                      <span>
                        {fmt(r.address)} · {fmt(r.distance_miles)} mi
                      </span>
                      <span>
                        Contractor: {fmt(r.contractor_name ?? r.contractor_company_name)} · BBB:{" "}
                        {r.contractor_bbb_rating ? fmt(r.contractor_bbb_rating) : "not available"}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
      <div className="map" ref={mapEl} />
      {property && (
        <aside className="panel detail">
          <button className="close" onClick={() => setDetail(null)}>
            ×
          </button>
          <h3>{fmt(property.situs_address)}</h3>
          <div className="kv small">
            <span>prop_id</span>
            <b className="mono">{fmt(property.prop_id)}</b>
            <span>Owner</span>
            <b>{fmt(property.owner_name)}</b>
            <span>Mailing</span>
            <b>
              {fmt(property.mail_address)} ({fmt(property.owner_location_class)})
            </b>
            <span>Roof year</span>
            <b>
              {String(property.roof_year ?? "—")} ({fmt(property.roof_age_basis)},{" "}
              {fmt(property.roof_age_confidence)})
            </b>
            <span>Evidence</span>
            <b className="mono">{fmt(property.roof_evidence_permit_number)}</b>
            <span>Market value</span>
            <b>{fmt(property.market_value)}</b>
            <span>Coordinates</span>
            <b>
              {fmt(property.latitude)}, {fmt(property.longitude)}
            </b>
            <span>Source</span>
            <b className="wrap">
              <a href={String(property.parcel_source_url)} target="_blank" rel="noreferrer">
                {fmt(property.parcel_source_id)}
              </a>{" "}
              · {fmt(property.parcel_collected_at)}
            </b>
            <span>Run</span>
            <b className="mono">
              first {fmt(property.first_seen_run)} · changed {fmt(property.last_changed_run)}
            </b>
          </div>
          <h4>Roofing permits ({roofing.length})</h4>
          <ul className="results">
            {roofing.map((p) => (
              <li key={String(p.permit_number)}>
                <b>
                  <a href={String(p.permit_link ?? p.source_url)} target="_blank" rel="noreferrer">
                    {fmt(p.permit_number)}
                  </a>{" "}
                  · {fmt(p.status)}
                  {p.is_open ? ` · open ${fmt(p.open_days)} days` : ""}
                </b>
                <span>
                  {fmt(p.issued_date)} → {fmt(p.completed_date)}
                </span>
                <span>{fmt(p.description)}</span>
                <span>
                  Contractor: {fmt(p.contractor_name ?? p.contractor_company_name)} · BBB:{" "}
                  {p.contractor_bbb_rating ? fmt(p.contractor_bbb_rating) : "not available"}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
