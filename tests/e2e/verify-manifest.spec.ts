// A-03-TC-040…043: `scripts/verify-manifest.ts` on the published run (FR-006, AM-01).
// The cases spawn the script from the repo root and assert its exact texts: the `manifest`
// byte-compare line per gateway, one line per artifact per gateway, the fixed refusal for
// a non-allowlisted host, and the success line. At full-county scale (225 table parts, 15 CARs,
// about 2.8 GB) a full verification takes hours, so the hosted cases run `--sample` (PO 2026-10-25):
// the manifest and the smallest table part on Pinata + orbitor (AM-10; Filebase as fallback) plus the smallest CAR on Filebase
// (Pinata rate-limits CAR downloads, story A-16 item 14), ending with
// `SAMPLE VERIFIED 2 of N artifacts (the CAR on orbitor and Filebase only)`, never ALL ARTIFACTS VERIFIED. The two negative cases run
// verifyManifest in-process: a tampered manifest has a CID no gateway holds, so the script could
// never reach the artifact checks (it only waits for gateway timeouts); the in-process run serves
// the tampered manifest itself and reads every artifact from the real gateways.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { RunManifestV1, type ManifestArtifact } from "@countylens/contract";
import { cidOfBytes, jcsBytes } from "@countylens/publish";
import { resumeKey, verifyManifest } from "../../scripts/verify-manifest.js";
import { expect, test } from "./lib/fixtures.js";
import { publicCid } from "./lib/manifest.js";
import {
  committedManifestPath,
  harnessConfig,
  repoRoot,
  type PublishedRun,
} from "./lib/runtime.js";
import { lines, run, type RunResult } from "./lib/spawn.js";

const SCRIPT = "scripts/verify-manifest.ts";
const SUCCESS = "ALL ARTIFACTS VERIFIED";
const SAMPLE_SUCCESS =
  /^SAMPLE VERIFIED 2 of \d+ artifacts \(the CAR on orbitor and Filebase only\)$/;
const RETIRED_HOSTS = ["ipfs.io", "dweb.link", "w3s.link"];

function refusalText(host: string): string {
  const { PINATA_GATEWAY_HOST, ORBITOR_GATEWAY_HOST, FILEBASE_GATEWAY_HOST } = harnessConfig();
  return `Refused gateway ${host}: verify-manifest only uses https://${PINATA_GATEWAY_HOST} (public gateway · also holds our second copy), https://${ORBITOR_GATEWAY_HOST} (public gateway · holds no copy of ours) and https://${FILEBASE_GATEWAY_HOST} (our main storage host · fallback, not counted)`;
}

/** The independent pair (AM-10): Pinata + orbitor. Filebase is read too, as the labelled fallback. */
function gateways(): string[] {
  const { PINATA_GATEWAY_HOST, ORBITOR_GATEWAY_HOST } = harnessConfig();
  return [PINATA_GATEWAY_HOST, ORBITOR_GATEWAY_HOST];
}

/** Every host the script reads: the independent pair plus the Filebase fallback. */
function allGateways(): string[] {
  return [...gateways(), harnessConfig().FILEBASE_GATEWAY_HOST];
}

/** Hosts the script must never talk to: our CID copy and the retired or non-independent gateways. */
function forbiddenHosts(): string[] {
  const copy = harnessConfig().CID_COPY_HOST;
  return copy ? [copy, ...RETIRED_HOSTS] : RETIRED_HOSTS;
}

async function verify(args: string[], label: string): Promise<RunResult> {
  const result = await run("pnpm", ["exec", "tsx", SCRIPT, ...args], {
    cwd: repoRoot,
    timeoutMs: 8 * 60_000,
  });
  await test.info().attach(`${label}.log`, {
    body: `$ ${result.command}\nexit ${result.code} after ${result.durationMs} ms\n\n${result.output}`,
    contentType: "text/plain",
  });
  return result;
}

function lastLine(result: RunResult): string | undefined {
  return lines(result.stdout).at(-1);
}

/**
 * A copy of the manifest with one artifact changed, written under the test's output dir as the
 * exact JCS bytes the publisher writes (`jcsBytes` from @countylens/publish), so verify-manifest
 * passes its "exact JCS bytes" guard and reaches the per-artifact checks.
 */
function tamperedManifest(
  run: PublishedRun,
  label: string,
  change: (artifact: ManifestArtifact) => ManifestArtifact,
  pick: (artifacts: ManifestArtifact[]) => ManifestArtifact | undefined,
): { path: string; artifact: ManifestArtifact } {
  const original = pick(run.manifest.artifacts);
  if (!original) throw new Error("no artifact to tamper with");
  const artifacts = run.manifest.artifacts.map((a) => (a === original ? change(a) : a));
  const path = test.info().outputPath(`tampered-${label}.json`);
  writeFileSync(path, jcsBytes(RunManifestV1.parse({ ...run.manifest, artifacts })));
  return { path, artifact: original };
}

/** The artifacts `--sample` checks: the smallest table part and the smallest CAR (size, then name). */
function sampleOf(run: PublishedRun): { table: ManifestArtifact; car: ManifestArtifact } {
  const smallest = (kind: string): ManifestArtifact => {
    const found = run.manifest.artifacts
      .filter((a) => a.kind === kind)
      .sort((x, y) => x.size - y.size || x.name.localeCompare(y.name))[0];
    if (!found) throw new Error(`the manifest lists no ${kind} artifact`);
    return found;
  };
  return { table: smallest("table"), car: smallest("car") };
}

/**
 * `--sample` over a tampered manifest, in-process: the tampered manifest's bytes are served for its
 * own CID (no gateway holds it), `hide` (a corrupted carCid) answers 404 at once, and every other
 * request goes to the real gateways. Returns the log lines and whether the run passed.
 */
async function verifyTampered(
  manifestPath: string,
  hide: string | null,
  skipName: string,
): Promise<{ ok: boolean; output: string }> {
  const bytes = new Uint8Array(readFileSync(manifestPath));
  const manifestCid = (await cidOfBytes(bytes)).toString();
  const out: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith(`/ipfs/${manifestCid}`)) return new Response(bytes, { status: 200 });
    if (hide !== null && url.endsWith(`/ipfs/${hide}`)) return new Response("", { status: 404 });
    return fetch(input, init);
  };
  const report = await verifyManifest({
    manifestPath,
    sample: true,
    // The sampled artifact this case does not test is not fetched again (the live Pinata gateway
    // answers 429 to repeated CAR downloads); TC-040 and TC-043 already verify it for real.
    resumeSkip: new Set(allGateways().map((g) => resumeKey(`https://${g}`, skipName))),
    fetch: fetchImpl,
    timeoutMs: 120_000,
    log: (line) => out.push(line),
  });
  return { ok: report.ok, output: out.join("\n") };
}

function flipHex(hex: string): string {
  return (hex[0] === "0" ? "1" : "0") + hex.slice(1);
}

function flipCid(cid: string): string {
  const last = cid.at(-1) ?? "a";
  return cid.slice(0, -1) + (last === "a" ? "b" : "a");
}

test.describe("A-03 verify-manifest (FR-006)", () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  test.beforeEach(({ run }) => {
    expect(
      existsSync(committedManifestPath(run.runId)),
      `runs/${run.runId}/manifest.json is committed`,
    ).toBe(true);
  });

  test.describe("A-03-TC-040 verify-manifest via Pinata + orbitor (Filebase fallback) prints ALL ARTIFACTS VERIFIED", () => {
    test("@scenario:A-03-TC-040", async ({ run }) => {
      const result = await verify([committedManifestPath(run.runId), "--sample"], "tc-040");
      const out = lines(result.output);
      const sampled = sampleOf(run);
      expect(result.code, "exit code 0").toBe(0);
      expect(lastLine(result), "the last line").toMatch(SAMPLE_SUCCESS);
      expect(lastLine(result), "states how many of how many").toBe(
        `SAMPLE VERIFIED 2 of ${run.manifest.artifacts.length} artifacts (the CAR on orbitor and Filebase only)`,
      );
      expect(result.output, "a sample is never reported as a full verification").not.toContain(
        SUCCESS,
      );

      // 1b: the manifest itself, byte-compared, once per gateway, before any artifact.
      for (const host of gateways()) {
        const manifestLine = out.findIndex((line) => /manifest/i.test(line) && line.includes(host));
        expect(manifestLine, `a manifest line for ${host}`).toBeGreaterThanOrEqual(0);
        expect(out[manifestLine], `the ${host} manifest line reports a match`).not.toMatch(
          /mismatch|fail|error/i,
        );
        const firstArtifactLine = out.findIndex((line) =>
          run.manifest.artifacts.some((a) => line.includes(publicCid(a))),
        );
        if (firstArtifactLine >= 0) {
          expect(
            manifestLine,
            `the ${host} manifest line precedes every artifact line`,
          ).toBeLessThan(firstArtifactLine);
        }
      }

      // 2: one line per artifact per gateway, each naming the fetched CID.
      const missing: string[] = [];
      for (const artifact of [sampled.table, sampled.car]) {
        const cid = publicCid(artifact);
        const hosts =
          artifact.kind === "car"
            ? [harnessConfig().ORBITOR_GATEWAY_HOST, harnessConfig().FILEBASE_GATEWAY_HOST]
            : gateways();
        for (const host of hosts) {
          if (!out.some((line) => line.includes(cid) && line.includes(host))) {
            missing.push(`${artifact.name} (${cid}) on ${host}`);
          }
        }
      }
      expect(missing, "every sampled artifact has a line per gateway").toEqual([]);

      // 3: nothing went to the CID copy, ipfs.io, dweb.link or w3s.link.
      for (const host of forbiddenHosts()) {
        expect(result.output, `no line mentions ${host}`).not.toContain(host);
      }
    });
  });

  test.describe("A-03-TC-041 verify-manifest fails on a size or SHA-256 mismatch", () => {
    test("@scenario:A-03-TC-041", async ({ run }) => {
      const smallestTable = () => [sampleOf(run).table];
      const pickTable = (artifacts: ManifestArtifact[]) =>
        artifacts.find((a) => a.name === smallestTable()[0]?.name);

      const sha = tamperedManifest(
        run,
        "sha256",
        (a) => ({ ...a, sha256: flipHex(a.sha256) }),
        pickTable,
      );
      const shaResult = await verifyTampered(sha.path, null, sampleOf(run).car.name);
      expect(shaResult.ok, "sha256 mismatch fails the run").toBe(false);
      expect(shaResult.output).not.toContain(SUCCESS);
      expect(shaResult.output).not.toContain("SAMPLE VERIFIED");
      expect(shaResult.output, "names the artifact").toContain(sha.artifact.name);
      expect(shaResult.output, "names the mismatched field").toMatch(/sha256/i);
      expect(
        lines(shaResult.output).filter(
          (line) => line.startsWith("FAIL") && line.includes(` ${sha.artifact.name} `),
        ).length,
        `a FAIL line names ${sha.artifact.name}`,
      ).toBeGreaterThan(0);

      const size = tamperedManifest(run, "size", (a) => ({ ...a, size: a.size - 1 }), pickTable);
      const sizeResult = await verifyTampered(size.path, null, sampleOf(run).car.name);
      expect(sizeResult.ok, "size mismatch fails the run").toBe(false);
      expect(sizeResult.output).not.toContain(SUCCESS);
      expect(sizeResult.output).not.toContain("SAMPLE VERIFIED");
      expect(sizeResult.output, "names the artifact").toContain(size.artifact.name);
      expect(sizeResult.output, "names the mismatched field").toMatch(/size/i);
      expect(
        lines(sizeResult.output).filter(
          (line) => line.startsWith("FAIL") && line.includes(` ${size.artifact.name} `),
        ).length,
        `a FAIL line names ${size.artifact.name}`,
      ).toBeGreaterThan(0);
    });
  });

  test.describe("A-03-TC-042 verify-manifest refuses non-allowlisted hosts", () => {
    test("@scenario:A-03-TC-042", async ({ run }) => {
      const copy = harnessConfig().CID_COPY_HOST;
      const hosts = copy ? [copy, ...RETIRED_HOSTS] : RETIRED_HOSTS;
      expect(
        hosts.length,
        "the CID copy host and the three retired or non-independent gateways",
      ).toBe(4);
      for (const host of hosts) {
        const result = await verify(
          [committedManifestPath(run.runId), "--gateway", host],
          `tc-042-${host}`,
        );
        expect(result.code, `${host}: exits non-zero`).not.toBe(0);
        expect(result.output, `${host}: the exact refusal`).toContain(refusalText(host));
        expect(result.output, `${host}: nothing verified`).not.toContain(SUCCESS);
        expect(result.output, `${host}: no fetch line`).not.toContain("/ipfs/");
      }
    });
  });

  test.describe("A-03-TC-043 CAR artifacts verified through their carCid bytes", () => {
    test("@scenario:A-03-TC-043", async ({ run }) => {
      const car = sampleOf(run).car;
      expect(car.carCid, "the sampled CAR has a carCid").toBeTruthy();

      const result = await verify(
        [committedManifestPath(run.runId), "--sample", "--verbose"],
        "tc-043",
      );
      expect(result.code).toBe(0);
      expect(lastLine(result)).toMatch(SAMPLE_SUCCESS);
      const out = lines(result.output);
      const carCid = publicCid(car);
      // AM-10: a sample reads the CAR from orbitor (counted) and Filebase (fallback), never Pinata.
      for (const carHost of [
        harnessConfig().ORBITOR_GATEWAY_HOST,
        harnessConfig().FILEBASE_GATEWAY_HOST,
      ]) {
        expect(
          out.some((line) => line.includes(`/ipfs/${carCid}`) && line.includes(carHost)),
          `${car.name}: fetched /ipfs/${carCid} from ${carHost}`,
        ).toBe(true);
      }
      expect(
        out.some((line) => line.includes(`/ipfs/${carCid}`) && line.includes("pinata")),
        `${car.name}: a sample does not pull the CAR from Pinata`,
      ).toBe(false);
      expect(
        out.some((line) => line.includes(`/ipfs/${car.cid}`)),
        `${car.name}: the dag-json root ${car.cid} is never fetched as a file`,
      ).toBe(false);

      const corrupted = tamperedManifest(
        run,
        "carcid",
        (a) => ({ ...a, carCid: a.carCid ? flipCid(a.carCid) : a.carCid }),
        (artifacts) => artifacts.find((a) => a.name === car.name),
      );
      const corruptedCid = corrupted.artifact.carCid ? flipCid(corrupted.artifact.carCid) : null;
      const bad = await verifyTampered(corrupted.path, corruptedCid, sampleOf(run).table.name);
      expect(bad.ok, "a corrupted carCid fails the run").toBe(false);
      expect(bad.output).not.toContain(SUCCESS);
      expect(bad.output).not.toContain("SAMPLE VERIFIED");
      expect(bad.output, "names the artifact").toContain(corrupted.artifact.name);
      expect(
        lines(bad.output).filter(
          (line) => line.startsWith("FAIL") && line.includes(` ${corrupted.artifact.name} `),
        ).length,
        `a FAIL line names ${corrupted.artifact.name}`,
      ).toBeGreaterThan(0);
    });
  });
});
