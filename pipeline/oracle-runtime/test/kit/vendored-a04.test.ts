// A-04 T006: the kit ArcGIS permit adapter and the address:v1 signature are vendored
// unmodified (AD-17); each file's SHA-256 is recorded in kit/VENDORED.md. Offline: the
// adapter module is only imported, never pointed at a source. Synthetic address input.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const KIT = new URL("../../kit/", import.meta.url);
const VENDORED = readFileSync(new URL("VENDORED.md", KIT), "utf8");

const A04_VENDORED = [
  "use-oracle/runtime/src/permits/adapters/arcgis-feature-service.mjs",
  "use-oracle/runtime/src/permits/contracts.mjs",
  "use-oracle/runtime/src/permits/backfill-inputs.mjs",
  "use-oracle/runtime/src/permits/normalization.mjs",
  "use-oracle/runtime/src/permits/http.mjs",
  "use-oracle/runtime/src/permits/errors.mjs",
  "use-oracle/runtime/src/core/address-signature.mjs",
] as const;

/** The vendored .mjs files carry no types; import them by URL and narrow at the call site. */
async function importKit(rel: string): Promise<unknown> {
  const url: string = new URL(rel, KIT).href;
  return (await import(url)) as unknown;
}

function sha256Of(rel: string): string {
  return createHash("sha256")
    .update(readFileSync(fileURLToPath(new URL(rel, KIT))))
    .digest("hex");
}

describe("A-04 vendored kit files", () => {
  for (const rel of A04_VENDORED) {
    it(`${rel} matches its VENDORED.md SHA-256 row`, () => {
      const row = VENDORED.split("\n").find((l) => l.startsWith(`| \`${rel}\``));
      expect(row, `VENDORED.md row for ${rel}`).toBeDefined();
      expect(row).toContain(`\`skills/${rel.replace(/^use-oracle\//, "use-oracle/")}\``);
      expect(row).toContain(`\`${sha256Of(rel)}\``);
    });
  }

  it("VENDORED.md notes the seams used in A-04", () => {
    expect(VENDORED).toMatch(/## Seams used in A-04/);
    for (const seam of ["options.client", "loadPageCheckpoint", "onPage", "records"]) {
      expect(VENDORED).toContain(seam);
    }
  });

  it("the ArcGIS adapter exposes createArcgisFeatureServiceAdapter", async () => {
    const mod = (await importKit(
      "use-oracle/runtime/src/permits/adapters/arcgis-feature-service.mjs",
    )) as { createArcgisFeatureServiceAdapter?: unknown };
    expect(typeof mod.createArcgisFeatureServiceAdapter).toBe("function");
  });

  it("address-signature returns an address:v1 signature with no ROAD→RD expansion", async () => {
    const mod = (await importKit("use-oracle/runtime/src/core/address-signature.mjs")) as {
      mintSitusAddressIdentity: (i: {
        state: string;
        postalCode: string;
        street: string;
      }) => { signature: string } | null;
    };
    const id = mod.mintSitusAddressIdentity({
      state: "TX",
      postalCode: "78701-1234",
      street: "100 Synthetic Road",
    });
    expect(id?.signature).toMatch(/^address:v1\|/);
    expect(id?.signature).toContain("100 synthetic road");
    expect(id?.signature).not.toContain(" rd");
  });
});
