const EARTH_RADIUS_MILES = 3958.8;
const MILES_PER_DEGREE_LATITUDE = 69.0;
const DEGREES_PER_HALF_TURN = 180;

export interface Center {
  name?: string;
  latitude: number;
  longitude: number;
}

export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function list(values: readonly string[]): string {
  return values.map(literal).join(", ");
}

export function distanceMiles(center: Center): string {
  return milesBetween("", {
    latitude: String(center.latitude),
    longitude: String(center.longitude),
  });
}

export function milesBetween(table: string, to: { latitude: string; longitude: string }): string {
  const radians = (degrees: string) => `radians(${degrees})`;
  const latitude = `${prefix(table)}latitude`;
  const longitude = `${prefix(table)}longitude`;
  return `${EARTH_RADIUS_MILES} * 2 * asin(sqrt(
    pow(sin((${radians(latitude)} - ${radians(to.latitude)}) / 2), 2) +
    cos(${radians(to.latitude)}) * cos(${radians(latitude)}) *
    pow(sin((${radians(longitude)} - ${radians(to.longitude)}) / 2), 2)))`;
}

export function withinBox(center: Center, radiusMiles: number, table = ""): string {
  const { latitudeSpan, longitudeSpan } = spans(center.latitude, radiusMiles);
  return `${prefix(table)}latitude BETWEEN ${center.latitude - latitudeSpan} AND ${center.latitude + latitudeSpan}
    AND ${prefix(table)}longitude BETWEEN ${center.longitude - longitudeSpan} AND ${center.longitude + longitudeSpan}`;
}

export function nearRow(
  table: string,
  row: string,
  radiusMiles: number,
  atLatitude: number,
): string {
  const { latitudeSpan, longitudeSpan } = spans(atLatitude, radiusMiles);
  return `${table}.latitude BETWEEN ${row}.latitude - ${latitudeSpan} AND ${row}.latitude + ${latitudeSpan}
    AND ${table}.longitude BETWEEN ${row}.longitude - ${longitudeSpan} AND ${row}.longitude + ${longitudeSpan}`;
}

function spans(latitude: number, radiusMiles: number) {
  return {
    latitudeSpan: radiusMiles / MILES_PER_DEGREE_LATITUDE,
    longitudeSpan:
      radiusMiles /
      (MILES_PER_DEGREE_LATITUDE * Math.cos((latitude * Math.PI) / DEGREES_PER_HALF_TURN)),
  };
}

function prefix(table: string): string {
  return table === "" ? "" : `${table}.`;
}
