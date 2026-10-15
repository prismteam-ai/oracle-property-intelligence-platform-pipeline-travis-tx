import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCar, sha256File } from "../src/publish/car.js";
import { KuboRpcProvider } from "../src/publish/providers.js";

const kuboUrl = process.env.ORACLE_TEST_KUBO_URL;

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "oracle-car-"));
  await mkdir(path.join(dir, "tables"), { recursive: true });
  await writeFile(path.join(dir, "run.json"), JSON.stringify({ ok: true }));
  const big = Buffer.alloc(3 * 1024 * 1024 + 17);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) % 251;
  await writeFile(path.join(dir, "tables", "big.bin"), big);
  return dir;
}

describe("CAR builder", () => {
  it("produces deterministic CIDv1 base32 identifiers with sha256 digests", async () => {
    const dir = await fixture();
    const out = await mkdtemp(path.join(tmpdir(), "oracle-car-out-"));
    const a = await buildCar(dir, "snap", path.join(out, "a.car"));
    const b = await buildCar(dir, "snap", path.join(out, "b.car"));
    expect(a.rootCid).toBe(b.rootCid);
    expect(a.carSha256).toBe(b.carSha256);
    expect(a.rootCid.startsWith("bafy")).toBe(true);
    const big = a.entries.find((e) => e.path === "snap/tables/big.bin");
    expect(big?.codec).toBe("file");
    expect(big?.cid.startsWith("baf")).toBe(true);
    expect(big?.sha256).toBe((await sha256File(path.join(dir, "tables", "big.bin"))).sha256);
    expect(a.entries.find((e) => e.path === "snap")?.codec).toBe("directory");
  });

  it.skipIf(!kuboUrl)(
    "imports into a Kubo node and every file CID returns identical bytes",
    async () => {
      const dir = await fixture();
      const out = await mkdtemp(path.join(tmpdir(), "oracle-car-kubo-"));
      const res = await buildCar(dir, "snap", path.join(out, "s.car"));
      const kubo = new KuboRpcProvider("test", kuboUrl as string);
      const up = await kubo.importCar(res.carPath, res.rootCid, "test");
      expect(up.status).toBe("pinned");
      for (const e of res.entries.filter((x) => x.codec === "file")) {
        const bytes = await kubo.catBytes(e.cid);
        const local = await readFile(path.join(dir, e.path.slice("snap/".length)));
        expect(Buffer.from(bytes).equals(local)).toBe(true);
      }
    },
  );
});
