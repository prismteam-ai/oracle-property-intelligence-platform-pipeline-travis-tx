// T044: the data-group schema CIDs that name each data-group root file, read from the live
// lexicon manifest at run time (build-county-transform output contract, oracle F5). Never
// hardcoded from a previous run. Any failure (403, challenge, network, 5xx after backoff,
// a body that is not a manifest, a missing group) stops the run.
import { z } from "zod";
import {
  createSourceClient,
  type CaptureReceipt,
  type FetchLike,
  type SourceClientOptions,
} from "../lib/source-client.js";

export const LEXICON_MANIFEST_URL = "https://lexicon.elephant.xyz/api/manifest";

/** Manifest entry names of the three groups the pilot writes. */
export const DATA_GROUP_LABELS = {
  seed: "Seed",
  county: "County",
  propertyImprovement: "Property_Improvement",
} as const;

export class LexiconManifestError extends Error {
  constructor(
    message: string,
    readonly receipt: CaptureReceipt | null,
  ) {
    super(message);
    this.name = "LexiconManifestError";
  }
}

const Entry = z.object({ ipfsCid: z.string(), type: z.string() }).loose();
const Manifest = z.record(z.string(), Entry);

const RAW_CID_V1 = /^bafkrei[a-z2-7]{52}$/;

export interface DataGroupCids {
  seed: string;
  county: string;
  propertyImprovement: string;
}

export interface LexiconManifestResult {
  cids: DataGroupCids;
  manifestUrl: string;
  receipt: CaptureReceipt;
}

export interface FetchDataGroupCidsOptions {
  fetch?: FetchLike;
  sleep?: SourceClientOptions["sleep"];
  log?: SourceClientOptions["log"];
  now?: SourceClientOptions["now"];
  url?: string;
}

export async function fetchDataGroupCids(
  options: FetchDataGroupCidsOptions = {},
): Promise<LexiconManifestResult> {
  const url = options.url ?? LEXICON_MANIFEST_URL;
  const client = createSourceClient({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.log ? { log: options.log } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  let result;
  try {
    result = await client.capture({ url, schema: Manifest, accept: "application/json" });
  } catch (error) {
    throw new LexiconManifestError(
      `lexicon manifest fetch failed: ${(error as Error).message}`,
      null,
    );
  }
  const { receipt, data } = result;
  if ((receipt.outcome !== "ok" && receipt.outcome !== "throttled-then-ok") || data === null) {
    throw new LexiconManifestError(
      `lexicon manifest not loaded (${receipt.outcome}, status ${receipt.status ?? "none"}); the run stops`,
      receipt,
    );
  }
  const pick = (label: string): string => {
    const entry = data[label];
    if (!entry || entry.type !== "dataGroup") {
      throw new LexiconManifestError(`lexicon manifest has no ${label} data group`, receipt);
    }
    if (!RAW_CID_V1.test(entry.ipfsCid)) {
      throw new LexiconManifestError(
        `lexicon manifest ${label} CID is not a raw CIDv1: ${entry.ipfsCid}`,
        receipt,
      );
    }
    return entry.ipfsCid;
  };
  return {
    cids: {
      seed: pick(DATA_GROUP_LABELS.seed),
      county: pick(DATA_GROUP_LABELS.county),
      propertyImprovement: pick(DATA_GROUP_LABELS.propertyImprovement),
    },
    manifestUrl: url,
    receipt,
  };
}
