import { createHash } from "node:crypto";
import type { FetchedPage, SnapshotLayer } from "../application/ports.js";
import type { SourceId } from "../domain/source-id.js";
import { SourceRequestError } from "./source-request-error.js";

export enum FeatureGeometry {
  Centroid = "centroid",
  Point = "point",
}

const WGS84 = "4326";
const FIRST_OBJECT_ID = "0";

interface ArcGisFeature {
  attributes: Record<string, unknown>;
}

interface ArcGisQueryResponse {
  features?: ArcGisFeature[];
  exceededTransferLimit?: boolean;
  error?: { code?: number; message?: string };
}

interface ArcGisLayerInfo {
  editingInfo?: { lastEditDate?: number; dataLastEditDate?: number };
  error?: { code?: number };
}

export interface ArcGisFeatureLayerConfig {
  id: SourceId;
  geometry: FeatureGeometry;
  layerUrl: string;
  objectIdField: string;
  outFields: readonly string[];
  pageSize: number;
  userAgent: string;
  fetch: typeof fetch;
  now: () => Date;
}

export class ArcGisFeatureLayer implements SnapshotLayer {
  readonly id: SourceId;

  constructor(private readonly config: ArcGisFeatureLayerConfig) {
    this.id = config.id;
  }

  async version(): Promise<string> {
    const url = new URL(this.config.layerUrl);
    url.searchParams.set("f", "json");
    const { json, status } = await this.getJson<ArcGisLayerInfo>(url);
    const lastEdit = json.editingInfo?.dataLastEditDate ?? json.editingInfo?.lastEditDate;
    if (json.error || lastEdit === undefined) throw new SourceRequestError(url.toString(), status);
    return new Date(lastEdit).toISOString();
  }

  async fetchPage(afterKey: string | undefined): Promise<FetchedPage> {
    const { objectIdField, outFields, pageSize } = this.config;
    const url = new URL(`${this.config.layerUrl}/query`);
    url.searchParams.set("where", `${objectIdField} > ${afterKey ?? FIRST_OBJECT_ID}`);
    url.searchParams.set("outFields", outFields.join(","));
    const asCentroid = this.config.geometry === FeatureGeometry.Centroid;
    url.searchParams.set("returnGeometry", String(!asCentroid));
    if (asCentroid) url.searchParams.set("returnCentroid", "true");
    url.searchParams.set("outSR", WGS84);
    url.searchParams.set("orderByFields", objectIdField);
    url.searchParams.set("resultRecordCount", String(pageSize));
    url.searchParams.set("f", "json");

    const { body, json, status } = await this.getJson<ArcGisQueryResponse>(url);
    if (json.error) throw new SourceRequestError(url.toString(), json.error.code ?? status);

    const features = json.features ?? [];
    const lastObjectId = features.at(-1)?.attributes[objectIdField];
    return {
      body,
      recordCount: features.length,
      lastKey: lastObjectId === undefined ? undefined : String(lastObjectId),
      maxBusinessDate: undefined,
      isLastPage: json.exceededTransferLimit !== true,
      receipt: {
        url: url.toString(),
        fetchedAt: this.config.now().toISOString(),
        httpStatus: status,
        bytes: Buffer.byteLength(body),
        sha256: createHash("sha256").update(body).digest("hex"),
      },
    };
  }

  private async getJson<T>(url: URL): Promise<{ body: string; json: T; status: number }> {
    const response = await this.config.fetch(url, {
      headers: { "user-agent": this.config.userAgent, accept: "application/json" },
    });
    const body = await response.text();
    if (!response.ok) throw new SourceRequestError(url.toString(), response.status);
    return { body, json: JSON.parse(body) as T, status: response.status };
  }
}
