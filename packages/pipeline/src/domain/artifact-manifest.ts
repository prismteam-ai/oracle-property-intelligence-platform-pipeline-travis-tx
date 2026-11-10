export const MANIFEST_SCHEMA = "travis-oracle.artifact-manifest.v1";
export const DATASET_ROOT_NAME = "/";

export enum ArtifactKind {
  File = "file",
  Directory = "directory",
}

export enum ArtifactCodec {
  Raw = "raw",
  DagPb = "dag-pb",
}

export enum PinningProvider {
  Filebase = "filebase",
  Pinata = "pinata",
}

export const DAG_SETTINGS = {
  cid_version: 1,
  multibase: "base32",
  hash: "sha2-256",
  chunker: "fixed-size, 262144 bytes",
  layout: "balanced, 174 links per node",
  raw_leaves: true,
} as const;

const MINIMUM_INDEPENDENT_PINS = 2;

export interface ArtifactObject {
  name: string;
  cid: string;
  kind: ArtifactKind;
  codec: ArtifactCodec;
  size: number;
  sha256?: string;
}

export interface CarFile {
  name: string;
  size: number;
  sha256: string;
}

export interface DatasetEncoding {
  root: string;
  objects: ArtifactObject[];
  car: CarFile;
}

export interface Pin {
  provider: PinningProvider;
  cid: string;
}

export interface PreviousPublication {
  manifestCid: string;
  rootCid: string;
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA;
  build_id: string;
  created_at: string;
  root: ArtifactObject;
  objects: ArtifactObject[];
  car: CarFile & { root: string; url: string | null };
  dag: typeof DAG_SETTINGS;
  pins: Pin[];
  previous: { manifest_cid: string; root_cid: string } | null;
}

export interface ManifestInput {
  buildId: string;
  createdAt: string;
  encoding: DatasetEncoding;
  pins: readonly Pin[];
  previous: PreviousPublication | undefined;
  carUrl: string | undefined;
}

export class PinMismatchError extends Error {
  constructor(
    readonly expectedCid: string,
    readonly mismatched: readonly Pin[],
  ) {
    super(
      `Providers pinned a different root than ${expectedCid}: ${mismatched
        .map(({ provider, cid }) => `${provider}=${cid}`)
        .join(", ")}`,
    );
    this.name = "PinMismatchError";
  }
}

export function buildManifest({
  buildId,
  createdAt,
  encoding,
  pins,
  previous,
  carUrl,
}: ManifestInput): Manifest {
  if (new Set(pins.map((pin) => pin.provider)).size < MINIMUM_INDEPENDENT_PINS) {
    throw new Error(
      `A dataset must be pinned by at least two independent providers, got ${pins.length}`,
    );
  }
  const mismatched = pins.filter((pin) => pin.cid !== encoding.root);
  if (mismatched.length > 0) throw new PinMismatchError(encoding.root, mismatched);

  const fileBytes = encoding.objects
    .filter((object) => object.kind === ArtifactKind.File)
    .reduce((total, object) => total + object.size, 0);

  return {
    schema: MANIFEST_SCHEMA,
    build_id: buildId,
    created_at: createdAt,
    root: {
      name: DATASET_ROOT_NAME,
      cid: encoding.root,
      kind: ArtifactKind.Directory,
      codec: ArtifactCodec.DagPb,
      size: fileBytes,
    },
    objects: [...encoding.objects].sort((a, b) => a.name.localeCompare(b.name)),
    car: { ...encoding.car, root: encoding.root, url: carUrl ?? null },
    dag: DAG_SETTINGS,
    pins: [...pins],
    previous: previous ? { manifest_cid: previous.manifestCid, root_cid: previous.rootCid } : null,
  };
}

export function verificationTargets(manifest: Manifest): ArtifactObject[] {
  return [manifest.root, ...manifest.objects];
}
