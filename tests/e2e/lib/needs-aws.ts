// The `@needs-aws` tag (G-A6 hand-off). The `e2e-hosted` CI job runs Playwright with only
// RUNTIME_URL and no AWS credentials, so every case that uses an AWS profile (lib/aws.ts:
// TC-044, TC-050, TC-NF-05 and similar) carries `@needs-aws` in its title. When CI is set and
// no credentials or profile are available, playwright.config.ts excludes those cases with
// `grepInvert` and says so on stderr: they are neither run nor reported as passed, and the
// operator runs them from a session with the `assess` profile. Outside CI they always run and
// fail loudly without credentials. This module stays synchronous and dependency-free because
// the config evaluates it at load.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const NEEDS_AWS_TAG = "@needs-aws";
export const NEEDS_AWS_PATTERN = /@needs-aws/;

/** The operator profile for reads and the bench (test plan § 3). */
export const READER_PROFILE = "assess";

const CREDENTIAL_ENV_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_PROFILE",
  "AWS_ROLE_ARN",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
];

function hasSection(path: string, section: string): boolean {
  try {
    if (!existsSync(path)) return false;
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^\\[${escaped}\\]`, "m").test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

/** True when the environment or the shared AWS files can plausibly provide credentials. */
export function awsCredentialsAvailable(profile = READER_PROFILE): boolean {
  if (CREDENTIAL_ENV_KEYS.some((key) => (process.env[key] ?? "").trim() !== "")) return true;
  const configPath = process.env.AWS_CONFIG_FILE ?? join(homedir(), ".aws", "config");
  const credentialsPath =
    process.env.AWS_SHARED_CREDENTIALS_FILE ?? join(homedir(), ".aws", "credentials");
  return hasSection(configPath, `profile ${profile}`) || hasSection(credentialsPath, profile);
}

/** True only in CI without credentials: the one situation where `@needs-aws` cases are excluded. */
export function needsAwsExcluded(): boolean {
  return (process.env.CI ?? "").trim() !== "" && !awsCredentialsAvailable();
}

export const NEEDS_AWS_EXCLUDED_NOTICE = `CI without AWS credentials: tests tagged ${NEEDS_AWS_TAG} are excluded from this run (not passed). Run them from an operator session with the "${READER_PROFILE}" profile.`;
