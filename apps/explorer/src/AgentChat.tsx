import { useState } from "react";
import { askAgent, type AgentReply } from "./api.js";

const EXAMPLES = [
  "Which properties in Travis County within five miles of Pflugerville have roofs older than 15 years?",
  "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?",
  "Which properties within 3 miles of Austin are owned by out-of-state owners and have roofs older than 20 years?",
];

type Msg = { role: "user" | "assistant"; content: string; reply?: AgentReply };

function Markdownish({ text }: { text: string }) {
  return <pre className="answer">{text}</pre>;
}

export function AgentChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState(EXAMPLES[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setInput("");
    try {
      const reply = await askAgent(q, history);
      setMsgs((m) => [...m, { role: "assistant", content: reply.answer, reply }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Ask the property-intelligence agent</h2>
        <p className="muted">
          The agent answers only from the DuckDB snapshot through the same tools exposed over MCP,
          and cites prop_ids, permit numbers and sources.
        </p>
        <div className="examples">
          {EXAMPLES.map((e) => (
            <button key={e} className="link" onClick={() => setInput(e)}>
              {e}
            </button>
          ))}
        </div>
      </section>
      {msgs.map((m, i) => (
        <section key={i} className={`card msg ${m.role}`}>
          <div className="muted small">
            {m.role === "user"
              ? "You"
              : `Agent · snapshot ${m.reply?.snapshotRunId ?? ""} · ${m.reply?.steps ?? 0} steps`}
          </div>
          {m.role === "user" ? <p>{m.content}</p> : <Markdownish text={m.content} />}
          {m.reply && m.reply.toolCalls.length > 0 && (
            <details>
              <summary>Tool calls ({m.reply.toolCalls.length})</summary>
              <pre className="mono small">{JSON.stringify(m.reply.toolCalls, null, 2)}</pre>
            </details>
          )}
        </section>
      ))}
      {error && <p className="error">{error}</p>}
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} />
        <button className="primary" disabled={busy}>
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>
    </div>
  );
}
