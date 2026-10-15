import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  ORACLE_DATA_DIR: z.string().default("data"),
  ORACLE_RUNS_DIR: z.string().default("runs"),
  ORACLE_COUNTY: z.string().default("travis"),
  ORACLE_STATE: z.string().default("TX"),
  ORACLE_FIPS: z.string().default("48453"),
  ORACLE_ROOF_AGE_THRESHOLD_YEARS: z.coerce.number().int().positive().default(15),
  ORACLE_HTTP_USER_AGENT: z
    .string()
    .default(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 oracle-travis-pipeline",
    ),
  ORACLE_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  ORACLE_SOCRATA_APP_TOKEN: z.string().optional(),
  ORACLE_OVERTURE_RELEASE: z.string().optional(),
  ORACLE_TCAD_EXPORT_PATH: z.string().optional(),
  ORACLE_BBB_PROFILES_PATH: z.string().optional(),
});

export type OracleConfig = {
  dataDir: string;
  runsDir: string;
  dbPath: string;
  county: string;
  state: string;
  fips: string;
  roofAgeThresholdYears: number;
  userAgent: string;
  httpTimeoutMs: number;
  socrataAppToken?: string;
  overtureRelease?: string;
  tcadExportPath?: string;
  bbbProfilesPath?: string;
};

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = env.INIT_CWD ?? process.cwd(),
): OracleConfig {
  const e = envSchema.parse(
    Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== "")),
  );
  const dataDir = path.resolve(cwd, e.ORACLE_DATA_DIR);
  return {
    dataDir,
    runsDir: path.resolve(cwd, e.ORACLE_RUNS_DIR),
    dbPath: path.join(dataDir, `${e.ORACLE_COUNTY}.duckdb`),
    county: e.ORACLE_COUNTY,
    state: e.ORACLE_STATE,
    fips: e.ORACLE_FIPS,
    roofAgeThresholdYears: e.ORACLE_ROOF_AGE_THRESHOLD_YEARS,
    userAgent: e.ORACLE_HTTP_USER_AGENT,
    httpTimeoutMs: e.ORACLE_HTTP_TIMEOUT_MS,
    socrataAppToken: e.ORACLE_SOCRATA_APP_TOKEN,
    overtureRelease: e.ORACLE_OVERTURE_RELEASE,
    tcadExportPath: e.ORACLE_TCAD_EXPORT_PATH,
    bbbProfilesPath: e.ORACLE_BBB_PROFILES_PATH,
  };
}
