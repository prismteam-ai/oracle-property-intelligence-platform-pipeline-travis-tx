// A-03-TC-003, TC-004, TC-005: the published run manifest against the elephant-cli output it
// describes (FR-001, AM-05). Step 0 (the `run` fixture) reads the manifest CID and runId from
// `{RUNTIME_URL}/runs` and fetches the manifest by CID. Every count and CID comes from the
// manifest or the published tables CAR; nothing is hard-coded.
import { isCidV1 } from "@countylens/contract";
import { cidOfBytes } from "@countylens/publish";
import { checkpointText } from "./lib/evidence.js";
import { expect, test } from "./lib/fixtures.js";
import {
  CID_V0_PATTERN,
  PART_SIZE_48M,
  artifactsOf,
  groupOfDirectory,
  publicCid,
  readTablesRoot,
  resolveDataGroups,
  tableInDirectory,
  type ReadTablesRoot,
} from "./lib/manifest.js";
import { fetchByCid, readCommittedManifest, sha256Hex, type FetchedByCid } from "./lib/runtime.js";

// The Austin source states the Comptroller registry: "not loaded" up to Run 3; from Run 3.1 (ERR-73)
// the run states the loaded registry it matched the published contractor names against.
const AUSTIN_LIMITATION =
  /^(Comptroller baseline not loaded \(A-07\)|Comptroller registry loaded \d{4}-\d{2}-\d{2} \(\d+ rows, .*)$/;
const TCAD_LIMITATION = /^Confidential owner records redacted \(Texas Tax Code §25\.025\): \d+$/;
const DATA_GROUPS = ["county", "property_improvement"];

// Full-county adaptation 2026-10-24 (A-11 Run 2): only small artifacts (each batch's tables.car)
// stay cached. Run 2's 15 batch CARs total ~2.8 GB; caching them for the whole worker starved the
// browser of later cases in the same job (TC-012 stalled after its parts had downloaded).
const CACHE_MAX_BYTES = 8 * 1024 * 1024;
const bytesByCid = new Map<string, Promise<FetchedByCid>>();
function fetchOnce(cid: string): Promise<FetchedByCid> {
  let pending = bytesByCid.get(cid);
  if (!pending) {
    pending = fetchByCid(cid);
    bytesByCid.set(cid, pending);
    pending.then(
      (got) => {
        if (got.bytes.length > CACHE_MAX_BYTES) bytesByCid.delete(cid);
      },
      () => bytesByCid.delete(cid),
    );
  }
  return pending;
}

const rootsByCid = new Map<string, Promise<ReadTablesRoot>>();
function tablesRootOnce(carCid: string): Promise<ReadTablesRoot> {
  let pending = rootsByCid.get(carCid);
  if (!pending) {
    pending = fetchOnce(carCid).then((got) => readTablesRoot(got.bytes));
    rootsByCid.set(carCid, pending);
  }
  return pending;
}

test.describe("A-03 run manifest (FR-001)", () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  test.describe("A-03-TC-003 Manifest lists every artifact with CIDv1, name, codec, size, SHA-256", () => {
    test("@scenario:A-03-TC-003", async ({ run }, testInfo) => {
      const { manifest, manifestText, manifestBytes, runId, manifestCid } = run;
      await testInfo.attach("manifest.json", {
        body: manifestText,
        contentType: "application/json",
      });

      // Precondition: the committed runs/<runId>/manifest.json is the bytes the CID resolves to.
      const committed = readCommittedManifest(runId);
      expect(committed, `runs/${runId}/manifest.json is committed`).toBeDefined();
      if (committed) {
        expect(
          Buffer.compare(Buffer.from(committed), Buffer.from(manifestBytes)),
          `runs/${runId}/manifest.json equals the bytes of ${manifestCid}`,
        ).toBe(0);
      }

      // Step 2: every artifact entry is complete and CIDv1.
      expect(manifest.artifacts.length).toBeGreaterThan(0);
      for (const artifact of manifest.artifacts) {
        expect.soft(artifact.cid, `${artifact.name}: cid is base32 CIDv1`).toMatch(/^b[a-z2-7]+$/);
        expect.soft(isCidV1(artifact.cid), `${artifact.name}: cid is CIDv1`).toBe(true);
        expect.soft(artifact.name.length, `${artifact.name}: name`).toBeGreaterThan(0);
        expect.soft(artifact.codec.length, `${artifact.name}: codec`).toBeGreaterThan(0);
        expect.soft(artifact.size, `${artifact.name}: size`).toBeGreaterThan(0);
        expect.soft(artifact.sha256, `${artifact.name}: sha256`).toMatch(/^[a-f0-9]{64}$/);
      }
      expect(manifestText, "no CIDv0 anywhere in the manifest").not.toMatch(CID_V0_PATTERN);

      // Step 3: the artifact list equals the export-tables output, read from the published
      // tables CAR of each batch (its CountyTables root lists every table part by CID and size).
      // A group may span several batch CARs (A-04/A-11, e.g. Run 1's 10 county + 2
      // property_improvement batches), so this checks "at least one directory/CAR per group",
      // never "exactly one" — groups are resolved from the manifest's own structure (the same
      // majority vote over REQUIRED_TABLES bind-manifest.ts's resolveBatchGroups performs), never
      // guessed from a fixed `tables/<group>` or `car/travis-<group>.car` name.
      const directories = artifactsOf(manifest, "directory");
      const cars = artifactsOf(manifest, "car");
      const tables = artifactsOf(manifest, "table");
      const groups = resolveDataGroups(manifest);

      const groupsOfDirectories = new Map<string, string>();
      for (const directory of directories) {
        const group = groupOfDirectory(groups, directory);
        expect.soft(group, `${directory.name}: resolves to a known data group`).not.toBeNull();
        if (group) groupsOfDirectories.set(directory.name, group);
      }
      expect(
        new Set(groupsOfDirectories.values()),
        "at least one tables directory per data group",
      ).toEqual(new Set(DATA_GROUPS));

      let exportedParts = 0;
      const groupsOfCars = new Map<string, string>();
      for (const directory of directories) {
        const group = groupsOfDirectories.get(directory.name);
        if (!group) continue;
        const { rootCid, root, blockCount } = await tablesRootOnce(publicCid(directory));
        expect(rootCid, `${directory.name}: tables.car root is the directory cid`).toBe(
          directory.cid,
        );
        expect(blockCount, `${directory.name}: tables.car holds only its root block`).toBe(1);
        // The archive CAR for this batch is whichever car artifact the tables.car itself names
        // (county_root), not one picked by matching names — car filenames are not guaranteed to
        // spell the group (Run 1's property_improvement batches are named "travis-permits-*").
        const car = cars.find((c) => c.cid === root.county_root);
        expect(
          car,
          `${directory.name}: county_root (${root.county_root}) names a published car artifact`,
        ).toBeDefined();
        if (car) groupsOfCars.set(car.name, group);

        const exported = new Map<string, { table: string; index: number; bytes: number }>();
        for (const [table, entry] of Object.entries(root.tables)) {
          entry.parts.forEach((part, index) =>
            exported.set(part.cid, { table, index, bytes: part.bytes }),
          );
        }
        const published = tables.filter((t) => tableInDirectory(t, directory));
        expect(
          published.map((t) => t.cid).sort(),
          `${directory.name}: exactly one artifact per exported file, none from elsewhere`,
        ).toEqual([...exported.keys()].sort());
        for (const artifact of published) {
          const file = exported.get(artifact.cid);
          const match = new RegExp(`^${directory.name}/${file?.table}/part-(\\d+)\\.parquet$`).exec(
            artifact.name,
          );
          expect.soft(match, `${artifact.name}: named after its table and part`).not.toBeNull();
          expect.soft(Number(match?.[1]), `${artifact.name}: part index`).toBe(file?.index);
          expect
            .soft(artifact.size, `${artifact.name}: size equals the exported part`)
            .toBe(file?.bytes);
        }
        exportedParts += exported.size;
      }
      expect(new Set(groupsOfCars.values()), "at least one archive CAR per data group").toEqual(
        new Set(DATA_GROUPS),
      );
      expect(groupsOfCars.size, "every archive CAR is named by some batch's tables.car").toBe(
        cars.length,
      );
      expect(
        manifest.artifacts.length,
        "artifacts are the archive CARs, the tables directories and the exported parts",
      ).toBe(cars.length + directories.length + exportedParts);

      // Step 4: the two limitation notes, verbatim (FR-001, P0-15).
      const [austin, tcad] = manifest.sources;
      expect(austin?.name).toBe("austin-3syk-w9eu");
      expect(
        (austin?.limitations ?? []).filter((l) => AUSTIN_LIMITATION.test(l)),
        "exactly one Comptroller registry note on the Austin source",
      ).toHaveLength(1);
      expect(tcad?.name).toBe("tcad-2026-certified-json");
      expect(tcad?.limitations.filter((note) => TCAD_LIMITATION.test(note))).toHaveLength(1);
    });
  });

  test.describe("A-03-TC-004 Each tables directory and each CAR artifact has a carCid", () => {
    test("@scenario:A-03-TC-004", async ({ run }) => {
      const { manifest } = run;
      const directories = artifactsOf(manifest, "directory");
      const cars = artifactsOf(manifest, "car");
      const groups = resolveDataGroups(manifest);

      // AM-05 requires at least one directory and one archive CAR per data group — never
      // "exactly one": a group can span several batch CARs (Run 1's 10 county + 2
      // property_improvement batches).
      expect(directories.length, "at least one tables directory").toBeGreaterThan(0);
      expect(cars.length, "at least one archive CAR").toBeGreaterThan(0);

      const groupsOfDirectories = new Map<string, string>();
      for (const directory of directories) {
        const group = groupOfDirectory(groups, directory);
        expect.soft(group, `${directory.name}: resolves to a known data group`).not.toBeNull();
        if (group) groupsOfDirectories.set(directory.name, group);
      }
      expect(
        new Set(groupsOfDirectories.values()),
        "at least one tables directory per data group",
      ).toEqual(new Set(DATA_GROUPS));

      const groupsOfCars = new Map<string, string>();
      for (const directory of directories) {
        const group = groupsOfDirectories.get(directory.name);
        if (!group) continue;
        const { root } = await tablesRootOnce(publicCid(directory));
        const car = cars.find((c) => c.cid === root.county_root);
        if (car) groupsOfCars.set(car.name, group);
      }
      expect(new Set(groupsOfCars.values()), "at least one archive CAR per data group").toEqual(
        new Set(DATA_GROUPS),
      );

      await checkpointText(
        "004",
        "carcids",
        [...directories, ...cars]
          .map(
            (a) =>
              `${a.kind}\t${a.name}\tcid=${a.cid}\tcarCid=${a.carCid ?? "-"}\tsize=${a.size}\tsha256=${a.sha256}`,
          )
          .join("\n"),
      );

      for (const artifact of [...directories, ...cars]) {
        const label = `${artifact.kind} ${artifact.name}`;
        expect(artifact.carCid, `${label}: carCid present`).toBeDefined();
        if (!artifact.carCid) continue;
        expect(isCidV1(artifact.carCid), `${label}: carCid is CIDv1`).toBe(true);
        expect(artifact.carCid, `${label}: carCid is a file CID, not the dag-json root`).not.toBe(
          artifact.cid,
        );
        expect(artifact.carCid, `${label}: carCid is raw or dag-pb, never dag-json`).not.toMatch(
          /^bagu/,
        );
        const got = await fetchOnce(artifact.carCid);
        expect(await cidOfBytes(got.bytes), `${label}: the bytes at carCid hash to carCid`).toBe(
          artifact.carCid,
        );
        expect(got.bytes.length, `${label}: size is the .car file size`).toBe(artifact.size);
        expect(sha256Hex(got.bytes), `${label}: sha256 is the .car file digest`).toBe(
          artifact.sha256,
        );
      }
    });
  });

  test.describe("A-03-TC-005 Every table part ≤ 50.3 MB (part size 48m)", () => {
    test("@scenario:A-03-TC-005", async ({ run }) => {
      const { manifest } = run;
      const partsByCid = new Map<string, number>();
      for (const directory of artifactsOf(manifest, "directory")) {
        const { root } = await tablesRootOnce(publicCid(directory));
        expect(
          root.part_size_bytes,
          `${directory.name}: export-tables ran with --part-size 48m`,
        ).toBe(PART_SIZE_48M);
        for (const entry of Object.values(root.tables)) {
          for (const part of entry.parts) partsByCid.set(part.cid, part.bytes);
        }
      }
      const tables = artifactsOf(manifest, "table");
      await checkpointText(
        "005",
        "table-part-sizes",
        [
          `part size limit ${PART_SIZE_48M} bytes`,
          ...tables.map(
            (t) =>
              `${t.name}\tcid=${t.cid}\tsize=${t.size}\texported=${partsByCid.get(t.cid) ?? "-"}`,
          ),
        ].join("\n"),
      );
      expect(tables.length).toBeGreaterThan(0);
      for (const part of tables) {
        expect(
          part.size,
          `${part.name} is ${part.size} bytes, over the 48 MiB part size`,
        ).toBeLessThanOrEqual(PART_SIZE_48M);
        expect(part.size, `${part.name}: size equals the exported part`).toBe(
          partsByCid.get(part.cid),
        );
      }
    });
  });
});
