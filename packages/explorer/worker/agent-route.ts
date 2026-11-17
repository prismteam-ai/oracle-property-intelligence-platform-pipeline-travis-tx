import { z } from "zod";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] | undefined }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  temperature: number;
  max_tokens: number;
}

export interface ChatCompletion {
  choices: { message: { content?: string | null; tool_calls?: ToolCall[] | null } }[];
  usage?: { neurons?: number };
}

export type ChatModel = (request: ChatCompletionRequest) => Promise<ChatCompletion>;

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>;
}

export interface AgentRouteConfig {
  model: ChatModel;
  modelName: string;
  store: KeyValueStore;
  app: string;
  dailyNeurons: number;
  today: () => string;
  systemPrompt: string;
  tools: ToolDefinition[];
}

const MAX_MESSAGES = 40;
const MAX_USER_CHARS = 2_000;
const MAX_ASSISTANT_CHARS = 8_000;
const MAX_TOOL_CHARS = 16_000;
const MAX_TOOL_CALLS = 8;
const MAX_IDENTIFIER_CHARS = 100;
const MAX_ARGUMENT_CHARS = 4_000;
const MAX_OUTPUT_TOKENS = 1_500;
const TEMPERATURE = 0;
const NEURONS_WHEN_UNREPORTED = 25;
const SECONDS_PER_DAY = 86_400;
const CACHE_TTL_SECONDS = 7 * SECONDS_PER_DAY;
const BUDGET_TTL_SECONDS = 2 * SECONDS_PER_DAY;
const CACHE_KEY_VERSION = "agent:v2";
const MARKUP_BLOCKS = /<(think|search|tool_call|function_call|tool_response)>[\s\S]*?<\/\1>/g;
const STRAY_TAGS = /<\/?[a-z_]+>/g;

const HttpStatus = {
  BadRequest: 400,
  TooManyRequests: 429,
  BadGateway: 502,
} as const;

const toolCall = z.object({
  id: z.string().max(MAX_IDENTIFIER_CHARS),
  type: z.literal("function"),
  function: z.object({
    name: z.string().max(MAX_IDENTIFIER_CHARS),
    arguments: z.string().max(MAX_ARGUMENT_CHARS),
  }),
});

const conversation = z.object({
  messages: z
    .array(
      z.discriminatedUnion("role", [
        z.object({ role: z.literal("user"), content: z.string().min(1).max(MAX_USER_CHARS) }),
        z.object({
          role: z.literal("assistant"),
          content: z.string().max(MAX_ASSISTANT_CHARS).nullable(),
          tool_calls: z.array(toolCall).max(MAX_TOOL_CALLS).optional(),
        }),
        z.object({
          role: z.literal("tool"),
          tool_call_id: z.string().max(MAX_IDENTIFIER_CHARS),
          content: z.string().max(MAX_TOOL_CHARS),
        }),
      ]),
    )
    .min(1)
    .max(MAX_MESSAGES),
});

export class AgentRoute {
  constructor(private readonly config: AgentRouteConfig) {}

  async handle(request: Request): Promise<Response> {
    const parsed = conversation.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
      return Response.json(
        { error: `Invalid conversation: ${z.prettifyError(parsed.error)}` },
        { status: HttpStatus.BadRequest },
      );
    }
    const { messages } = parsed.data;
    const { modelName, dailyNeurons, store } = this.config;

    const { systemPrompt, tools } = this.config;
    const cacheKey = `${CACHE_KEY_VERSION}:${await sha256(
      JSON.stringify({ modelName, systemPrompt, tools, messages }),
    )}`;
    const used = await this.neuronsUsed();
    const cached = await store.get(cacheKey);
    if (cached) {
      return Response.json({
        message: JSON.parse(cached),
        neurons: 0,
        budget: { used, limit: dailyNeurons },
        cached: true,
        model: modelName,
      });
    }

    if (used >= dailyNeurons) {
      return Response.json(
        {
          error: `The daily Workers AI budget of this app (${dailyNeurons} free neurons) is spent. It resets at 00:00 UTC; questions asked before still answer from the cache.`,
        },
        { status: HttpStatus.TooManyRequests },
      );
    }

    let completion: ChatCompletion;
    try {
      completion = await this.config.model({
        messages: [{ role: "system", content: this.config.systemPrompt }, ...messages],
        tools: this.config.tools,
        temperature: TEMPERATURE,
        max_tokens: MAX_OUTPUT_TOKENS,
      });
    } catch (error) {
      return Response.json(
        { error: `Workers AI failed: ${error instanceof Error ? error.message : String(error)}` },
        { status: HttpStatus.BadGateway },
      );
    }

    const reply = completion.choices[0]?.message;
    const message = {
      content: (reply?.content ?? "").replace(MARKUP_BLOCKS, "").replace(STRAY_TAGS, "").trim(),
      tool_calls: reply?.tool_calls ?? [],
    };
    const neurons = completion.usage?.neurons ?? NEURONS_WHEN_UNREPORTED;
    const total = used + neurons;
    await store.put(this.budgetKey(), String(total), { expirationTtl: BUDGET_TTL_SECONDS });
    await store.put(cacheKey, JSON.stringify(message), { expirationTtl: CACHE_TTL_SECONDS });

    return Response.json({
      message,
      neurons,
      budget: { used: total, limit: dailyNeurons },
      cached: false,
      model: modelName,
    });
  }

  async budget(): Promise<Response> {
    return Response.json({
      date: this.config.today(),
      used: await this.neuronsUsed(),
      limit: this.config.dailyNeurons,
      model: this.config.modelName,
    });
  }

  private async neuronsUsed(): Promise<number> {
    return Number((await this.config.store.get(this.budgetKey())) ?? 0);
  }

  private budgetKey(): string {
    return `neurons:${this.config.today()}:${this.config.app}`;
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
