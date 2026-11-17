import { join } from "node:path";
import {
  buildManifest,
  type Manifest,
  type Pin,
  PinMismatchError,
  type PinningProvider,
  verificationTargets,
} from "../domain/artifact-manifest.js";
import {
  latestPublication,
  type Publication,
  publicationsBeyondRetention,
} from "../domain/publication-history.js";
import {
  type ArtifactVerifier,
  type DatasetEncoder,
  type DatasetFile,
  type ManifestWriter,
  type NameService,
  type PinningService,
  type PinRequest,
  type PublicationHistoryStore,
  type VerificationResult,
  VerificationStatus,
  type VerificationTarget,
} from "./publication-ports.js";

const DATASET_LABEL_PREFIX = "travis-oracle";
const MANIFEST_LABEL_PREFIX = "travis-oracle-manifest";
const CAR_EXTENSION = ".car";

export interface PublishDependencies {
  encoder: DatasetEncoder;
  pinning: readonly PinningService[];
  names: NameService;
  verifier: ArtifactVerifier;
  history: PublicationHistoryStore;
  manifests: ManifestWriter;
}

export interface PublishOptions {
  buildId: string;
  files: readonly DatasetFile[];
  workDir: string;
  now: () => string;
  carUrl: (carName: string) => string | undefined;
}

export interface PublishResult {
  publication: Publication;
  manifest: Manifest;
  verification: VerificationResult[];
  unpinned: { provider: PinningProvider; label: string }[];
}

export function datasetLabel(buildId: string): string {
  return `${DATASET_LABEL_PREFIX}-${buildId}`;
}

export async function publishBuild(
  { encoder, pinning, names, verifier, history, manifests }: PublishDependencies,
  { buildId, files, workDir, now, carUrl }: PublishOptions,
): Promise<PublishResult> {
  const label = datasetLabel(buildId);
  const datasetCar = join(workDir, `${label}${CAR_EXTENSION}`);
  const encoding = await encoder.encodeDirectory(files, datasetCar);
  const datasetPins = await pinEverywhere(pinning, encoding.root, {
    label,
    files,
    carPath: datasetCar,
    asDirectory: true,
  });

  const earlier = await history.read();
  const previous = latestPublication(earlier);
  const manifest = buildManifest({
    buildId,
    createdAt: now(),
    encoding,
    pins: datasetPins,
    previous: previous && { manifestCid: previous.manifestCid, rootCid: previous.rootCid },
    carUrl: carUrl(encoding.car.name),
  });

  const manifestFile = await manifests.write(manifest, workDir);
  const manifestLabel = `${MANIFEST_LABEL_PREFIX}-${buildId}`;
  const encodedManifest = await encoder.encodeFile(
    manifestFile,
    join(workDir, `${manifestLabel}${CAR_EXTENSION}`),
  );
  await pinEverywhere(pinning, encodedManifest.object.cid, {
    label: manifestLabel,
    files: [manifestFile],
    carPath: encodedManifest.car.path,
    asDirectory: false,
  });

  const ipns = await names.publish(encodedManifest.object.cid);
  const publication: Publication = {
    buildId,
    publishedAt: now(),
    manifestCid: encodedManifest.object.cid,
    rootCid: encoding.root,
    ipns,
  };

  const targets: VerificationTarget[] = [...verificationTargets(manifest), encodedManifest.object];
  const verification = await verifier.verify(targets);

  const updated = [...earlier, publication];
  await history.write(updated);

  const unpinned = everyTargetVerified(targets, verification)
    ? await releaseExpiredPins(pinning, updated)
    : [];
  return { publication, manifest, verification, unpinned };
}

async function pinEverywhere(
  pinning: readonly PinningService[],
  expectedCid: string,
  request: PinRequest,
): Promise<Pin[]> {
  const pins = await Promise.all(
    pinning.map(async (service) => ({
      provider: service.provider,
      cid: await service.pin(request),
    })),
  );
  const mismatched = pins.filter((pin) => pin.cid !== expectedCid);
  if (mismatched.length > 0) throw new PinMismatchError(expectedCid, mismatched);
  return pins;
}

function everyTargetVerified(
  targets: readonly VerificationTarget[],
  verification: readonly VerificationResult[],
): boolean {
  return targets.every((target) =>
    verification.some(
      (result) => result.cid === target.cid && result.status === VerificationStatus.Verified,
    ),
  );
}

async function releaseExpiredPins(
  pinning: readonly PinningService[],
  history: readonly Publication[],
): Promise<{ provider: PinningProvider; label: string }[]> {
  const released: { provider: PinningProvider; label: string }[] = [];
  for (const service of pinning) {
    for (const expired of publicationsBeyondRetention(history, service.retainPublications)) {
      const label = datasetLabel(expired.buildId);
      await service.unpin(label);
      released.push({ provider: service.provider, label });
    }
  }
  return released;
}
