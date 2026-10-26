// TEST FIXTURES (test-only, A-03 T062 / T070): everything the router tests need without AWS,
// DuckDB files or the network (plan Notes: unit tests build their own data). A RunManifestV1 is
// built here with the in-repo profile digests so `bindManifest` accepts it; its CID is the real
// raw-leaves CIDv1 of its bytes, so the rawCid check in s3-read.ts is exercised for real. The
// fake engine records every statement and answers DESCRIBE with the columns views.sql requires.
import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  type S3ClientResolvedConfig,
  type ServiceInputTypes,
  type ServiceOutputTypes,
} from "@aws-sdk/client-s3";
import type { AwsStub } from "aws-sdk-client-mock";
import { RUN_MANIFEST_SCHEMA, RunManifestV1 } from "@countylens/contract";
import { PROFILE } from "@countylens/profile-travis-austin";
import {
  REQUIRED_TABLES,
  gazetteer,
  rawCid,
  type QueryEngine,
  type Row,
} from "@countylens/query-core";

/** The Lambda env of the tests: the four config keys plus a fake region and AWS's documented
 *  example credentials (never real), so presigning works offline. */
export const ENV: Readonly<Record<string, string>> = {
  CID_COPY_BUCKET: "copy-bucket",
  CID_COPY_HOST: "copy.example",
  FILEBASE_GATEWAY_HOST: "gateway.example",
  READPATH_PRIVATE_PREFIX: "private/bench/",
  AWS_REGION: "xx-test-1",
  AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

/** The fixture run's finishedAt: the only as-of instant the queries may use (never now()). */
export const FINISHED_AT = "2026-10-20T22:00:10.663Z";

export interface Fixture {
  readonly manifest: RunManifestV1;
  readonly bytes: Uint8Array;
  /** rawCid(bytes): what a client passes as manifestCid. */
  readonly cid: string;
  /** The CID of the first table part (tables/county/property/part-00000.parquet by default). */
  readonly partCid: string;
  /** Every table part: name, CID, bytes (what ipfs/<cid> holds) and the manifest's size. */
  readonly parts: readonly FixturePart[];
}

export interface FixturePart {
  readonly name: string;
  readonly cid: string;
  readonly bytes: Uint8Array;
  readonly size: number;
}

/** A part to put in the fixture manifest; `size` overrides the declared size (ERR-19). */
export interface PartSpec {
  readonly name: string;
  readonly size?: number;
}

export const PROPERTY_PART = "tables/county/property/part-00000.parquet";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** A minimal, schema-valid manifest with one county.property part; `runId` changes its CID. */
export async function fixtureManifest(
  options: { runId?: string; finishedAt?: string; parts?: readonly PartSpec[] } = {},
): Promise<Fixture> {
  const runId = options.runId ?? "travis-fixture";
  const parts: FixturePart[] = await Promise.all(
    (options.parts ?? [{ name: PROPERTY_PART }]).map(async (spec) => {
      const bytes = new TextEncoder().encode(`fixture parquet bytes for ${runId} ${spec.name}`);
      return { name: spec.name, cid: await rawCid(bytes), bytes, size: spec.size ?? bytes.length };
    }),
  );
  const manifest = RunManifestV1.parse({
    schema: RUN_MANIFEST_SCHEMA,
    runId,
    county: "Travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-20T21:00:00.000Z",
    finishedAt: options.finishedAt ?? FINISHED_AT,
    previousManifestCid: null,
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: null,
        captured_at: "2026-10-20T21:30:00.000Z",
        records: 1,
        added: 1,
        changed: 0,
        removed: 0,
        limitations: [],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/2026-certified.json",
        watermark: null,
        captured_at: "2026-10-20T21:40:00.000Z",
        records: 1,
        added: 1,
        changed: 0,
        removed: 0,
        limitations: [],
      },
    ],
    artifacts: parts.map((p) => ({
      name: p.name,
      cid: p.cid,
      codec: "raw",
      size: p.size,
      sha256: sha256(p.bytes),
      kind: "table",
    })),
    profiles: [
      {
        name: PROFILE.name,
        version: PROFILE.version,
        sha256: PROFILE.sha256,
        path: "profiles/travis-austin@1.0.0/rules.json",
        gitCommit: "0123abc",
      },
      {
        name: "travis-places",
        version: "1.0.0",
        sha256: gazetteer.GAZETTEER.sha256,
        path: "packages/query-core/gazetteer/travis-places@1.0.0/DIGEST",
        gitCommit: "0123abc",
      },
    ],
    coverage: { permits_emitted: { count: 0, derivation: "published_rows" } },
    limitations: [],
  });
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  return { manifest, bytes, cid: await rawCid(bytes), partCid: parts[0]?.cid ?? "", parts };
}

export interface FakeEngine extends QueryEngine {
  /** Every `run()` statement, in order (the bind sequence). */
  readonly statements: string[];
  /** Every `all()` query, in order. */
  readonly queries: string[];
  /** Rows for a query; undefined → `[]`. DESCRIBE is answered by the fake itself. */
  rowsFor: (sql: string) => Row[] | undefined;
}

const DESCRIBE = /^DESCRIBE SELECT \* FROM (\w+)\.(\w+)$/;

/** A recording QueryEngine. DESCRIBE of a required table returns exactly the columns
 *  bind-manifest.ts checks for, so `bindManifest` binds without a database. */
export function fakeEngine(): FakeEngine {
  const engine: FakeEngine = {
    statements: [],
    queries: [],
    rowsFor: () => undefined,
    async run(sql: string): Promise<void> {
      engine.statements.push(sql);
    },
    async all(sql: string): Promise<Row[]> {
      engine.queries.push(sql);
      const described = DESCRIBE.exec(sql);
      if (described) {
        const table = REQUIRED_TABLES.find(
          (t) => t.group === described[1] && t.table === described[2],
        );
        return Object.entries(table?.columns ?? {}).map(([column_name, column_type]) => ({
          column_name,
          column_type,
        }));
      }
      return engine.rowsFor(sql) ?? [];
    },
  };
  return engine;
}

/** ERR-19: answers GetObject for the fixture's manifest and every part (`ipfs/<cid>`). */
export function serveFixture(
  s3: AwsStub<ServiceInputTypes, ServiceOutputTypes, S3ClientResolvedConfig>,
  fixture: Fixture,
): void {
  s3.on(GetObjectCommand, { Key: `ipfs/${fixture.cid}` }).resolves(s3Body(fixture.bytes));
  for (const part of fixture.parts)
    s3.on(GetObjectCommand, { Key: `ipfs/${part.cid}` }).resolves(s3Body(part.bytes));
}

/** A GetObject output whose Body yields `bytes` (the SDK's transformToByteArray shape). */
export function s3Body(bytes: Uint8Array): GetObjectCommandOutput {
  return {
    $metadata: { httpStatusCode: 200 },
    Body: { transformToByteArray: async () => bytes },
  } as unknown as GetObjectCommandOutput;
}
