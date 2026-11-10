import type { ExportCatalog } from "../application/ports.js";
import { latestSupplementExport, type TcadExportFile } from "../domain/tcad-export-catalog.js";
import { SourceRequestError } from "./source-request-error.js";

const LINK_TARGET = /href\s*=\s*["']([^"']+)["']/gi;

export interface TcadExportCatalogPageConfig {
  pageUrl: string;
  userAgent: string;
  fetch: typeof fetch;
}

export class TcadExportCatalogPage implements ExportCatalog {
  constructor(private readonly config: TcadExportCatalogPageConfig) {}

  async latestExport(): Promise<TcadExportFile | undefined> {
    const response = await this.config.fetch(this.config.pageUrl, {
      headers: { "user-agent": this.config.userAgent },
    });
    const page = await response.text();
    if (!response.ok) throw new SourceRequestError(this.config.pageUrl, response.status);

    const links = [...page.matchAll(LINK_TARGET)].map(([, href]) =>
      new URL(href ?? "", this.config.pageUrl).toString(),
    );
    return latestSupplementExport(links);
  }
}
