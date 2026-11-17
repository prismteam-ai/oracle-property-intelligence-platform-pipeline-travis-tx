import { describe, expect, it } from "vitest";
import { ownerKey } from "../../src/domain/owner-entity.js";

describe("ownerKey", () => {
  it("is the same for one owner written with different punctuation, suffixes or ZIP+4", () => {
    expect(
      ownerKey({
        name: "PARADISA HOMES, LLC",
        mailingLine: "7427 N Lamar Blvd Ste 101",
        mailingZip: "78752-1234",
      }),
    ).toBe(
      ownerKey({
        name: "PARADISA HOMES LLC",
        mailingLine: "7427 N LAMAR BLVD STE 101",
        mailingZip: "78752",
      }),
    );
    expect(
      ownerKey({ name: "ACME, L.L.C.", mailingLine: "P.O. Box 1234", mailingZip: "78767" }),
    ).toBe(ownerKey({ name: "ACME LLC", mailingLine: "PO BOX 1234", mailingZip: "78767" }));
  });

  it("keeps namesakes with different mailing addresses apart", () => {
    expect(
      ownerKey({ name: "JOHN SMITH", mailingLine: "1 MAIN ST", mailingZip: "78701" }),
    ).not.toBe(ownerKey({ name: "JOHN SMITH", mailingLine: "2 OAK ST", mailingZip: "78702" }));
  });

  it("needs an owner name", () => {
    expect(ownerKey({ name: " ", mailingLine: "1 MAIN ST", mailingZip: "78701" })).toBeUndefined();
  });
});
