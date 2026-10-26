// A-14 T014 (agent-design.md § "ash" > "getModel() / provider-switch design"; research.md
// "no embeddings" / provider decisions; constitution VI, AD-20): the ONLY `AI_PROVIDER` read
// site under apps/api/src/agent/. Every other file in this directory calls `getModel()` and
// never imports a provider SDK directly (enforced by apps/api/test/agent-model.test.ts's
// static-analysis check). Both branches come from the Vercel AI SDK (`ai` +
// `@ai-sdk/amazon-bedrock`), never `@aws-sdk/client-bedrock-runtime`, `@anthropic-ai/sdk` or
// `openai` (constitution VI).
//
// Region: never configured here. `@ai-sdk/amazon-bedrock`'s `bedrock()` reads `AWS_REGION` from
// the Lambda runtime by default (same P0-18 rule as apps/api/src/config.ts), so the agent
// Lambda's environment carries no region literal either; `AI_PROVIDER=bedrock` expects an
// `eu.` cross-region inference profile id (the project's region, from config), reachable once the Lambda
// itself runs in that region.
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { gateway } from "ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";

export type AiProvider = "bedrock" | "gateway";

/** `AI_PROVIDER=bedrock` default model id: the EU cross-region inference profile. */
export const DEFAULT_BEDROCK_MODEL_ID = "eu.anthropic.claude-sonnet-4-6";
/** `AI_PROVIDER=gateway` default model id (Vercel AI Gateway catalog id). */
export const DEFAULT_GATEWAY_MODEL_ID = "anthropic/claude-sonnet-4.6";

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Resolves the Vercel AI SDK model for the active provider. `AI_PROVIDER` unset or `"bedrock"`
 * (the default, per plan.md/CLAUDE.md) returns a Bedrock-backed model; `"gateway"` returns a
 * Gateway-backed model (the fallback for Claude, and the only path for embeddings). Any other
 * value throws, naming the bad value, so a typo is never silently defaulted to a provider nobody
 * asked for. The throw happens per request (this runs inside `agent.ask`), where it is caught and
 * returned as a `failed` outcome, not at cold start.
 */
export function getModel(env: EnvSource = process.env): LanguageModelV4 {
  const provider = env.AI_PROVIDER ?? "bedrock";
  if (provider === "bedrock") {
    return bedrock(env.BEDROCK_MODEL_ID ?? DEFAULT_BEDROCK_MODEL_ID);
  }
  if (provider === "gateway") {
    return gateway(env.AI_GATEWAY_MODEL_ID ?? DEFAULT_GATEWAY_MODEL_ID);
  }
  throw new Error(`AI_PROVIDER must be "bedrock" or "gateway", got: ${JSON.stringify(provider)}`);
}
