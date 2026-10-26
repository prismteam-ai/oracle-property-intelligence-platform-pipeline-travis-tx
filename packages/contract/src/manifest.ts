// RunManifestV1 (contracts/manifest.md). Built only from CLI outputs and capture receipts.
import { z } from "zod";
import { CidV1, IsoDateTime, Sha256Hex, isGatewayUrl } from "./cid.js";

export const RUN_MANIFEST_SCHEMA = "oracle-travis-run-manifest.v1";

/** The limitation every local pilot manifest carries (data-model.md § RunManifestV1 additions). */
export const PILOT_LIMITATION =
  "pilot: local, unpublished; CIDs are real content addresses of local files, replaced in A-03";

export const COVERAGE_DERIVATIONS = [
  "published_rows",
  "capture_receipt",
  "aggregate_match",
] as const;

const Count = z.number().int().nonnegative();

export const ManifestSource = z
  .object({
    name: z.string().min(1),
    url: z.string().url(),
    watermark: z.string().min(1).nullable(),
    captured_at: IsoDateTime,
    records: Count,
    added: Count,
    changed: Count,
    removed: Count,
    limitations: z.array(z.string()),
  })
  .strict();

export const ARTIFACT_KINDS = ["car", "table", "directory"] as const;

export const ManifestArtifact = z
  .object({
    name: z.string().min(1),
    cid: CidV1,
    codec: z.string().min(1),
    size: Count,
    sha256: Sha256Hex,
    kind: z.enum(ARTIFACT_KINDS),
    /** directory only: the UnixFS file CID of its tables.car. */
    carCid: CidV1.optional(),
  })
  .strict()
  .refine((a) => a.kind !== "directory" || a.carCid !== undefined, {
    message: "directory artifacts need carCid (the UnixFS file CID of their tables.car)",
    path: ["carCid"],
  });

export const ManifestProfile = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    sha256: Sha256Hex,
    path: z.string().min(1),
    gitCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
  })
  .strict();

export const CoverageCount = z
  .object({ count: Count, derivation: z.enum(COVERAGE_DERIVATIONS), note: z.string().optional() })
  .strict();

/** Every string in the value (deep), and every key, with its path, for the gateway and IPNS refinements. */
function* strings(
  value: unknown,
  path: (string | number)[] = [],
): Generator<{ key: boolean; text: string; path: (string | number)[] }> {
  if (typeof value === "string") yield { key: false, text: value, path };
  else if (Array.isArray(value))
    for (const [i, v] of value.entries()) yield* strings(v, [...path, i]);
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      yield { key: true, text: k, path: [...path, k] };
      yield* strings(v, [...path, k]);
    }
  }
}

export const RunManifestV1 = z
  .object({
    schema: z.literal(RUN_MANIFEST_SCHEMA),
    runId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    county: z.string().min(1),
    state: z.string().regex(/^[A-Z]{2}$/),
    fips: z.string().regex(/^\d{5}$/),
    startedAt: IsoDateTime,
    finishedAt: IsoDateTime,
    previousManifestCid: CidV1.nullable(),
    sources: z.array(ManifestSource).min(1),
    artifacts: z.array(ManifestArtifact),
    profiles: z.array(ManifestProfile),
    coverage: z.record(z.string().min(1), CoverageCount),
    limitations: z.array(z.string()),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (Date.parse(m.finishedAt) < Date.parse(m.startedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "finishedAt is before startedAt",
      });
    }
    for (const s of strings(m)) {
      if (!s.key && isGatewayUrl(s.text)) {
        ctx.addIssue({
          code: "custom",
          path: s.path,
          message: `gateway URLs are derived, never stored: ${s.text}`,
        });
      }
      if (/ipns/i.test(s.text)) {
        ctx.addIssue({
          code: "custom",
          path: s.path,
          message: `no IPNS field or value in a run manifest: ${s.text}`,
        });
      }
    }
  });
export type RunManifestV1 = z.infer<typeof RunManifestV1>;

export type ManifestSource = z.infer<typeof ManifestSource>;
export type ManifestArtifact = z.infer<typeof ManifestArtifact>;
export type ManifestProfile = z.infer<typeof ManifestProfile>;
export type CoverageCount = z.infer<typeof CoverageCount>;
