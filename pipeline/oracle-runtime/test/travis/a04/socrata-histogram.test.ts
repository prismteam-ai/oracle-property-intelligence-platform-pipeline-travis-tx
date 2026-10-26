// ERR-22: the hourly `:updated_at` histogram must use SoQL the live Austin dataset accepts.
import { describe, expect, it } from "vitest";
import {
  buildUpdatedHistogramQuery,
  hourStart,
} from "../../../travis/adapters/socrata/socrata-pages.js";
import { soqlRejection } from "../../fixtures/a04/permits/fake-socrata.js";

const SOURCE = { host: "data.austintexas.gov", dataset: "3syk-w9eu" } as never;

// The exact body the live server returned for date_trunc_ymdh on 2026-10-22 (HTTP 400).
const LIVE_400 = {
  message:
    "Query coordinator error: query.soql.no-such-function; No such function 'date_trunc_ymdh'; arity=1",
  errorCode: "query.soql.no-such-function",
};

describe("ERR-22 histogram query", () => {
  it("the strict fake rejects the unknown function with the live 400 body shape", () => {
    const body = soqlRejection(["date_trunc_ymdh(:updated_at) AS h, count(*) AS n"]);
    expect(body).not.toBeNull();
    const parsed = JSON.parse(body as string) as typeof LIVE_400;
    expect(parsed.errorCode).toBe(LIVE_400.errorCode);
    expect(parsed.message).toBe(LIVE_400.message);
  });

  it("the strict fake rejects a fixed timestamp passed to date_trunc_ymd", () => {
    const body = soqlRejection(["date_trunc_ymd(:updated_at) AS d"]);
    expect(JSON.parse(body as string).errorCode).toBe("query.soql.type-mismatch");
  });

  it("the built query only uses supported functions over a floating timestamp", () => {
    const q = buildUpdatedHistogramQuery(SOURCE, "2026-10-21T14:42:23.154Z");
    expect(q.params.$select).not.toContain("date_trunc_ymdh");
    expect(
      soqlRejection([q.params.$select ?? "", q.params.$group ?? "", q.params.$order ?? ""]),
    ).toBeNull();
  });

  it("turns (day, hour) into an ISO UTC hour start", () => {
    expect(hourStart("2026-10-21T00:00:00.000", "13")).toBe("2026-10-21T13:00:00.000Z");
    expect(() => hourStart("2026-10-21T00:00:00.000", 24)).toThrow();
  });
});
