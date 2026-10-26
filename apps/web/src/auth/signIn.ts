// Sign-in against the Cognito user pool by SRP (A-16 T042, AC-6). `amazon-cognito-identity-js`
// does the SRP maths in the browser; it is the standard Cognito client, not an LLM provider SDK.
// Differences from Task B: no lockout Lambda (Cognito's own throttling is enough, agent-design
// metagross § 1), so a lockout is read from Cognito's own refusal; and the exact messages below.
//
// Every failure becomes one of four typed outcomes with fixed wording, never Cognito's raw
// exception text: the wrong-password message never says which of email or password was wrong, and
// Cognito being unavailable or over its limits reads "Sign-in is not available right now, try
// later" (AC-6 edge), so the public pages are untouched.
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import { loadCognitoWebConfig } from "./config";
import type { Session } from "./session";

export type SignInErrorKind = "invalid-credentials" | "locked" | "unavailable";

export interface ClassifiedSignInError {
  readonly kind: SignInErrorKind;
  /** The exact message the page shows. */
  readonly message: string;
}

export const SIGN_IN_TEXTS = Object.freeze({
  invalid: "Wrong email or password.",
  locked: "Too many attempts. Try again in 15 minutes.",
  unavailable: "Sign-in is not available right now, try later",
  emailRequired: "Enter your email address.",
  passwordRequired: "Enter your password.",
});

const UNAVAILABLE_CODES = new Set([
  "TooManyRequestsException",
  "LimitExceededException",
  "InternalErrorException",
  "ServiceUnavailable",
  "ServiceUnavailableException",
  "ThrottlingException",
  "NetworkError",
  "UnknownError",
]);

/** Turns whatever the Cognito client rejected with into one of the three typed outcomes. */
export function classifySignInError(error: unknown): ClassifiedSignInError {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (/password attempts exceeded|too many (failed )?attempts/i.test(message)) {
    return { kind: "locked", message: SIGN_IN_TEXTS.locked };
  }
  if (typeof code === "string" && UNAVAILABLE_CODES.has(code)) {
    return { kind: "unavailable", message: SIGN_IN_TEXTS.unavailable };
  }
  if (
    code === "NotAuthorizedException" ||
    code === "UserNotFoundException" ||
    /incorrect username or password/i.test(message)
  ) {
    return { kind: "invalid-credentials", message: SIGN_IN_TEXTS.invalid };
  }
  // A missing build configuration, a network failure (fetch rejects with a TypeError) and anything
  // else unexpected are all "not available right now": the visitor can only try later.
  return { kind: "unavailable", message: SIGN_IN_TEXTS.unavailable };
}

/** A typed sign-in failure; `message` is the fixed text, never Cognito's. */
export class SignInError extends Error {
  override readonly name = "SignInError";
  constructor(readonly kind: SignInErrorKind) {
    super(
      kind === "invalid-credentials"
        ? SIGN_IN_TEXTS.invalid
        : kind === "locked"
          ? SIGN_IN_TEXTS.locked
          : SIGN_IN_TEXTS.unavailable,
    );
  }
}

function toSession(cognitoSession: CognitoUserSession): Session {
  return {
    idToken: cognitoSession.getIdToken().getJwtToken(),
    accessToken: cognitoSession.getAccessToken().getJwtToken(),
    refreshToken: cognitoSession.getRefreshToken().getToken(),
    expiresAt: cognitoSession.getAccessToken().getExpiration() * 1000,
  };
}

/** Resolves with the session, or rejects with a SignInError. */
export function signIn(username: string, password: string): Promise<Session> {
  let config;
  try {
    config = loadCognitoWebConfig();
  } catch {
    return Promise.reject(new SignInError("unavailable"));
  }
  const pool = new CognitoUserPool({
    UserPoolId: config.userPoolId,
    ClientId: config.userPoolClientId,
  });
  const user = new CognitoUser({ Username: username, Pool: pool });
  const details = new AuthenticationDetails({ Username: username, Password: password });
  return new Promise((resolve, reject) => {
    try {
      user.authenticateUser(details, {
        onSuccess: (cognitoSession) => resolve(toSession(cognitoSession)),
        onFailure: (error: unknown) => reject(new SignInError(classifySignInError(error).kind)),
        // An operator-created user still on a temporary password: not a usable sign-in here.
        newPasswordRequired: () => reject(new SignInError("unavailable")),
      });
    } catch {
      reject(new SignInError("unavailable"));
    }
  });
}
