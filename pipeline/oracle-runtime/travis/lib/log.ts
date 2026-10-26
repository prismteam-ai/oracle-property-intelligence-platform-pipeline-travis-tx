// T009: the one JSON logger for pipeline/oracle-runtime. It is the only file allowed to
// write to the console (eslint `no-console`). Every string that passes through it is
// redacted: credential URLs, token-like query values, bearer tokens, registered secrets
// and absolute home paths (constitution XII).

const REDACTED = "[REDACTED]";

/** scheme://user:pass@host or scheme://user@host -> scheme://[REDACTED]@host */
const USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi;
/** token-like query parameters, including Socrata's $$app_token */
const TOKEN_PARAM =
  /([?&](?:\$\$)?(?:app_token|token|access_token|api_key|apikey|key|secret|password|sig|signature)=)[^&#\s"]*/gi;
const BEARER = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/g;
/**
 * Absolute home paths (macOS, Linux, Windows). An http(s) URL is matched first and kept, so
 * a path segment inside a URL (for example `https://x.test/portal/home/newrequest`) is never
 * taken for a home directory.
 */
const HOME_PATH_OR_URL =
  /(https?:\/\/[^\s"'<>]+)|(?:\/Users|\/home)\/[^/\s"']+|[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\\s"']+/g;

/** True when `text` holds an absolute home path outside any http(s) URL. */
export function containsHomePath(text: string): boolean {
  for (const match of text.matchAll(HOME_PATH_OR_URL)) {
    if (match[1] === undefined) return true;
  }
  return false;
}

/** Replaces every absolute home path outside an http(s) URL with `~`. */
export function replaceHomePaths(text: string): string {
  return text.replace(HOME_PATH_OR_URL, (_whole, url: string | undefined) => url ?? "~");
}

export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join(REDACTED);
  }
  return replaceHomePaths(
    out
      .replace(USERINFO, `$1${REDACTED}@`)
      .replace(TOKEN_PARAM, `$1${REDACTED}`)
      .replace(BEARER, `$1 ${REDACTED}`),
  );
}

/** Redact every string inside a JSON-like value. */
export function redactValue(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") return redact(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, secrets)]));
  }
  return value;
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type LogSink = (line: string) => void;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const defaultSink: LogSink = (line) => {
  console.log(line);
};

export function createLogger(sink: LogSink = defaultSink, secrets: readonly string[] = []): Logger {
  const write = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    const entry = redactValue({ ts: new Date().toISOString(), level, event, ...fields }, secrets);
    sink(JSON.stringify(entry));
  };
  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}

export const log: Logger = createLogger();
