const DETAILS_FILE = /StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d{4})(\d{2})(\d{2})\.csv\.gz/g;

export const FIRST_HAIL_YEAR = 2000;
export const DAMAGING_HAIL_INCHES = 1;

export interface StormEventFile {
  year: number;
  createdOn: string;
  name: string;
}

export function latestStormEventFiles(listing: string, firstYear: number): StormEventFile[] {
  const latest = new Map<number, StormEventFile>();
  for (const [name, year, createdYear, createdMonth, createdDay] of listing.matchAll(
    DETAILS_FILE,
  )) {
    const file = {
      year: Number(year),
      createdOn: `${createdYear}-${createdMonth}-${createdDay}`,
      name,
    };
    const known = latest.get(file.year);
    if (file.year >= firstYear && (!known || known.createdOn < file.createdOn)) {
      latest.set(file.year, file);
    }
  }
  return [...latest.values()].sort((a, b) => a.year - b.year);
}
