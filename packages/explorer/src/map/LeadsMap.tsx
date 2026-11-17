import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection } from "geojson";
import {
  type GeoJSONSource,
  Map as MapLibreMap,
  type MapMouseEvent,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef } from "react";

export interface MapPoint {
  latitude: number;
  longitude: number;
  label: string;
}

export interface MapCenter {
  latitude: number;
  longitude: number;
}

setWorkerUrl(mapWorkerUrl);

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const TRAVIS_COUNTY_CENTER: [number, number] = [-97.7431, 30.3];
const INITIAL_ZOOM = 9.5;
const CIRCLE_STEPS = 72;
const MILES_PER_DEGREE = 69;
const FIT_PADDING = 40;
const FULL_TURN = 2 * Math.PI;
const LEAD_COLOR = "#d9480f";
const SELECTED_COLOR = "#1c7ed6";
const RADIUS_COLOR = "#1c7ed6";

enum Layer {
  RadiusFill = "radius-fill",
  RadiusLine = "radius-line",
  Leads = "leads",
  Selected = "selected",
  Center = "center",
}

enum Source {
  Radius = "radius",
  Leads = "leads",
  Center = "center",
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export function LeadsMap({
  center,
  radiusMiles,
  points,
  selected,
  onPick,
  onSelect,
}: {
  center: MapCenter;
  radiusMiles: number;
  points: MapPoint[];
  selected: number | undefined;
  onPick: (center: MapCenter) => void;
  onSelect: (index: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | undefined>(undefined);
  const ready = useRef(false);
  const handlers = useRef({ onPick, onSelect });
  handlers.current = { onPick, onSelect };
  const latest = useRef({ center, radiusMiles, points, selected });
  latest.current = { center, radiusMiles, points, selected };

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({
      container: container.current,
      style: STYLE_URL,
      center: TRAVIS_COUNTY_CENTER,
      zoom: INITIAL_ZOOM,
    });
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    instance.on("load", () => {
      instance.addSource(Source.Radius, { type: "geojson", data: EMPTY });
      instance.addSource(Source.Leads, { type: "geojson", data: EMPTY });
      instance.addSource(Source.Center, { type: "geojson", data: EMPTY });
      instance.addLayer({
        id: Layer.RadiusFill,
        type: "fill",
        source: Source.Radius,
        paint: { "fill-color": RADIUS_COLOR, "fill-opacity": 0.06 },
      });
      instance.addLayer({
        id: Layer.RadiusLine,
        type: "line",
        source: Source.Radius,
        paint: { "line-color": RADIUS_COLOR, "line-width": 2, "line-dasharray": [2, 2] },
      });
      instance.addLayer({
        id: Layer.Leads,
        type: "circle",
        source: Source.Leads,
        paint: {
          "circle-radius": 5,
          "circle-color": LEAD_COLOR,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1,
          "circle-opacity": 0.85,
        },
      });
      instance.addLayer({
        id: Layer.Selected,
        type: "circle",
        source: Source.Leads,
        filter: ["==", ["get", "index"], -1],
        paint: {
          "circle-radius": 9,
          "circle-color": SELECTED_COLOR,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
      instance.addLayer({
        id: Layer.Center,
        type: "circle",
        source: Source.Center,
        paint: {
          "circle-radius": 7,
          "circle-color": "#111",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 3,
        },
      });
      ready.current = true;
      draw(instance, latest.current, true);
    });
    instance.on("click", (event: MapMouseEvent) => {
      const [lead] = instance.queryRenderedFeatures(event.point, { layers: [Layer.Leads] });
      const index = lead?.properties?.index;
      if (typeof index === "number") handlers.current.onSelect(index);
      else handlers.current.onPick({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    });
    instance.on("mouseenter", Layer.Leads, () => {
      instance.getCanvas().style.cursor = "pointer";
    });
    instance.on("mouseleave", Layer.Leads, () => {
      instance.getCanvas().style.cursor = "";
    });
    map.current = instance;
    return () => instance.remove();
  }, []);

  useEffect(() => {
    if (map.current && ready.current)
      draw(map.current, { center, radiusMiles, points, selected }, false);
  }, [center, radiusMiles, points, selected]);

  useEffect(() => {
    if (map.current && ready.current) fit(map.current, center, radiusMiles);
  }, [center, radiusMiles]);

  return <div ref={container} className="map" />;
}

function draw(
  instance: MapLibreMap,
  {
    center,
    radiusMiles,
    points,
    selected,
  }: { center: MapCenter; radiusMiles: number; points: MapPoint[]; selected: number | undefined },
  fitView: boolean,
) {
  (instance.getSource(Source.Radius) as GeoJSONSource).setData(circle(center, radiusMiles));
  (instance.getSource(Source.Center) as GeoJSONSource).setData({
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [center.longitude, center.latitude] },
  });
  (instance.getSource(Source.Leads) as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: points.map((point, index) => ({
      type: "Feature",
      properties: { index, label: point.label },
      geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
    })),
  });
  instance.setFilter(Layer.Selected, ["==", ["get", "index"], selected ?? -1]);
  if (fitView) fit(instance, center, radiusMiles);
}

function fit(instance: MapLibreMap, center: MapCenter, radiusMiles: number) {
  const latitudeSpan = radiusMiles / MILES_PER_DEGREE;
  const longitudeSpan = latitudeSpan / Math.cos((center.latitude * Math.PI) / 180);
  instance.fitBounds(
    [
      [center.longitude - longitudeSpan, center.latitude - latitudeSpan],
      [center.longitude + longitudeSpan, center.latitude + latitudeSpan],
    ],
    { padding: FIT_PADDING, duration: 600 },
  );
}

function circle(center: MapCenter, radiusMiles: number): Feature {
  const latitudeSpan = radiusMiles / MILES_PER_DEGREE;
  const longitudeSpan = latitudeSpan / Math.cos((center.latitude * Math.PI) / 180);
  const ring = Array.from({ length: CIRCLE_STEPS + 1 }, (_, step) => {
    const angle = (step / CIRCLE_STEPS) * FULL_TURN;
    return [
      center.longitude + longitudeSpan * Math.cos(angle),
      center.latitude + latitudeSpan * Math.sin(angle),
    ];
  });
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}
