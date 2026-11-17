import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { UnzipMemberExtractor } from "../../src/infrastructure/unzip-member-extractor.js";

const run = promisify(execFile);

describe("UnzipMemberExtractor", () => {
  it("writes one member of a zip archive to the destination", async () => {
    const dir = await mkdtemp(join(tmpdir(), "travis-oracle-zip-"));
    await writeFile(join(dir, "PROP.TXT"), "line one\r\nline two\r\n");
    await writeFile(join(dir, "OTHER.TXT"), "ignored");
    await run("zip", ["-q", "export.zip", "PROP.TXT", "OTHER.TXT"], { cwd: dir });
    const destination = join(dir, "out", "PROP.TXT");

    await new UnzipMemberExtractor().extract(join(dir, "export.zip"), "PROP.TXT", destination);

    expect(await readFile(destination, "utf8")).toBe("line one\r\nline two\r\n");
  });

  it("fails when the member is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "travis-oracle-zip-"));
    await writeFile(join(dir, "OTHER.TXT"), "x");
    await run("zip", ["-q", "export.zip", "OTHER.TXT"], { cwd: dir });

    await expect(
      new UnzipMemberExtractor().extract(join(dir, "export.zip"), "PROP.TXT", join(dir, "p.txt")),
    ).rejects.toThrow();
  });
});
