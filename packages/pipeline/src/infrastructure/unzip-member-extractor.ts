import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import type { MemberExtractor } from "../application/ports.js";

const UNZIP_COMMAND = "unzip";
const PIPE_TO_STDOUT = "-p";

export class UnzipMemberExtractor implements MemberExtractor {
  async extract(archive: string, member: string, destination: string): Promise<void> {
    await mkdir(dirname(destination), { recursive: true });
    const unzip = spawn(UNZIP_COMMAND, [PIPE_TO_STDOUT, archive, member], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const errors: Buffer[] = [];
    unzip.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    const exited = new Promise<number | null>((resolve, reject) => {
      unzip.on("error", reject);
      unzip.on("close", resolve);
    });

    await pipeline(unzip.stdout, createWriteStream(destination));
    const exitCode = await exited;
    if (exitCode !== 0) {
      throw new Error(
        `unzip could not extract ${member} from ${archive} (exit ${exitCode}): ${Buffer.concat(errors).toString().trim()}`,
      );
    }
  }
}
