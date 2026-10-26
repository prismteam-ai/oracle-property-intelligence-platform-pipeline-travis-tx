// D-9 (A-02): the committed pilot manifest (contract/v1/pilot-manifest.json) carries the
// AD-24 five-state contractor totals (donphan M3), the owner-gap counts (donphan M1), the
// travis-places and travis-austin digests (code-review #8, oracle F5) and artifacts in
// code-unit order (code-review #5).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RunManifestV1 } from "@countylens/contract";
import { PROFILE } from "@countylens/profile-travis-austin";
import { GAZETTEER } from "../gazetteer/travis-places@1.0.0/index.js";
import { PILOT_MANIFEST } from "./helpers/pilot.js";

const manifest = RunManifestV1.parse(JSON.parse(readFileSync(PILOT_MANIFEST, "utf8")));
const count = (k: string): number | undefined => manifest.coverage[k]?.count;

describe("pilot manifest coverage and profiles (D-9)", () => {
  it("has the five AD-24 contractor totals; in the pilot every published permit is unresolved", () => {
    const keys = [
      "contractor_resolved",
      "contractor_candidate",
      "contractor_ambiguous",
      "contractor_conflicting",
      "contractor_unresolved",
    ];
    for (const k of keys) expect(manifest.coverage[k]?.derivation, k).toBe("aggregate_match");
    expect(keys.map(count)).toEqual([0, 0, 0, 0, count("permits_emitted")]);
    expect(count("permits_emitted")).toBeGreaterThan(0);
  });

  it("counts each owner gap from the capture receipts", () => {
    const keys = ["owner_no_dated_sale", "owner_unparsed", "owner_confidential", "owner_no_record"];
    for (const k of keys) expect(manifest.coverage[k]?.derivation, k).toBe("capture_receipt");
    // The pilot: 12 owners with no dated sale, 4 unparsed names, none confidential, none absent.
    expect(keys.map(count)).toEqual([12, 4, 0, 0]);
  });

  it("records travis-places@1.0.0 (gazetteer DIGEST) and the in-repo travis-austin DIGEST", () => {
    const places = manifest.profiles.find((p) => p.name === "travis-places");
    expect(places).toMatchObject({ version: "1.0.0", sha256: GAZETTEER.sha256 });
    const austin = manifest.profiles.find((p) => p.name === PROFILE.name);
    expect(austin).toMatchObject({ version: PROFILE.version, sha256: PROFILE.sha256 });
  });

  it("lists table artifacts in code-unit order of their names", () => {
    const names = manifest.artifacts.filter((a) => a.kind === "table").map((a) => a.name);
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(names.join("\n")).toBe(sorted.join("\n"));
  });
});
