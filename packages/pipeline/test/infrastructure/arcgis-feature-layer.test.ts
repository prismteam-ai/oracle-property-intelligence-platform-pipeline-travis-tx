import { describe, expect, it } from "vitest";
import { SourceId } from "../../src/domain/source-id.js";
import {
  ArcGisFeatureLayer,
  FeatureGeometry,
} from "../../src/infrastructure/arcgis-feature-layer.js";
import { SourceRequestError } from "../../src/infrastructure/source-request-error.js";

const LAYER_URL =
  "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/EXTERNAL_tcad_parcel/FeatureServer/0";

function layerAnswering(body: unknown, status = 200, geometry = FeatureGeometry.Centroid) {
  const urls: URL[] = [];
  const layer = new ArcGisFeatureLayer({
    id: SourceId.TcadParcels,
    geometry,
    layerUrl: LAYER_URL,
    objectIdField: "OBJECTID_1",
    outFields: ["OBJECTID_1", "PROP_ID", "PID_10"],
    pageSize: 2,
    userAgent: "travis-oracle-pipeline/test",
    fetch: async (input) => {
      urls.push(new URL(String(input)));
      return new Response(JSON.stringify(body), { status });
    },
    now: () => new Date("2026-10-27T11:00:00.000Z"),
  });
  return { layer, urls };
}

const twoParcels = {
  features: [
    { attributes: { OBJECTID_1: 1, PROP_ID: 176276 }, centroid: { x: -97.8, y: 30.4 } },
    { attributes: { OBJECTID_1: 2, PROP_ID: 424651 }, centroid: { x: -97.7, y: 30.3 } },
  ],
  exceededTransferLimit: true,
};

describe("ArcGisFeatureLayer", () => {
  it("is the source it was configured as", () => {
    expect(layerAnswering({}).layer.id).toBe(SourceId.TcadParcels);
  });

  it("uses the layer's last edit time as its version", async () => {
    const { layer, urls } = layerAnswering({ editingInfo: { lastEditDate: 1791161681225 } });

    expect(await layer.version()).toBe(new Date(1791161681225).toISOString());
    expect(urls[0]?.searchParams.get("f")).toBe("json");
  });

  it("asks for WGS84 centroids without geometry, ordered and continued by object id", async () => {
    const { layer, urls } = layerAnswering(twoParcels);

    await layer.fetchPage("2000");

    const query = urls[0];
    expect(query?.pathname.endsWith("/FeatureServer/0/query")).toBe(true);
    expect(Object.fromEntries(query?.searchParams ?? [])).toEqual({
      where: "OBJECTID_1 > 2000",
      outFields: "OBJECTID_1,PROP_ID,PID_10",
      returnGeometry: "false",
      returnCentroid: "true",
      outSR: "4326",
      orderByFields: "OBJECTID_1",
      resultRecordCount: "2",
      f: "json",
    });
  });

  it("asks for WGS84 point geometry for a point layer", async () => {
    const { layer, urls } = layerAnswering(twoParcels, 200, FeatureGeometry.Point);

    await layer.fetchPage(undefined);

    expect(urls[0]?.searchParams.get("returnGeometry")).toBe("true");
    expect(urls[0]?.searchParams.has("returnCentroid")).toBe(false);
    expect(urls[0]?.searchParams.get("outSR")).toBe("4326");
  });

  it("starts from the first object on the first page", async () => {
    const { layer, urls } = layerAnswering(twoParcels);

    await layer.fetchPage(undefined);

    expect(urls[0]?.searchParams.get("where")).toBe("OBJECTID_1 > 0");
  });

  it("returns the page with its last object id and whether more pages follow", async () => {
    const { layer } = layerAnswering(twoParcels);

    const fetched = await layer.fetchPage(undefined);

    expect(fetched).toMatchObject({ recordCount: 2, lastKey: "2", isLastPage: false });
    expect(fetched.body).toBe(JSON.stringify(twoParcels));
  });

  it("treats a page without the transfer-limit flag as the last one", async () => {
    const { layer } = layerAnswering({ features: twoParcels.features.slice(0, 1) });

    expect((await layer.fetchPage(undefined)).isLastPage).toBe(true);
  });

  it("fails on the error object ArcGIS returns with HTTP 200", async () => {
    const { layer } = layerAnswering({ error: { code: 400, message: "Invalid query" } });

    await expect(layer.fetchPage(undefined)).rejects.toBeInstanceOf(SourceRequestError);
  });
});
