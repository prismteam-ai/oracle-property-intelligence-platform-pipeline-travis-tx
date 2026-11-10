import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import type { PinningService, PinRequest } from "../application/publication-ports.js";
import { PinningProvider } from "../domain/artifact-manifest.js";
import { ServiceRequestError } from "./service-request-error.js";

const SERVICE = "Pinata";
const UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
const PUBLIC_FILES_URL = "https://api.pinata.cloud/v3/files/public";
const PUBLIC_NETWORK = "public";
const LIST_LIMIT = "100";

export interface PinataPinningConfig {
  jwt: string;
  fetch: typeof fetch;
  retainPublications: number;
}

interface UploadResponse {
  data?: { id?: string; cid?: string };
}

interface ListResponse {
  data?: { files?: { id: string; name: string }[] };
}

export class PinataPinning implements PinningService {
  readonly provider = PinningProvider.Pinata;
  readonly retainPublications: number;

  constructor(private readonly config: PinataPinningConfig) {
    this.retainPublications = config.retainPublications;
  }

  async pin({ label, files, asDirectory }: PinRequest): Promise<string> {
    const form = new FormData();
    form.append("network", PUBLIC_NETWORK);
    form.append("name", label);
    for (const file of files) {
      const uploadName = asDirectory ? `${label}/${file.name}` : basename(file.name);
      form.append("file", await openAsBlob(file.path), uploadName);
    }

    const response = await this.config.fetch(UPLOAD_URL, {
      method: "POST",
      headers: this.authorization(),
      body: form,
    });
    const body = (await response.json()) as UploadResponse;
    if (!response.ok || !body.data?.cid) {
      throw new ServiceRequestError(SERVICE, UPLOAD_URL, response.status, JSON.stringify(body));
    }
    return body.data.cid;
  }

  async unpin(label: string): Promise<void> {
    const listUrl = `${PUBLIC_FILES_URL}?${new URLSearchParams({ name: label, limit: LIST_LIMIT })}`;
    const listed = await this.config.fetch(listUrl, { headers: this.authorization() });
    if (!listed.ok) throw new ServiceRequestError(SERVICE, listUrl, listed.status);

    const files = ((await listed.json()) as ListResponse).data?.files ?? [];
    for (const file of files.filter((candidate) => candidate.name === label)) {
      const url = `${PUBLIC_FILES_URL}/${file.id}`;
      const deleted = await this.config.fetch(url, {
        method: "DELETE",
        headers: this.authorization(),
      });
      if (!deleted.ok) throw new ServiceRequestError(SERVICE, url, deleted.status);
    }
  }

  private authorization(): Record<string, string> {
    return { authorization: `Bearer ${this.config.jwt}` };
  }
}
