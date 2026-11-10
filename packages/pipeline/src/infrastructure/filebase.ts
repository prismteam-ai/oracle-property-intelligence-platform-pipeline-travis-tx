import { readFile } from "node:fs/promises";
import { AwsClient } from "aws4fetch";
import type { NameService, PinningService, PinRequest } from "../application/publication-ports.js";
import { PinningProvider } from "../domain/artifact-manifest.js";
import { ServiceRequestError } from "./service-request-error.js";

const SERVICE = "Filebase";
const S3_ENDPOINT = "https://s3.filebase.com";
const S3_REGION = "us-east-1";
const NAMES_URL = "https://api.filebase.io/v1/names";
const IMPORT_METADATA = "x-amz-meta-import";
const CAR_IMPORT = "car";
const CID_METADATA = "x-amz-meta-cid";
const CAR_EXTENSION = ".car";
const NOT_FOUND = 404;

interface FilebaseCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface FilebasePinningConfig extends FilebaseCredentials {
  bucket: string;
  fetch: typeof fetch;
  retainPublications: number;
}

export class FilebasePinning implements PinningService {
  readonly provider = PinningProvider.Filebase;
  readonly retainPublications: number;
  private readonly signer: AwsClient;

  constructor(private readonly config: FilebasePinningConfig) {
    this.retainPublications = config.retainPublications;
    this.signer = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: S3_REGION,
    });
  }

  async pin({ label, carPath }: PinRequest): Promise<string> {
    const url = this.objectUrl(label);
    const request = await this.signer.sign(url, {
      method: "PUT",
      body: await readFile(carPath),
      headers: { [IMPORT_METADATA]: CAR_IMPORT },
    });
    const response = await this.config.fetch(request);
    const cid = response.headers.get(CID_METADATA);
    if (!response.ok || !cid) {
      throw new ServiceRequestError(SERVICE, url, response.status, await response.text());
    }
    return cid;
  }

  async unpin(label: string): Promise<void> {
    const url = this.objectUrl(label);
    const response = await this.config.fetch(await this.signer.sign(url, { method: "DELETE" }));
    if (!response.ok && response.status !== NOT_FOUND) {
      throw new ServiceRequestError(SERVICE, url, response.status);
    }
  }

  private objectUrl(label: string): string {
    return `${S3_ENDPOINT}/${this.config.bucket}/${label}${CAR_EXTENSION}`;
  }
}

export interface FilebaseNamesConfig extends FilebaseCredentials {
  label: string;
  fetch: typeof fetch;
}

interface NameRecord {
  network_key?: string;
  cid?: string;
}

export class FilebaseNames implements NameService {
  constructor(private readonly config: FilebaseNamesConfig) {}

  async publish(cid: string): Promise<{ name: string; resolvedCid: string }> {
    const { label } = this.config;
    const updated = await this.call(`${NAMES_URL}/${label}`, "PUT", { cid });
    const response =
      updated.status === NOT_FOUND ? await this.call(NAMES_URL, "POST", { label, cid }) : updated;
    if (!response.ok) throw new ServiceRequestError(SERVICE, NAMES_URL, response.status);

    const record =
      withNetworkKey(await response.text()) ??
      withNetworkKey(await (await this.call(`${NAMES_URL}/${label}`, "GET")).text());
    if (!record?.network_key)
      throw new Error(`${SERVICE} did not report the IPNS name for ${label}`);
    return { name: record.network_key, resolvedCid: record.cid ?? cid };
  }

  private call(url: string, method: string, body?: unknown): Promise<Response> {
    const token = Buffer.from(`${this.config.accessKeyId}:${this.config.secretAccessKey}`).toString(
      "base64",
    );
    return this.config.fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }
}

function withNetworkKey(text: string): NameRecord | undefined {
  if (!text) return undefined;
  const record = JSON.parse(text) as NameRecord;
  return record.network_key ? record : undefined;
}
