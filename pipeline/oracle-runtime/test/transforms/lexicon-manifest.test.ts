// T039: data-group schema CIDs come from the live lexicon manifest at run time (fixture here),
// never from a hardcoded value; any fetch failure stops the run.
// Fixture: a subset of https://lexicon.elephant.xyz/api/manifest fetched 2026-10-21 (public).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LEXICON_MANIFEST_URL,
  LexiconManifestError,
  fetchDataGroupCids,
} from "../../travis/transforms/lexicon-manifest.js";
import { fakeHttp, json, silent, text } from "../fixtures/fake-http.js";

const FIXTURE = JSON.parse(
  readFileSync(new URL("../fixtures/lexicon-manifest.json", import.meta.url), "utf8"),
) as Record<string, { ipfsCid: string; type: string }>;

const noSleep = async (): Promise<void> => undefined;

describe("fetchDataGroupCids", () => {
  it("reads the Seed, County and Property Improvement CIDs from the manifest", async () => {
    const http = fakeHttp([
      { match: (u) => u.href === LEXICON_MANIFEST_URL, respond: () => json(FIXTURE) },
    ]);
    const result = await fetchDataGroupCids({ fetch: http.fetch, sleep: noSleep, log: silent });
    expect(result.cids).toEqual({
      seed: FIXTURE.Seed?.ipfsCid,
      county: FIXTURE.County?.ipfsCid,
      propertyImprovement: FIXTURE.Property_Improvement?.ipfsCid,
    });
    expect(result.manifestUrl).toBe("https://lexicon.elephant.xyz/api/manifest");
    expect(result.receipt).toMatchObject({ url: LEXICON_MANIFEST_URL, status: 200, outcome: "ok" });
    expect(result.receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(http.calls).toHaveLength(1);
  });

  it("follows whatever the manifest says (no hardcoded CID)", async () => {
    const changed = {
      ...FIXTURE,
      County: {
        ipfsCid: "bafkreihlh2y6vpxrzejjxjjj7ec76bdhpkcorfiw6trtj7juwsyzkxqgd4",
        type: "dataGroup",
      },
    };
    const http = fakeHttp([{ match: () => true, respond: () => json(changed) }]);
    const result = await fetchDataGroupCids({ fetch: http.fetch, sleep: noSleep, log: silent });
    expect(result.cids.county).toBe("bafkreihlh2y6vpxrzejjxjjj7ec76bdhpkcorfiw6trtj7juwsyzkxqgd4");
  });

  it("stops on HTTP 403 (blocked)", async () => {
    const http = fakeHttp([{ match: () => true, respond: () => text("forbidden", 403) }]);
    await expect(
      fetchDataGroupCids({ fetch: http.fetch, sleep: noSleep, log: silent }),
    ).rejects.toBeInstanceOf(LexiconManifestError);
  });

  it("stops on a network error and on repeated 5xx", async () => {
    const down = fakeHttp([
      {
        match: () => true,
        respond: () => {
          throw new TypeError("fetch failed");
        },
      },
    ]);
    await expect(
      fetchDataGroupCids({ fetch: down.fetch, sleep: noSleep, log: silent }),
    ).rejects.toThrow(/lexicon manifest/);
    const broken = fakeHttp([{ match: () => true, respond: () => text("oops", 503) }]);
    await expect(
      fetchDataGroupCids({ fetch: broken.fetch, sleep: noSleep, log: silent }),
    ).rejects.toThrow(/lexicon manifest/);
  });

  it("stops when a data group is absent or its CID is not a raw CIDv1", async () => {
    const { County: _county, ...noCounty } = FIXTURE;
    const missing = fakeHttp([{ match: () => true, respond: () => json(noCounty) }]);
    await expect(
      fetchDataGroupCids({ fetch: missing.fetch, sleep: noSleep, log: silent }),
    ).rejects.toThrow(/County/);
    const v0 = {
      ...FIXTURE,
      Seed: { ipfsCid: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", type: "dataGroup" },
    };
    const bad = fakeHttp([{ match: () => true, respond: () => json(v0) }]);
    await expect(
      fetchDataGroupCids({ fetch: bad.fetch, sleep: noSleep, log: silent }),
    ).rejects.toThrow(/Seed/);
  });

  it("stops when the body is not a manifest", async () => {
    const http = fakeHttp([{ match: () => true, respond: () => json(["not", "a", "manifest"]) }]);
    await expect(
      fetchDataGroupCids({ fetch: http.fetch, sleep: noSleep, log: silent }),
    ).rejects.toBeInstanceOf(LexiconManifestError);
  });
});
