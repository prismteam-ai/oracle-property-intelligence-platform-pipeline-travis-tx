import { z } from "zod";

export const manifestObjectSchema = z.object({
  name: z.string(),
  path: z.string(),
  cid: z.string(),
  codec: z.enum(["file", "directory"]),
  size: z.number().int().nonnegative(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  rows: z.number().int().nonnegative().optional(),
  description: z.string().optional(),
});

export const manifestSchema = z.object({
  schemaVersion: z.literal("oracle-artifact-manifest/v1"),
  county: z.string(),
  state: z.string(),
  fips: z.string(),
  runId: z.string(),
  createdAt: z.string(),
  cidProfile: z.string(),
  previous: z
    .object({ runId: z.string(), rootCid: z.string(), manifestCid: z.string().nullable() })
    .nullable(),
  root: z.object({
    name: z.string(),
    cid: z.string(),
    codec: z.literal("directory"),
    size: z.number().int().nonnegative(),
    car: z.object({
      fileName: z.string(),
      cid: z.string(),
      size: z.number().int(),
      sha256: z.string(),
    }),
  }),
  objects: z.array(manifestObjectSchema),
  ipns: z.object({ name: z.string(), resolvedCid: z.string(), publishedAt: z.string() }).nullable(),
  providers: z.array(
    z.object({
      provider: z.string(),
      type: z.string(),
      status: z.string(),
      detail: z.string().optional(),
      origins: z.array(z.string()).optional(),
    }),
  ),
  gateways: z.array(z.string()),
  runSummary: z.object({
    status: z.string(),
    coverage: z.record(z.string(), z.number()),
    sources: z.array(z.record(z.string(), z.unknown())),
  }),
});

export type ArtifactManifest = z.infer<typeof manifestSchema>;

export const DEFAULT_GATEWAYS = ["https://ipfs.io", "https://dweb.link"];

export function gatewayUrl(gateway: string, cid: string): string {
  return `${gateway.replace(/\/$/, "")}/ipfs/${cid}`;
}
