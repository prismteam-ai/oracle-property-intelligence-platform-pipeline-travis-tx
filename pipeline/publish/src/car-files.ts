// A-11 (AM-05): the additive carCid-file step that `elephant-cli upload` does NOT perform,
// as an importable function (it was inline in scripts/upload-car-files.ts, which never had a
// working `--only` flag).
//
// `elephant-cli upload <car>` does a Kubo `dag/import`, giving the DAG root. A DAG root cannot be
// hashed and compared against a plain file's bytes, so AM-05 added a second `carCid` to every
// `car` artifact and to the `tables.car` index inside every `directory` (tables) artifact: the
// plain file's own raw-leaves CIDv1, got by `add`ing the file's bytes. This module adds each
// such file, requires the Kubo Hash to equal the manifest's `carCid` (kuboAddFile enforces it),
// and reads it back from both gateways.
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  gatewaysAgree,
  readbackWhole,
  READBACK_GATEWAYS,
  type GatewayCheck,
} from "./gateway-readback.js";
import { KUBO_ADD_TIMEOUT_MS, kuboAddFile, type FetchLike, type KuboAdded } from "./kubo-add.js";
import { FILEBASE_RPC_API, redact, secretValues } from "./sequence.js";

export interface CarFileArtifact {
  name: string;
  kind: string;
  carCid?: string | undefined;
}

export interface CarFileTarget {
  /** The manifest artifact name (repo-relative). */
  name: string;
  kind: "car" | "directory";
  /** The plain file that must exist at `carCid`. */
  path: string;
  carCid: string;
}

/** The local path of the plain file that must exist at `artifact.carCid`. */
export function carFilePath(artifact: CarFileArtifact, root = ""): string {
  if (artifact.kind === "car") return join(root, artifact.name);
  if (artifact.kind === "directory") return join(root, artifact.name, "tables.car");
  throw new Error(
    `artifact ${artifact.name} has carCid but is kind ${artifact.kind}, not car/directory`,
  );
}

/** Every artifact with a `carCid`, in manifest order, as upload targets under `root`. */
export function carFileTargets(
  manifest: { artifacts: readonly CarFileArtifact[] },
  root = "",
): CarFileTarget[] {
  return manifest.artifacts
    .filter((a) => a.carCid !== undefined && a.carCid !== "")
    .map((a) => ({
      name: a.name,
      kind: a.kind as "car" | "directory",
      path: carFilePath(a, root),
      carCid: a.carCid as string,
    }));
}

export interface UploadCarFileOptions {
  env: NodeJS.ProcessEnv;
  api?: string;
  fetch?: FetchLike;
  /** Injectable for tests; defaults to kuboAddFile. */
  add?: (
    path: string,
    expectedCid: string,
    options: { env: NodeJS.ProcessEnv; api: string; timeoutMs: number; fetch?: FetchLike },
  ) => Promise<KuboAdded>;
  log?: (line: string) => void;
  /**
   * Gateways the readback must check; default both (Pinata and Filebase). PO 2026-10-25: for
   * Run 3, Pinata's readback of large new CARs (about 59 KB/s, beyond the 300 s readback limit)
   * is deferred to story A-16 item 14, so the step runs with Filebase only.
   */
  readbackGateways?: readonly string[];
}

export interface CarFileResult {
  target: CarFileTarget;
  ok: boolean;
  size?: number;
  gateways: GatewayCheck[];
  /**
   * A11-17 R4: gateways this run did NOT read back (PUBLISH_DEFER_PINATA). Written into the
   * receipt, so a later run that must check them does not mistake the receipt for a full one.
   */
  deferredGateways: string[];
  error?: string;
}

/**
 * True when a carCid-file receipt already covers every gateway this run must read back. A receipt
 * with `deferredGateways` covers only the gateways it did check; an older receipt without the
 * field is judged by the gateways it recorded; one with neither covers nothing.
 */
export function receiptCoversGateways(
  receipt: {
    deferredGateways?: readonly string[] | undefined;
    gateways?: readonly { gateway: string }[] | undefined;
  },
  required: readonly string[],
): boolean {
  if (Array.isArray(receipt.deferredGateways))
    return required.every((g) => !(receipt.deferredGateways as readonly string[]).includes(g));
  if (Array.isArray(receipt.gateways)) {
    const checked = receipt.gateways.map((g) => g.gateway);
    return required.every((g) => checked.includes(g));
  }
  return false;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Adds one target (Kubo add, Hash must equal its carCid) and reads it back from both gateways.
 * Never throws for an expected failure: the result carries `ok: false` and the reason.
 */
export async function uploadCarFile(
  target: CarFileTarget,
  options: UploadCarFileOptions,
): Promise<CarFileResult> {
  const log = options.log ?? (() => undefined);
  const safe = (text: string): string => redact(text, secretValues(options.env));
  if (!existsSync(target.path)) {
    log(`FAIL  local file missing: ${target.path}`);
    return {
      target,
      ok: false,
      gateways: [],
      deferredGateways: [],
      error: `local file missing: ${target.path}`,
    };
  }
  // County/permit CARs run tens to hundreds of MB; the Kubo RPC `add` of a plain file has been
  // observed to need more than KUBO_ADD_TIMEOUT_MS's default for a file over ~50 MB (a 232 MB CAR
  // timed out at the default). Scale generously: 1 ms per byte, floored at the library default.
  const size = statSync(target.path).size;
  const timeoutMs = Math.max(KUBO_ADD_TIMEOUT_MS, size);
  const add = options.add ?? kuboAddFile;
  try {
    const added = await add(target.path, target.carCid, {
      env: options.env,
      api: options.api ?? FILEBASE_RPC_API,
      timeoutMs,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    log(`ok    kubo add: Hash ${added.cid} matches manifest carCid, size=${added.size}`);
  } catch (error) {
    const reason = safe(`kubo add: ${message(error)}`);
    log(`FAIL  ${reason}`);
    return { target, ok: false, size, gateways: [], deferredGateways: [], error: reason };
  }
  const gateways: GatewayCheck[] = [];
  const readback = options.readbackGateways ?? READBACK_GATEWAYS;
  const deferredGateways = READBACK_GATEWAYS.filter((g) => !readback.includes(g));
  for (const skipped of deferredGateways) {
    log(`DEFER ${skipped}/ipfs/${target.carCid} readback deferred (A-16 item 14)`);
  }
  for (const gateway of readback) {
    const result = await readbackWhole(gateway, target.carCid, { size }, options.fetch);
    gateways.push(result);
    log(
      result.ok
        ? `ok    ${gateway}/ipfs/${target.carCid} size match`
        : `${result.inconclusive === true ? "WARN " : "FAIL "} ${gateway}/ipfs/${target.carCid} ${result.reason ?? "mismatch"}${result.inconclusive === true ? " (rate limited, not counted against the file)" : ""}`,
    );
  }
  const ok = gatewaysAgree(gateways);
  return {
    target,
    ok,
    size,
    gateways,
    deferredGateways: [...deferredGateways],
    ...(ok ? {} : { error: "gateway readback did not match" }),
  };
}

/** True when `target.name` matches any `only` filter (exact name, basename, or substring). */
export function matchesOnly(target: CarFileTarget, only: readonly string[] | undefined): boolean {
  if (only === undefined || only.length === 0) return true;
  return only.some((o) => target.name === o || target.name.includes(o));
}
