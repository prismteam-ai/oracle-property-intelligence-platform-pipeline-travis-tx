import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';

/**
 * Bedrock prompt caching, the kit's helper (build-ai-agents, rules/implementation-bedrock-prompt-caching.md): a cache
 * point on the first system message (the per-deploy prompt with its run summary, after the tool definitions) and on the
 * last non-system message, so each step of a turn reads the prefix the step before it wrote. Cache read and write tokens
 * are reported to `onUsage` (the turn's log line and metrics) and the metadata keys go to LangSmith.
 */
type Params = Parameters<NonNullable<LanguageModelMiddleware['transformParams']>>[0]['params'];
type Prompt = Params['prompt'];
type PromptMessage = Prompt[number];
type WrappedModel = Parameters<typeof wrapLanguageModel>[0]['model'];

const BEDROCK_CACHE_POINT = { type: 'default' as const };

export const BEDROCK_PROMPT_CACHE_METADATA = {
  bedrock_prompt_caching: true,
  bedrock_prompt_cache_strategy: 'system_and_last_non_system',
  bedrock_prompt_cache_ttl: 'default',
  bedrock_prompt_cache_tool_config: false,
} as const;

function withCachePoint(message: PromptMessage): PromptMessage {
  const providerOptions = message.providerOptions ?? {};
  const bedrockOptions =
    typeof providerOptions.bedrock === 'object' && providerOptions.bedrock !== null
      ? providerOptions.bedrock
      : {};
  return {
    ...message,
    providerOptions: {
      ...providerOptions,
      bedrock: { ...bedrockOptions, cachePoint: BEDROCK_CACHE_POINT },
    },
  } as PromptMessage;
}

export function applyBedrockPromptCaching(prompt: Prompt): {
  prompt: Prompt;
  cachePointsAdded: number;
} {
  const targets = new Set<number>();
  const firstSystem = prompt.findIndex((m) => m.role === 'system');
  if (firstSystem >= 0) targets.add(firstSystem);
  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    if (prompt[i]?.role !== 'system') {
      targets.add(i);
      break;
    }
  }
  if (targets.size === 0) return { prompt, cachePointsAdded: 0 };
  return {
    prompt: prompt.map((m, i) => (targets.has(i) ? withCachePoint(m) : m)) as Prompt,
    cachePointsAdded: targets.size,
  };
}

export interface CacheUsage {
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function withBedrockPromptCaching<M extends WrappedModel>(
  model: M,
  onUsage: (u: CacheUsage) => void = () => {},
): WrappedModel {
  const report = (
    usage: { inputTokens?: { cacheRead?: number; cacheWrite?: number } } | undefined,
  ) => {
    const cacheReadTokens = usage?.inputTokens?.cacheRead ?? 0;
    const cacheWriteTokens = usage?.inputTokens?.cacheWrite ?? 0;
    if (cacheReadTokens > 0 || cacheWriteTokens > 0) onUsage({ cacheReadTokens, cacheWriteTokens });
  };
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v4',
      transformParams: async ({ params }) => ({
        ...params,
        prompt: applyBedrockPromptCaching(params.prompt).prompt,
      }),
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate();
        report(result.usage);
        return result;
      },
      wrapStream: async ({ doStream }) => {
        const result = await doStream();
        const stream = result.stream.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              if (chunk.type === 'finish') report(chunk.usage);
              controller.enqueue(chunk);
            },
          }),
        );
        return { ...result, stream };
      },
    },
  });
}
