import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import type { FileDownloader } from "../application/ports.js";
import type { FetchReceipt } from "../domain/fetch-receipt.js";
import { SourceRequestError } from "./source-request-error.js";

export interface HttpFileDownloaderConfig {
  userAgent: string;
  fetch: typeof fetch;
  now: () => Date;
}

export class HttpFileDownloader implements FileDownloader {
  constructor(private readonly config: HttpFileDownloaderConfig) {}

  async download(url: string, destination: string): Promise<FetchReceipt> {
    const fetchedAt = this.config.now().toISOString();
    const response = await this.config.fetch(url, {
      headers: { "user-agent": this.config.userAgent },
    });
    if (!response.ok || response.body === null) {
      await response.body?.cancel();
      throw new SourceRequestError(url, response.status);
    }

    await mkdir(dirname(destination), { recursive: true });
    const hash = createHash("sha256");
    let bytes = 0;
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      async function* digest(chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          hash.update(chunk);
          bytes += chunk.length;
          yield chunk;
        }
      },
      createWriteStream(destination),
    );

    return { url, fetchedAt, httpStatus: response.status, bytes, sha256: hash.digest("hex") };
  }
}
