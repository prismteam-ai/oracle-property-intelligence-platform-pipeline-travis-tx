import { readFileSync } from 'node:fs';
import { z } from 'zod';

const rate = z.object({ rate: z.number().positive(), burst: z.number().int().positive() });

/**
 * The single operator-facing configuration of the CDK app (section 21: "One Zod-validated CDK config").
 * Loaded from apps/api/cdk/config.json (gitignored); config.example.json is the committed template.
 */
export const ConfigSchema = z.object({
  projectName: z.string().min(1).default('travis-property-intelligence'),
  account: z.string().regex(/^\d{12}$/, 'account must be a 12-digit AWS account id'),
  region: z.literal('us-east-2'),
  /** US cross-region inference profile (decisions.md section 32: Sonnet 4.6 won the golden set; 5.x is denied on the account). */
  bedrockModelId: z.string().min(1).default('us.anthropic.claude-sonnet-4-6'),
  /** Regions the cross-region inference profile routes to (their foundation-model ARNs are granted). */
  bedrockRoutingRegions: z
    .array(z.string().min(1))
    .min(1)
    .default(['us-east-1', 'us-east-2', 'us-west-2']),
  /** Foundation model id behind the profile; derived from bedrockModelId (profile prefix stripped) when absent. */
  bedrockFoundationModelId: z.string().min(1).optional(),
  memoryMb: z
    .object({
      api: z.number().int().min(512).max(10240).default(3008),
      chat: z.number().int().min(512).max(10240).default(3008),
    })
    .default({ api: 3008, chat: 3008 }),
  duckdb: z
    .object({
      memoryLimit: z.string().default('2GB'),
      threads: z.number().int().min(1).max(6).default(2),
    })
    .default({ memoryLimit: '2GB', threads: 2 }),
  /** 0 = unreserved. Set R > 0 only after reading `aws lambda get-account-settings` (section 21, Concurrency). */
  chatReservedConcurrency: z.number().int().min(0).max(5).default(0),
  /** Secrets Manager secret (plain string) holding the LangSmith API key, created out of band (decisions.md section 21). */
  langsmithSecretName: z.string().min(1).default('staraptor-agent/langsmith-api-key'),
  /** LangSmith project, the runtime name (decisions.md section 20, "Observability"). */
  langsmithProject: z.string().min(1).default('staraptor-agent'),
  throttle: z.object({
    stage: rate,
    routes: z.record(z.string(), rate),
    mcp: z.record(z.string(), rate),
    chat: z.object({
      maxOutputTokens: z.number().int().positive(),
      turnDeadlineSeconds: z.number().positive().max(28),
    }),
  }),
  /** Invocations of the chat function per UTC day above which the kill switch is set. */
  dailyChatRequestLimit: z.number().int().positive().default(200),
  /** Bedrock input plus output tokens of chat per UTC day above which the kill switch is set. */
  dailyChatTokenLimit: z.number().int().positive().default(5_000_000),
  /** Invocations of the API function (REST and MCP) per UTC day above which its kill switch is set. */
  dailyApiRequestLimit: z.number().int().positive().default(50_000),
  alarmEmails: z.array(z.email()).min(1),
  /** SSM String parameter holding a PagerDuty CloudWatch integration URL; the alarm topic subscribes it over HTTPS. */
  pagerDutyUrlParam: z.string().startsWith('/').optional(),
  /** The TravisApi `ApiBase` output, copied here only as a fallback for `just build-explorer`. */
  viteApiUrl: z.url().optional(),
});

export type TravisConfig = z.infer<typeof ConfigSchema>;

export function parseConfig(raw: unknown): TravisConfig {
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid CDK config:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function loadConfig(path: string): TravisConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `CDK config not found at ${path}. Copy apps/api/cdk/config.example.json to apps/api/cdk/config.json ` +
        `and fill in account, alarmEmails and (after the first TravisApi deploy) viteApiUrl.`,
    );
  }
  return parseConfig(JSON.parse(text));
}

export function foundationModelId(cfg: TravisConfig): string {
  return (
    cfg.bedrockFoundationModelId ?? cfg.bedrockModelId.replace(/^(us|eu|apac|global|us-gov)\./, '')
  );
}

export function limitsJson(cfg: TravisConfig): string {
  return JSON.stringify({
    stage: cfg.throttle.stage,
    routes: cfg.throttle.routes,
    mcp: cfg.throttle.mcp,
    chat: {
      max_output_tokens: cfg.throttle.chat.maxOutputTokens,
      turn_deadline_seconds: cfg.throttle.chat.turnDeadlineSeconds,
    },
  });
}
