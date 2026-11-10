import { PLACES, PLACES_SOURCE, type Place } from "./places.js";
import { ZIP_CODE_KIND, ZIP_CODES, ZIP_CODES_SOURCE } from "./zip-codes.js";

const SUGGESTION_COUNT = 12;
const ZIP_CODE = /^\d{5}$/;

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export function findPlace(name: string): Place {
  const wanted = name.trim().toLowerCase();
  if (ZIP_CODE.test(wanted)) return findZipCode(wanted);
  const byName = (predicate: (candidate: string) => boolean) =>
    PLACES.filter((place) => predicate(place.name.toLowerCase())).sort(
      (a, b) => a.name.length - b.name.length,
    )[0];

  const place =
    byName((candidate) => candidate === wanted) ??
    byName((candidate) => candidate.startsWith(wanted)) ??
    byName((candidate) => candidate.includes(wanted));
  if (place) return place;

  const suggestions = PLACES.map((known) => known.name).slice(0, SUGGESTION_COUNT);
  throw new ToolInputError(
    `Unknown place "${name}". Known places include: ${suggestions.join(", ")}.`,
  );
}

export function sourceOf(place: Place): string {
  return place.kind === ZIP_CODE_KIND ? ZIP_CODES_SOURCE : PLACES_SOURCE;
}

function findZipCode(zip: string): Place {
  const found = ZIP_CODES.find((candidate) => candidate.name === zip);
  if (found) return found;
  const suggestions = ZIP_CODES.map((known) => known.name).slice(0, SUGGESTION_COUNT);
  throw new ToolInputError(
    `Unknown ZIP code "${zip}". Travis County ZIP codes include: ${suggestions.join(", ")}.`,
  );
}
