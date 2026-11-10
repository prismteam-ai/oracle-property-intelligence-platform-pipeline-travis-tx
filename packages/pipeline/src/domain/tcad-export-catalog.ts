export interface TcadExportFile {
  url: string;
  year: number;
  supplement: number;
}

const ARCHIVE_EXTENSION = ".zip";
const EXPORT_MARKER = /export/i;
const OTHER_EXPORT_KINDS = /json|special|layout/i;
const SUPPLEMENT_NUMBER = /supp\s*(\d+)/i;
const APPRAISAL_YEAR = /(?<!\d)(20\d{2})(?!\d)/;
const SUPPLEMENT_KEY_WIDTH = 4;

export function latestSupplementExport(links: readonly string[]): TcadExportFile | undefined {
  return links
    .map(parseExportLink)
    .filter((file): file is TcadExportFile => file !== undefined)
    .reduce<TcadExportFile | undefined>(
      (latest, file) =>
        latest === undefined || exportKey(file) > exportKey(latest) ? file : latest,
      undefined,
    );
}

export function exportKey({ year, supplement }: TcadExportFile): string {
  return `${year}-supp-${String(supplement).padStart(SUPPLEMENT_KEY_WIDTH, "0")}`;
}

export function exportFileName({ url }: TcadExportFile): string {
  return decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "");
}

function parseExportLink(url: string): TcadExportFile | undefined {
  const name = exportFileName({ url, year: 0, supplement: 0 });
  if (!name.toLowerCase().endsWith(ARCHIVE_EXTENSION)) return undefined;
  if (!EXPORT_MARKER.test(name) || OTHER_EXPORT_KINDS.test(name)) return undefined;

  const supplement = SUPPLEMENT_NUMBER.exec(name)?.[1];
  const year = APPRAISAL_YEAR.exec(name)?.[1];
  if (supplement === undefined || year === undefined) return undefined;
  return { url, year: Number(year), supplement: Number(supplement) };
}
