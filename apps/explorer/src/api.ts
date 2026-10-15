export type Row = Record<string, unknown>;

const API_BASE =
  (import.meta.env.VITE_ORACLE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export async function callTool<T = Row>(name: string, input: Row = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/api/tools/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export type AgentReply = {
  answer: string;
  toolCalls: { tool: string; input: unknown }[];
  snapshotRunId: string | null;
  steps: number;
};

export async function askAgent(
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<AgentReply> {
  const res = await fetch(`${API_BASE}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, history }),
  });
  const body = (await res.json()) as AgentReply & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export const GATEWAYS = ["https://ipfs.io", "https://dweb.link"];

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return /^-?\d+(\.\d+)?$/.test(s) && s.length < 16 ? Number(s).toLocaleString("en-US") : s;
}
