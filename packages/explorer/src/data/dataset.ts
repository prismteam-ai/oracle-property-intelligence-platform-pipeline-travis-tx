import type {
  BuildSummary,
  Coverage,
  Manifest,
  Publication,
  RunHistory,
  SourceDescription,
} from "./types.js";

export interface Dataset {
  publication: Publication;
  publications: Publication[];
  manifest: Manifest;
  build: BuildSummary;
  coverage: Coverage;
  runs: RunHistory | undefined;
  sources: SourceDescription[] | undefined;
  tableUrl(table: string): string;
}

const PUBLICATIONS_PATH = "/api/publications";
const NOT_FOUND = 404;

export async function loadDataset(fetchImpl: typeof fetch, origin: string): Promise<Dataset> {
  const getJson = async <T>(path: string): Promise<T | undefined> => {
    const response = await fetchImpl(new URL(path, origin));
    if (response.status === NOT_FOUND) return undefined;
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    return (await response.json()) as T;
  };
  const required = async <T>(path: string): Promise<T> => {
    const value = await getJson<T>(path);
    if (value === undefined) throw new Error(`${path} is missing`);
    return value;
  };

  const publications = [...((await getJson<Publication[]>(PUBLICATIONS_PATH)) ?? [])].sort((a, b) =>
    a.buildId.localeCompare(b.buildId),
  );
  const publication = publications.at(-1);
  if (!publication) throw new Error("There is no publication yet.");

  const file = (name: string) => `/ipfs/${publication.rootCid}/${name}`;
  const [manifest, build, coverage, runs, sources] = await Promise.all([
    required<Manifest>(`/ipfs/${publication.manifestCid}`),
    required<BuildSummary>(file("build.json")),
    required<Coverage>(file("coverage.json")),
    getJson<RunHistory>(file("runs.json")),
    getJson<SourceDescription[]>(file("sources.json")),
  ]);

  return {
    publication,
    publications,
    manifest,
    build,
    coverage,
    runs,
    sources,
    tableUrl: (table) => new URL(file(`tables/${table}.parquet`), origin).toString(),
  };
}
