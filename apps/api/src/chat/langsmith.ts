import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as ai from 'ai';
import { Client } from 'langsmith/client';
import { createLangSmithProviderOptions, wrapAISDK } from 'langsmith/experimental/vercel';

/**
 * The kit's LangSmith facade (build-ai-agents, rules/observability-langsmith-telemetry.md): traced `ToolLoopAgent`,
 * `flush()` before returning, and graceful degradation (no key, a failed secret read or a wrapper error gives the plain
 * AI SDK, never a failed turn). The key is the Secrets Manager secret named by LANGSMITH_API_KEY_SECRET_ID, read at run
 * time and cached for the instance, never a Lambda environment variable (decisions.md section 21); a local run may set
 * LANGSMITH_API_KEY instead. Person fields are hidden in every traced input and output (decisions.md section 20).
 */
export interface LangSmithFacade {
  tracingEnabled: boolean;
  ToolLoopAgent: typeof ai.ToolLoopAgent;
  /** `providerOptions.langsmith` for one turn: the session (thread), run metadata and the run name. */
  providerOptions: (
    metadata: Record<string, string | number | boolean>,
  ) => Record<string, ai.JSONValue>;
  /** Sends the pending trace batches, waiting at most `maxMs`; never throws. */
  flush: (maxMs: number) => Promise<void>;
}

export const PLAIN_FACADE: LangSmithFacade = {
  tracingEnabled: false,
  ToolLoopAgent: ai.ToolLoopAgent,
  providerOptions: () => ({}),
  flush: async () => {},
};

/** Keys whose values never reach a trace: owner and contact fields (decisions.md section 20, "Personal data"). */
const PERSON_KEYS = new Set([
  'owner_name',
  'mailing_address',
  'applicant',
  'phone',
  'contractor_phone',
]);
const PERSON_IN_JSON =
  /"(owner_name|mailing_address|applicant|phone|contractor_phone)"\s*:\s*("(?:[^"\\]|\\.)*"|\{[^{}]*\}|null)/g;

/**
 * The person values (owner names, mailing lines, phones) the tools returned in the current turn, so they are hidden
 * wherever they appear in traced text, the model's answer included. An instance serves one turn at a time; the handler
 * clears the set after each turn's flush.
 */
const personValues = new Set<string>();
/** The client-sent history of the current turn: hidden in traces as hashes (review S4). */
const historyValues = new Map<string, string>();
export function registerHistory(contents: string[]): void {
  for (const c of contents)
    if (c.trim().length >= 4)
      historyValues.set(
        c,
        `[earlier message sha256:${createHash('sha256').update(c).digest('hex').slice(0, 16)}]`,
      );
}
export function registerPersonValues(values: (string | null | undefined)[]): void {
  for (const v of values)
    if (typeof v === 'string' && v.trim().length >= 4) personValues.add(v.trim());
}
export function clearPersonValues(): void {
  personValues.clear();
  historyValues.clear();
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Deep copy with person fields replaced, inside objects and inside JSON text (tool results travel as text). */
export function hidePersonFields(v: unknown): unknown {
  if (typeof v === 'string') {
    let out = historyValues.get(v) ?? v;
    for (const [h, label] of historyValues)
      if (h !== v && out.includes(h)) out = out.split(h).join(label);
    if (out.includes('"')) out = out.replace(PERSON_IN_JSON, '"$1":"[hidden]"');
    for (const p of personValues)
      if (out.includes(p)) out = out.replace(new RegExp(escapeRe(p), 'g'), '[hidden]');
    return out;
  }
  if (Array.isArray(v)) return v.map(hidePersonFields);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    const isContractor = 'contractor_attribution_key' in v;
    for (const [k, x] of Object.entries(v)) {
      if (x !== null && (PERSON_KEYS.has(k) || (isContractor && k === 'address')))
        o[k] = '[hidden]';
      else o[k] = hidePersonFields(x);
    }
    return o;
  }
  return v;
}

export interface LangSmithEnv {
  LANGSMITH_TRACING?: string;
  LANGSMITH_PROJECT?: string;
  LANGSMITH_ENDPOINT?: string;
  LANGSMITH_API_KEY?: string;
  LANGSMITH_API_KEY_SECRET_ID?: string;
  AWS_REGION?: string;
}

export type SecretReader = (secretId: string, region: string | undefined) => Promise<string>;

/** Secrets Manager GetSecretValue with the SDK the Lambda base image ships (createRequire, as for the SSM client). */
export const readSecretFromSecretsManager: SecretReader = async (secretId, region) => {
  const { SecretsManagerClient, GetSecretValueCommand } = createRequire(import.meta.url)(
    '@aws-sdk/client-secrets-manager',
  ) as typeof import('@aws-sdk/client-secrets-manager');
  const r = await new SecretsManagerClient({
    ...(region ? { region } : {}),
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 1000, requestTimeout: 1000 },
  }).send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = r.SecretString?.trim();
  if (!value) throw new Error('the LangSmith secret is empty');
  return value;
};

async function build(env: LangSmithEnv, readSecret: SecretReader): Promise<LangSmithFacade> {
  if ((env.LANGSMITH_TRACING ?? 'true') !== 'true') return PLAIN_FACADE;
  let key = env.LANGSMITH_API_KEY?.trim();
  if (!key && env.LANGSMITH_API_KEY_SECRET_ID)
    key = await readSecret(env.LANGSMITH_API_KEY_SECRET_ID, env.AWS_REGION);
  if (!key) return PLAIN_FACADE;
  const project = env.LANGSMITH_PROJECT ?? 'staraptor-agent';
  // The wrapper reads the project and endpoint from the environment.
  process.env.LANGSMITH_PROJECT = project;
  process.env.LANGSMITH_TRACING = 'true';
  if (env.LANGSMITH_ENDPOINT) process.env.LANGSMITH_ENDPOINT = env.LANGSMITH_ENDPOINT;
  const client = new Client({
    apiKey: key,
    ...(env.LANGSMITH_ENDPOINT ? { apiUrl: env.LANGSMITH_ENDPOINT } : {}),
    hideInputs: (i) => hidePersonFields(i) as Record<string, unknown>,
    hideOutputs: (o) => hidePersonFields(o) as Record<string, unknown>,
  });
  const wrapped = wrapAISDK(ai, { client, project_name: project });
  return {
    tracingEnabled: true,
    ToolLoopAgent:
      (wrapped.ToolLoopAgent as typeof ai.ToolLoopAgent | undefined) ?? ai.ToolLoopAgent,
    providerOptions: (metadata) =>
      createLangSmithProviderOptions<typeof ai.generateText>({
        name: 'staraptor-agent turn',
        metadata,
      }),
    flush: async (maxMs) => {
      if (maxMs <= 0) return;
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        client.awaitPendingTraceBatches().catch(() => undefined),
        new Promise<void>((r) => (timer = setTimeout(r, maxMs))),
      ]);
      clearTimeout(timer);
    },
  };
}

/**
 * One facade per instance. A failure to build it (secret unreadable, wrapper error) gives the plain AI SDK: tracing is
 * off for that instance and the turn never fails (review S3). `retryMs` can let a later turn try again.
 */
export function langSmithLoader(
  env: LangSmithEnv,
  readSecret: SecretReader = readSecretFromSecretsManager,
  onError: (e: unknown) => void = () => {},
  retryMs = Infinity,
  now: () => number = Date.now,
): () => Promise<LangSmithFacade> {
  let cached: Promise<LangSmithFacade> | null = null;
  let failedAt = 0;
  return () => {
    if (cached && !(failedAt && now() - failedAt > retryMs)) return cached;
    failedAt = 0;
    cached = build(env, readSecret).catch((e) => {
      onError(e);
      failedAt = now();
      return PLAIN_FACADE;
    });
    return cached;
  };
}
