import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SourceId } from "../../src/domain/source-id.js";
import { NoaaStormEvents } from "../../src/infrastructure/noaa-storm-events.js";
import { SourceRequestError } from "../../src/infrastructure/source-request-error.js";

const BASE_URL = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/";
const FILE_2023 = "StormEvents_details-ftp_v1.0_d2023_c20260323.csv.gz";
const FILE_2024 = "StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz";
const LISTING = [
  "StormEvents_details-ftp_v1.0_d1998_c20220425.csv.gz",
  FILE_2023,
  FILE_2024,
  "StormEvents_fatalities-ftp_v1.0_d2024_c20260801.csv.gz",
]
  .map((name) => `<a href="${name}">${name}</a>`)
  .join("\n");
const HEADER =
  "BEGIN_YEARMONTH,BEGIN_DAY,BEGIN_TIME,EPISODE_ID,EVENT_ID,STATE,EVENT_TYPE,CZ_NAME,CZ_TIMEZONE,MAGNITUDE,SOURCE,BEGIN_LOCATION,BEGIN_LAT,BEGIN_LON,EVENT_NARRATIVE";
const EVENTS_2024 = gzipSync(
  [
    HEADER,
    '202405,9,1840,190001,1181339,TEXAS,Hail,TRAVIS,CST-6,1.75,Public,AUSTIN MABRY,30.35,-97.75,"Golf ball size hail, reported by a resident"',
    '202405,9,1845,190001,1181340,TEXAS,Thunderstorm Wind,TRAVIS,CST-6,60,Public,AUSTIN,30.3,-97.7,"Trees down"',
    '202405,30,1805,190002,1182825,TEXAS,Hail,DALLAS,CST-6,2.00,Public,DALLAS,32.78,-96.8,"Out of the area"',
    '202404,9,1605,190003,1172071,TEXAS,Hail,TRAVIS,CST-6,1.00,Trained Spotter,MANOR,30.34,-97.55,"Quarter size hail\nwith a second line"',
  ].join("\n"),
);
const EVENTS_2023 = gzipSync(`${HEADER}\n`);

function storms(files: Record<string, Buffer | string>, status = 200) {
  const urls: string[] = [];
  const events = new NoaaStormEvents({
    id: SourceId.NoaaStormEvents,
    baseUrl: BASE_URL,
    firstYear: 2000,
    bounds: { south: 29.9, north: 30.7, west: -98.3, east: -97.3 },
    userAgent: "travis-oracle-pipeline/test",
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      const body = files[url];
      return body === undefined
        ? new Response("missing", { status: 404 })
        : new Response(body, { status });
    },
    now: () => new Date("2026-10-27T11:00:00.000Z"),
  });
  return { events, urls };
}

const SERVED = {
  [BASE_URL]: LISTING,
  [`${BASE_URL}${FILE_2023}`]: EVENTS_2023,
  [`${BASE_URL}${FILE_2024}`]: EVENTS_2024,
};

describe("NoaaStormEvents", () => {
  it("uses the newest event file's creation date as its version", async () => {
    const { events, urls } = storms(SERVED);

    expect(await events.version()).toBe("2026-07-28");
    expect(urls).toEqual([BASE_URL]);
  });

  it("reads one year a page, keeping only hail reported inside the bounds", async () => {
    const { events } = storms(SERVED);

    const empty = await events.fetchPage(undefined);
    const hail = await events.fetchPage(empty.lastKey);

    expect(empty).toMatchObject({ recordCount: 0, lastKey: "2023", isLastPage: false });
    expect(hail).toMatchObject({ recordCount: 2, lastKey: "2024", isLastPage: true });
    expect(JSON.parse(hail.body)).toEqual([
      {
        event_id: "1172071",
        episode_id: "190003",
        event_date: "2024-04-09",
        begin_time: "1605",
        timezone: "CST-6",
        county: "TRAVIS",
        magnitude_inches: 1,
        latitude: 30.34,
        longitude: -97.55,
        location: "MANOR",
        report_source: "Trained Spotter",
      },
      expect.objectContaining({ event_id: "1181339", magnitude_inches: 1.75 }),
    ]);
    expect(hail.receipt).toEqual({
      url: `${BASE_URL}${FILE_2024}`,
      fetchedAt: "2026-10-27T11:00:00.000Z",
      httpStatus: 200,
      bytes: EVENTS_2024.byteLength,
      sha256: createHash("sha256").update(EVENTS_2024).digest("hex"),
    });
  });

  it("reports a failed download with its status", async () => {
    const { events } = storms({ [BASE_URL]: LISTING });

    await expect(events.fetchPage(undefined)).rejects.toBeInstanceOf(SourceRequestError);
  });
});
