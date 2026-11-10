import type { Row, ToolResult } from "@travis-oracle/query-core";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AgentReply {
  message: { content: string; tool_calls: ToolCall[] };
  neurons: number;
  cached: boolean;
  budget: { used: number; limit: number };
  model: string;
}

export interface AgentBackend {
  next(messages: ChatMessage[]): Promise<AgentReply>;
}

export interface AgentTools {
  run(name: string, input: unknown): Promise<ToolResult>;
}

export type AgentEvent =
  | { kind: "tool_call"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; id: string; name: string; result: ToolResult }
  | { kind: "tool_error"; id: string; name: string; message: string }
  | { kind: "answer"; content: string };

export interface AgentDependencies {
  backend: AgentBackend;
  tools: AgentTools;
  onEvent: (event: AgentEvent) => void;
}

export interface AgentOutcome {
  answer: string;
  messages: ChatMessage[];
  evidence: ToolResult[];
  neurons: number;
}

const MAX_MODEL_CALLS = 6;
const HISTORY_MESSAGES = 16;
const MAX_CONVERSATION_MESSAGES = 40;
const ROWS_FOR_MODEL = 10;
const RELATED_ROWS_FOR_MODEL = 5;
const HIDDEN_FROM_MODEL = new Set(["latitude", "longitude", "source_run_id"]);

export async function askAgent(
  question: string,
  history: readonly ChatMessage[],
  { backend, tools, onEvent }: AgentDependencies,
): Promise<AgentOutcome> {
  const messages: ChatMessage[] = [...recentHistory(history), { role: "user", content: question }];
  const evidence: ToolResult[] = [];
  let neurons = 0;

  const runCall = async (call: ToolCall): Promise<unknown> => {
    const { id, function: requested } = call;
    let input: unknown;
    try {
      input = JSON.parse(requested.arguments || "{}");
    } catch {
      const message = `The arguments for ${requested.name} were not valid JSON.`;
      onEvent({ kind: "tool_error", id, name: requested.name, message });
      return { error: message };
    }
    onEvent({ kind: "tool_call", id, name: requested.name, input });
    try {
      const result = await tools.run(requested.name, input);
      evidence.push(result);
      onEvent({ kind: "tool_result", id, name: requested.name, result });
      return forModel(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent({ kind: "tool_error", id, name: requested.name, message });
      return { error: message };
    }
  };

  for (
    let call = 0;
    call < MAX_MODEL_CALLS && messages.length <= MAX_CONVERSATION_MESSAGES;
    call += 1
  ) {
    const reply = await backend.next(messages);
    neurons += reply.neurons;
    const { content, tool_calls: toolCalls } = reply.message;
    if (toolCalls.length === 0) {
      messages.push({ role: "assistant", content });
      onEvent({ kind: "answer", content });
      return { answer: content, messages, evidence, neurons };
    }
    messages.push({ role: "assistant", content, tool_calls: toolCalls });
    for (const toolCall of toolCalls) {
      const output = await runCall(toolCall);
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(output) });
    }
  }

  const answer = `I could not finish within ${MAX_MODEL_CALLS} steps. The evidence gathered so far is below.`;
  messages.push({ role: "assistant", content: answer });
  onEvent({ kind: "answer", content: answer });
  return { answer, messages, evidence, neurons };
}

function recentHistory(history: readonly ChatMessage[]): ChatMessage[] {
  const start = history.findIndex(
    (message, index) => message.role === "user" && history.length - index <= HISTORY_MESSAGES,
  );
  return start === -1 ? [] : history.slice(start);
}

function forModel(result: ToolResult): unknown {
  const hidden = result.rows.length - ROWS_FOR_MODEL;
  return {
    tool: result.tool,
    totalMatches: result.totalMatches,
    summary: result.summary,
    center: result.center,
    rows: result.rows.slice(0, ROWS_FOR_MODEL).map(essentials),
    note:
      hidden > 0 ? `${hidden} more rows not shown; totalMatches counts every match.` : undefined,
    related: result.related?.slice(0, RELATED_ROWS_FOR_MODEL).map(essentials),
    dataset: { manifestCid: result.dataset.manifestCid, rootCid: result.dataset.rootCid },
  };
}

function essentials(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).filter(([column]) => !HIDDEN_FROM_MODEL.has(column)),
  );
}
