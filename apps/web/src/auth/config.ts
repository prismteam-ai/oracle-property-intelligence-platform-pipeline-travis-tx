// A-16 T042: the two Cognito Vite variables, parsed once and never read ad hoc elsewhere (copied
// from Task B's web auth, renamed). They are set by the Amplify app environment (infra web-stack,
// frozen interface: VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_USER_POOL_CLIENT_ID). Neither is a
// secret. A build without them throws here; the sign-in page turns that into "Sign-in is not
// available right now, try later" and the public pages never import this file.
import { z } from "zod";

const CognitoWebEnv = z.object({
  VITE_COGNITO_USER_POOL_ID: z.string().min(1),
  VITE_COGNITO_USER_POOL_CLIENT_ID: z.string().min(1),
});

export interface CognitoWebConfig {
  readonly userPoolId: string;
  readonly userPoolClientId: string;
}

/** The variables this loader reads; `import.meta.env` satisfies it. */
export type CognitoWebEnvInput = Readonly<
  Partial<Record<keyof z.infer<typeof CognitoWebEnv>, string>>
>;

/** Vite's build-time env, read by key (ImportMetaEnv is open-ended, so no cast is needed). */
function viteCognitoEnv(): CognitoWebEnvInput {
  const read = (key: string): string | undefined => {
    const value: unknown = import.meta.env[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const poolId = read("VITE_COGNITO_USER_POOL_ID");
  const clientId = read("VITE_COGNITO_USER_POOL_CLIENT_ID");
  return {
    ...(poolId === undefined ? {} : { VITE_COGNITO_USER_POOL_ID: poolId }),
    ...(clientId === undefined ? {} : { VITE_COGNITO_USER_POOL_CLIENT_ID: clientId }),
  };
}

export function loadCognitoWebConfig(env: CognitoWebEnvInput = viteCognitoEnv()): CognitoWebConfig {
  const parsed = CognitoWebEnv.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      "Cognito web config missing: set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_USER_POOL_CLIENT_ID.",
    );
  }
  return {
    userPoolId: parsed.data.VITE_COGNITO_USER_POOL_ID,
    userPoolClientId: parsed.data.VITE_COGNITO_USER_POOL_CLIENT_ID,
  };
}
