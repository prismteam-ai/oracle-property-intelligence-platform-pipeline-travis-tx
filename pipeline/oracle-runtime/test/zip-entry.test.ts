// CR-7 and CR-10: the ZIP entry reader closes its file stream on an early exit and streams
// nothing for an empty entry. SYNTHETIC TEST FIXTURE (test-only): invented archives built
// with test/fixtures/synthetic-zip.ts; no real export is read.
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listZipEntries, openZipEntry } from "../travis/lib/zip-entry.js";
import { scanExport } from "../travis/discovery/probes/tcad.js";
import { buildZip } from "./fixtures/synthetic-zip.js";
import { must } from "./helpers.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "zip-entry-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Open file descriptors of this process (/dev/fd on macOS and Linux). */
function openFds(): number {
  return readdirSync("/dev/fd").length;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

describe("zip-entry", () => {
  it("CR-10: a zero-size stored entry streams zero bytes", async () => {
    const path = join(tempDir(), "empty.zip");
    writeFileSync(
      path,
      buildZip([
        { name: "empty.json", data: Buffer.alloc(0), deflate: false },
        { name: "next.json", data: Buffer.from("[1]"), deflate: false },
      ]),
    );
    const [empty, next] = listZipEntries(path);
    expect((await readAll(openZipEntry(path, must(empty)))).byteLength).toBe(0);
    expect((await readAll(openZipEntry(path, must(next)))).toString()).toBe("[1]");
  });

  it("CR-10: a zero-size deflated entry streams zero bytes", async () => {
    const path = join(tempDir(), "empty-deflated.zip");
    writeFileSync(path, buildZip([{ name: "empty.json", data: Buffer.alloc(0) }]));
    const [entry] = listZipEntries(path);
    expect((await readAll(openZipEntry(path, must(entry)))).byteLength).toBe(0);
  });

  it("CR-7: destroying a deflated entry stream part-way also closes the file stream", async () => {
    const path = join(tempDir(), "big.zip");
    // incompressible bytes, so the compressed entry is far larger than one read chunk
    writeFileSync(path, buildZip([{ name: "big.json", data: randomBytes(4 * 1024 * 1024) }]));
    const [entry] = listZipEntries(path);
    const before = openFds();
    const stream = openZipEntry(path, must(entry));
    await new Promise<void>((resolve) => stream.once("data", () => resolve()));
    expect(openFds()).toBeGreaterThan(before);
    stream.destroy();
    await settle();
    expect(openFds()).toBe(before);
  });

  it("CR-7: the TCAD record-path probe leaves no file descriptor open on a ZIP export", async () => {
    const path = join(tempDir(), "export.zip");
    const records = Array.from({ length: 20_000 }, (_, i) => ({
      pID: i + 1,
      pad: randomBytes(24).toString("hex"),
    }));
    writeFileSync(
      path,
      buildZip([
        { name: "export.json", data: Buffer.from(JSON.stringify({ properties: records })) },
      ]),
    );
    const before = openFds();
    const scan = await scanExport(path);
    await settle();
    expect(scan.count).toBe(20_000);
    expect(openFds()).toBe(before);
  });
});
