import { setTimeout as delay } from "node:timers/promises";
import { type RetryPolicy, retryingFetch } from "../infrastructure/retrying-fetch.js";

export const REPOSITORY = "curiousily/oracle-property-intelligence-platform-pipeline-travis-tx";
export const USER_AGENT = `travis-oracle-pipeline/0.1 (+https://github.com/${REPOSITORY})`;

export const STATE_DIR = "state";
export const WORK_DIR = "work";
export const BUILD_DIR = "build";
export const BUILD_STAGING_DIR = "build-staging";
export const PUBLISH_DIR = "publish";
export const PUBLISHED_HISTORY_FILE = "published/history.json";
export const BUILD_RESULT_FILE = "build.json";
export const RUN_HISTORY_FILE = "runs.json";
export const SOURCES_FILE = "sources.json";

export const VERIFICATION_GATEWAYS = ["https://ipfs.orbitor.dev", "https://gw.ipfs-lens.dev"];
export const VERIFICATION_TIMEOUT_MS = 600_000;

const RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 2_000,
  maxDelayMs: 120_000,
  attemptTimeoutMs: 300_000,
};

export const resilientFetch = retryingFetch(fetch, RETRY_POLICY, (milliseconds) =>
  delay(milliseconds),
);

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the environment`);
  return value;
}
