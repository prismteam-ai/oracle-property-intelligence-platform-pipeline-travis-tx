import type {
  ArtifactObject,
  DatasetEncoding,
  Manifest,
  PinningProvider,
} from "../domain/artifact-manifest.js";
import type { Publication } from "../domain/publication-history.js";

export interface DatasetFile {
  name: string;
  path: string;
}

export interface EncodedFile {
  object: ArtifactObject;
  car: { path: string; size: number; sha256: string };
}

export interface DatasetEncoder {
  encodeDirectory(files: readonly DatasetFile[], carPath: string): Promise<DatasetEncoding>;
  encodeFile(file: DatasetFile, carPath: string): Promise<EncodedFile>;
}

export interface PinRequest {
  label: string;
  files: readonly DatasetFile[];
  carPath: string;
  asDirectory: boolean;
}

export interface PinningService {
  readonly provider: PinningProvider;
  readonly retainPublications: number;
  pin(request: PinRequest): Promise<string>;
  unpin(label: string): Promise<void>;
}

export interface NameService {
  publish(cid: string): Promise<{ name: string; resolvedCid: string }>;
}

export enum VerificationStatus {
  Verified = "verified",
  Mismatch = "mismatch",
  Unreachable = "unreachable",
}

export interface VerificationTarget {
  name: string;
  cid: string;
  kind: ArtifactObject["kind"];
  size: number;
  sha256?: string;
}

export interface VerificationResult {
  name: string;
  cid: string;
  gateway: string;
  status: VerificationStatus;
  httpStatus: number | undefined;
  bytes: number | undefined;
  checkedAt: string;
}

export interface ArtifactVerifier {
  verify(targets: readonly VerificationTarget[]): Promise<VerificationResult[]>;
}

export interface PublicationHistoryStore {
  read(): Promise<Publication[]>;
  write(history: readonly Publication[]): Promise<void>;
}

export interface ManifestWriter {
  write(manifest: Manifest, workDir: string): Promise<DatasetFile>;
}
