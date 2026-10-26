// Sign out (A-16 T042): clears CountyLens's own session and the Cognito SDK's cached user (its
// `CognitoIdentityServiceProvider.*` localStorage keys). Local only; the caller routes away.
import { CognitoUserPool } from "amazon-cognito-identity-js";
import { loadCognitoWebConfig } from "./config";
import { clearSession } from "./session";

export function signOut(): void {
  clearSession();
  try {
    const config = loadCognitoWebConfig();
    const pool = new CognitoUserPool({
      UserPoolId: config.userPoolId,
      ClientId: config.userPoolClientId,
    });
    pool.getCurrentUser()?.signOut();
  } catch {
    // No Cognito config in this build: the SDK never cached a user and the session is gone.
  }
}
