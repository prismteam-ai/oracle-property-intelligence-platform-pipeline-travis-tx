// Gates a page behind the Cognito session (A-16 T042): a missing or expired session returns the
// visitor to the admin sign-in page, never a blank screen. Signed-out visitors therefore get no
// admin control in the DOM (AC-6). Whether the signed-in user is an admin is the API's decision
// (`admin.me`); the pages that need it ask there.
import { ROUTES } from "@countylens/shared/routes";
import type { ReactElement, ReactNode } from "react";
import { Navigate } from "react-router";
import { loadSession } from "./session";

export function RequireSession({ children }: { readonly children: ReactNode }): ReactElement {
  if (loadSession() === undefined) return <Navigate to={ROUTES.adminSignIn} replace />;
  return <>{children}</>;
}
