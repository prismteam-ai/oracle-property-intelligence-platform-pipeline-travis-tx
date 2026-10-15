import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool, type LanguageModel, type ToolSet } from "ai";
import { z } from "zod";
import type { Snapshot } from "./snapshot.js";
import { TOOLS } from "./tools.js";

export const AGENT_SYSTEM_PROMPT = `You are the Oracle property-intelligence agent for Travis County, Texas, supporting roofing lead discovery.
Rules:
- Answer ONLY from tool results. Never invent properties, permits, contractors, ratings or dates.
- For "near/within X miles of <city>" questions call the radius tools with place=<city> and radiusMiles=X.
- Explain your reasoning: the criteria used, how roof age was determined (roof_age_basis, evidence permit), how "open" is defined, and the counts returned versus matched.
- Cite evidence for every listed item: prop_id and/or permit_number, plus source (source_url or parcel_source_url) and the snapshot run id.
- Clearly state assumptions and missing data (e.g. BBB rating unavailable, deed dates not yet loaded, properties without roof evidence excluded).
- Prefer concise markdown tables for result lists (max ~15 rows) and mention how to get the rest.`;

export function createModel(env: NodeJS.ProcessEnv = process.env): LanguageModel {
  const provider = (env.ORACLE_LLM_PROVIDER || "bedrock").toLowerCase();
  if (provider === "bedrock") {
    const bedrock = createAmazonBedrock({
      region: env.ORACLE_BEDROCK_REGION || env.AWS_REGION || "us-east-2",
    });
    return bedrock(env.ORACLE_LLM_MODEL || "anthropic.claude-opus-5-5");
  }
  if (provider === "anthropic") {
    return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(
      env.ORACLE_LLM_MODEL || "claude-opus-5-5",
    );
  }
  if (provider === "openai") {
    return createOpenAI({ apiKey: env.OPENAI_API_KEY })(env.ORACLE_LLM_MODEL || "gpt-5-mini");
  }
  throw new Error(`Unsupported ORACLE_LLM_PROVIDER ${provider}`);
}

export function agentTools(snapshot: Snapshot, trace: { tool: string; input: unknown }[]): ToolSet {
  const set: ToolSet = {};
  for (const t of TOOLS) {
    set[t.name] = tool({
      description: t.description,
      inputSchema: t.input as z.ZodType<Record<string, unknown>>,
      execute: async (input: unknown) => {
        trace.push({ tool: t.name, input });
        try {
          return await t.run(snapshot, input);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }
  return set;
}

export const agentRequestSchema = z.object({
  question: z.string().min(3).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) }))
    .max(20)
    .default([]),
});

export type AgentAnswer = {
  answer: string;
  toolCalls: { tool: string; input: unknown }[];
  snapshotRunId: string | null;
  steps: number;
};

export async function askAgent(
  snapshot: Snapshot,
  req: z.infer<typeof agentRequestSchema>,
  model: LanguageModel = createModel(),
): Promise<AgentAnswer> {
  const trace: { tool: string; input: unknown }[] = [];
  const result = await generateText({
    model,
    system: `${AGENT_SYSTEM_PROMPT}\nSnapshot run id: ${snapshot.source.runId ?? "unknown"}. Today: ${new Date().toISOString().slice(0, 10)}.`,
    messages: [...req.history, { role: "user" as const, content: req.question }],
    tools: agentTools(snapshot, trace),
    stopWhen: stepCountIs(8),
    ...(process.env.ORACLE_AGENT_TIMEOUT_MS
      ? { abortSignal: AbortSignal.timeout(Number(process.env.ORACLE_AGENT_TIMEOUT_MS)) }
      : {}),
  });
  return {
    answer: result.text,
    toolCalls: trace,
    snapshotRunId: snapshot.source.runId,
    steps: result.steps.length,
  };
}
