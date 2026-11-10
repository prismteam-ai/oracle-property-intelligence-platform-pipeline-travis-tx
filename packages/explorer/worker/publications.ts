export interface Publication {
  buildId: string;
  publishedAt: string;
  manifestCid: string;
  rootCid: string;
  ipns: { name: string; resolvedCid: string };
}

export interface PublicationIndexConfig {
  read: () => Promise<string | null>;
  now: () => number;
  refreshMs: number;
}

export class PublicationIndex {
  private cached: { at: number; publications: Publication[] } | undefined;

  constructor(private readonly config: PublicationIndexConfig) {}

  async list(): Promise<Publication[]> {
    const now = this.config.now();
    if (this.cached && now - this.cached.at < this.config.refreshMs) {
      return this.cached.publications;
    }
    const text = await this.config.read();
    const publications = text ? (JSON.parse(text) as Publication[]) : [];
    this.cached = { at: now, publications };
    return publications;
  }
}

const RECORD_PATH = /^\/api\/publications\/(\d{8}T\d{6}Z)$/;
const RECORD_DIR = "publications";
const RECORD_EXTENSION = ".json";

export function publicationRecordKey(pathname: string): string | undefined {
  const buildId = RECORD_PATH.exec(pathname)?.[1];
  return buildId && `${RECORD_DIR}/${buildId}${RECORD_EXTENSION}`;
}
