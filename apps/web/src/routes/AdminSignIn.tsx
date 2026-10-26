// Admin sign-in (`/admin/sign-in`; A-16 T042, AC-6, FR-006; boards AdminSignIn1440/768/390).
// Email and password against the Cognito pool (PO decision 2026-10-26, Task B pattern). States of
// the board that apply: the form, "Signing you in" (the board's "Sending"), a refusal that never
// says which of email or password was wrong ("Wrong email or password."), the lockout ("Too many
// attempts. Try again in 15 minutes."), and Cognito unavailable ("Sign-in is not available right
// now, try later"). Parity, Justified: the board's email-code steps (Code, Expired, "Send a new
// code") do not exist because there is no code step; a successful sign-in goes straight to Runs
// (TC-010) instead of the board's "Signed in as an admin. Go to Runs" screen. A react-router lazy
// route module: it exports `Component` and nothing else. Fields and the Show password toggle copy
// Task B's sign-in (48 px fields and targets) inside the board's card.
import { ROUTES } from "@countylens/shared/routes";
import { useState, type FormEvent, type ReactElement } from "react";
import { Link, useNavigate } from "react-router";
import { Icon } from "../components/Icon";
import { loadSession, saveSession } from "../auth/session";
import { SIGN_IN_TEXTS, SignInError, signIn, type SignInErrorKind } from "../auth/signIn";
import styles from "./AdminSignIn.module.css";

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Phase =
  | { readonly kind: "form" }
  | { readonly kind: "signing-in" }
  | { readonly kind: "refused"; readonly why: SignInErrorKind };

const REFUSAL: Readonly<Record<SignInErrorKind, { text: string; icon: string; tone: string }>> = {
  "invalid-credentials": {
    text: SIGN_IN_TEXTS.invalid,
    icon: "error",
    tone: styles.toneError ?? "",
  },
  locked: { text: SIGN_IN_TEXTS.locked, icon: "lock_clock", tone: styles.toneError ?? "" },
  unavailable: {
    text: SIGN_IN_TEXTS.unavailable,
    icon: "cloud_off",
    tone: styles.toneWarning ?? "",
  },
};

export function Component(): ReactElement {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [tried, setTried] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const signedIn = loadSession() !== undefined;

  const emailBad = tried && !EMAIL_SHAPE.test(email.trim());
  const passwordBad = tried && password === "";
  const busy = phase.kind === "signing-in";

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setTried(true);
    if (!EMAIL_SHAPE.test(email.trim()) || password === "") return;
    setPhase({ kind: "signing-in" });
    signIn(email.trim(), password).then(
      (session) => {
        saveSession(session);
        void navigate(ROUTES.runs);
      },
      (error: unknown) => {
        setPhase({
          kind: "refused",
          why: error instanceof SignInError ? error.kind : "unavailable",
        });
      },
    );
  };

  return (
    <section
      aria-labelledby="as-heading"
      data-route="admin-sign-in"
      data-state={phase.kind}
      className={styles.page}
    >
      <div className={styles.card}>
        <span className={`material-symbols-rounded ${styles.hero}`} aria-hidden="true">
          admin_panel_settings
        </span>
        <div className={styles.head}>
          <h2 id="as-heading" className={styles.title}>
            Admin sign-in
          </h2>
          <p className={styles.lead}>
            Admins can start, stop and retry runs and see Activity. Every other page is public and
            needs no sign-in.
          </p>
        </div>
        <div role="note" className={`${styles.banner} ${styles.toneInfo}`}>
          <Icon name="info" size="medium" />
          <p className={styles.bannerText}>
            The demo needs no admin access. Every demo step runs on the public pages.
          </p>
        </div>
        {signedIn ? (
          <p className={styles.helper} data-signed-in="">
            You are already signed in. <Link to={ROUTES.runs}>Go to Runs</Link>
          </p>
        ) : null}
        <form className={styles.form} onSubmit={submit} noValidate>
          <label className={styles.field}>
            <span>Admin email</span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={emailBad}
              aria-describedby={emailBad ? "as-email-err" : undefined}
              disabled={busy}
            />
          </label>
          {emailBad ? (
            <span id="as-email-err" role="alert" className={styles.fieldError}>
              <Icon name="error" size="small" />
              {SIGN_IN_TEXTS.emailRequired}
            </span>
          ) : null}
          <div className={styles.field}>
            <label htmlFor="as-password">Password</label>
            <span className={styles.passwordWrap}>
              <input
                id="as-password"
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                className={styles.passwordInput}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={passwordBad}
                aria-describedby={passwordBad ? "as-password-err" : undefined}
                disabled={busy}
              />
              {/* Task B's toggle: a constant name; its pressed state says whether the value shows.
                  The word "Show" stands in for Task B's eye glyph, which the icon subset lacks. */}
              <button
                type="button"
                className={styles.toggle}
                aria-label="Show password"
                aria-pressed={showPassword}
                aria-controls="as-password"
                onClick={() => setShowPassword((shown) => !shown)}
              >
                Show
              </button>
            </span>
          </div>
          {passwordBad ? (
            <span id="as-password-err" role="alert" className={styles.fieldError}>
              <Icon name="error" size="small" />
              {SIGN_IN_TEXTS.passwordRequired}
            </span>
          ) : null}
          {phase.kind === "refused" ? (
            <div
              role="alert"
              className={`${styles.banner} ${REFUSAL[phase.why].tone}`}
              data-refusal={phase.why}
            >
              <Icon name={REFUSAL[phase.why].icon} size="medium" />
              <p className={styles.bannerText}>{REFUSAL[phase.why].text}</p>
            </div>
          ) : null}
          {busy ? (
            <div role="status" aria-live="polite" className={styles.sending}>
              <div className={styles.progress} aria-hidden="true">
                <div className={styles.indicator} />
              </div>
              <span>Signing you in…</span>
            </div>
          ) : null}
          <button type="submit" className={styles.filled} disabled={busy}>
            <Icon name="login" size="medium" />
            Sign in
          </button>
        </form>
        <p className={styles.provenance}>
          <Icon name="lock" size="small" />
          <span className={styles.provenanceText}>
            Only users on the admin list can run anything (Cognito email and password, no self
            sign-up). Admin sits at the end of the main navigation.
          </span>
        </p>
      </div>
    </section>
  );
}
