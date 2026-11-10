import { readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { DatasetFile } from "../application/publication-ports.js";
import { datasetLabel, publishBuild } from "../application/publish-build.js";
import { FilebaseNames, FilebasePinning } from "../infrastructure/filebase.js";
import { GatewayVerifier } from "../infrastructure/gateway-verifier.js";
import { PinataPinning } from "../infrastructure/pinata.js";
import { JsonManifestWriter, JsonPublicationHistory } from "../infrastructure/publication-files.js";
import { latestRunDir } from "../infrastructure/run-directories.js";
import { UnixFsDatasetEncoder } from "../infrastructure/unixfs-dataset-encoder.js";
import {
  BUILD_DIR,
  PUBLISH_DIR,
  PUBLISHED_HISTORY_FILE,
  REPOSITORY,
  requiredEnv,
  resilientFetch,
  VERIFICATION_GATEWAYS,
  VERIFICATION_TIMEOUT_MS,
} from "./settings.js";

const IPNS_LABEL = "travis-oracle";
const FILEBASE_RETAINED_PUBLICATIONS = 30;
const PINATA_RETAINED_PUBLICATIONS = 3;
const PUBLICATION_RESULT_FILE = "publication.json";
const TABLES_PREFIX = "tables";
const SAMPLES_DIR = "samples";
const PARQUET_EXTENSION = ".parquet";

export async function runPublish(
  dataDir: string,
  buildId: string | undefined,
  dryRun: boolean,
): Promise<unknown> {
  const buildDir = buildId
    ? join(dataDir, BUILD_DIR, buildId)
    : await latestRunDir(join(dataDir, BUILD_DIR));
  if (buildDir === undefined) throw new Error("publish needs a build; run the build command first");
  const id = basename(buildDir);
  const files = await datasetFiles(buildDir);
  const workDir = join(dataDir, PUBLISH_DIR, id);
  const encoder = new UnixFsDatasetEncoder();

  if (dryRun) {
    return encoder.encodeDirectory(files, join(workDir, `${datasetLabel(id)}.car`));
  }

  const accessKeyId = requiredEnv("FILEBASE_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("FILEBASE_SECRET_ACCESS_KEY");
  const result = await publishBuild(
    {
      encoder,
      pinning: [
        new FilebasePinning({
          accessKeyId,
          secretAccessKey,
          bucket: requiredEnv("FILEBASE_BUCKET"),
          fetch: resilientFetch,
          retainPublications: FILEBASE_RETAINED_PUBLICATIONS,
        }),
        new PinataPinning({
          jwt: requiredEnv("PINATA_JWT"),
          fetch: resilientFetch,
          retainPublications: PINATA_RETAINED_PUBLICATIONS,
        }),
      ],
      names: new FilebaseNames({
        accessKeyId,
        secretAccessKey,
        label: IPNS_LABEL,
        fetch: resilientFetch,
      }),
      verifier: new GatewayVerifier({
        gateways: VERIFICATION_GATEWAYS,
        timeoutMs: VERIFICATION_TIMEOUT_MS,
        fetch,
        now: () => new Date(),
      }),
      history: new JsonPublicationHistory(join(dataDir, PUBLISHED_HISTORY_FILE)),
      manifests: new JsonManifestWriter(),
    },
    {
      buildId: id,
      files,
      workDir,
      now: () => new Date().toISOString(),
      carUrl: (carName) =>
        `https://github.com/${REPOSITORY}/releases/download/${datasetLabel(id)}/${carName}`,
    },
  );
  await writeFile(join(workDir, PUBLICATION_RESULT_FILE), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function datasetFiles(buildDir: string): Promise<DatasetFile[]> {
  const entries = await readdir(buildDir, { withFileTypes: true });
  const files: DatasetFile[] = [];
  for (const entry of entries) {
    const path = join(buildDir, entry.name);
    if (entry.isDirectory() && entry.name === SAMPLES_DIR) {
      for (const sample of await readdir(path)) {
        files.push({ name: `${SAMPLES_DIR}/${sample}`, path: join(path, sample) });
      }
    } else if (entry.isFile()) {
      const name = entry.name.endsWith(PARQUET_EXTENSION)
        ? `${TABLES_PREFIX}/${entry.name}`
        : entry.name;
      files.push({ name, path });
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
