// A-04 T010: every step stops below 5 GiB free (agent-design § 6), exit code 4.
import { statfsSync } from "node:fs";

export const MIN_FREE_BYTES = 5 * 1024 ** 3;

export class DiskGuardError extends Error {
  constructor(
    readonly freeBytes: number,
    readonly minFreeBytes: number,
  ) {
    super(
      `disk guard: ${(freeBytes / 1024 ** 3).toFixed(2)} GiB free, below the ${(minFreeBytes / 1024 ** 3).toFixed(0)} GiB minimum`,
    );
    this.name = "DiskGuardError";
  }
}

/** Free bytes available to this user on the volume holding `path`. */
export function freeBytesAt(path: string): number {
  const s = statfsSync(path);
  return Number(s.bavail) * Number(s.bsize);
}

/** Throws DiskGuardError when `freeBytes` is below `minFreeBytes`. */
export function checkDiskSpace(freeBytes: number, minFreeBytes: number = MIN_FREE_BYTES): void {
  if (freeBytes < minFreeBytes) throw new DiskGuardError(freeBytes, minFreeBytes);
}
