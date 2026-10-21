import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@travis/api-client';
import { apiOrigin, useApi } from '../api.js';
import { Cid, Section } from '../components/common.js';
import { CitationChip, Markdown, type MarkdownContext } from '../lib/markdown.js';

interface Evidence {
  kind: string;
  tool_call_id: string;
  property_id: string | null;
  permit_id: string | null;
  contractor_attribution_key: string | null;
  business_record_id: string | null;
  license_record_id: string | null;
  record_cid: string | null;
  source: { dataset?: string; record_id?: string; url?: string } | Record<string, never>;
  unpublished_source: { dataset?: string } | null;
}
interface ChatAnswer {
  outcome: string;
  answer: string;
  assumptions: string[];
  tool_calls: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    status: string;
    total: number | null;
    returned: number | null;
    result_summary: string;
  }[];
  evidence: Evidence[];
  limitations: { source: string; incomplete_reason: string | null; detail: string }[];
  run_id: string;
  manifest_cid: string;
  model_id: string;
  prompt_version: string;
  request_id: string;
}
type Turn =
  { role: 'user'; content: string } | { role: 'assistant'; content: string; reply: ChatAnswer };

const REASON: Record<string, string> = {
  model_unavailable: 'the model is not available to this deployment',
  budget_exhausted: 'the daily model budget is used up',
  circuit_open: 'the model circuit breaker is open after repeated model errors',
};

const OUTCOME: Record<string, { label: string; cls: string }> = {
  answered: { label: 'answered', cls: 'ok' },
  no_matches: { label: 'no matches', cls: '' },
  needs_clarification: { label: 'needs clarification', cls: 'warn' },
  out_of_scope: { label: 'out of scope', cls: 'warn' },
  out_of_county: { label: 'out of county', cls: 'warn' },
  limit_reached: { label: 'limit reached', cls: 'warn' },
  tool_error: { label: 'tool error', cls: 'warn' },
};

export const README_PROMPTS = [
  'Which properties in Travis County within five miles of Austin have roofs older than 15 years?',
  'Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?',
];

const evidenceId = (e: Evidence): { kind: string; id: string } | null => {
  const id =
    e.kind === 'property'
      ? e.property_id
      : e.kind === 'permit'
        ? e.permit_id
        : e.kind === 'contractor'
          ? e.contractor_attribution_key
          : e.kind === 'business'
            ? e.business_record_id
            : e.kind === 'license'
              ? e.license_record_id
              : null;
  return id ? { kind: e.kind, id } : null;
};

const PREWARM_KEY = 'travis-agent-prewarm-at';
const PREWARM_EVERY_MS = 5 * 60_000;
let lastPrewarm = 0;
/** True at most once per 5 minutes (sessionStorage when available, else this page's memory); records the time. */
export function prewarmDue(now = Date.now()): boolean {
  let last = lastPrewarm;
  try {
    last = Math.max(last, Number(sessionStorage.getItem(PREWARM_KEY) ?? 0) || 0);
  } catch {
    /* storage unavailable: the module-level time still applies */
  }
  if (now - last < PREWARM_EVERY_MS) return false;
  lastPrewarm = now;
  try {
    sessionStorage.setItem(PREWARM_KEY, String(now));
  } catch {
    /* ignore */
  }
  return true;
}

const newSession = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 24);

function Reply({ reply, ctx }: { reply: ChatAnswer; ctx: MarkdownContext }) {
  const o = OUTCOME[reply.outcome] ?? { label: reply.outcome, cls: '' };
  const toolName = new Map(reply.tool_calls.map((c) => [c.id, c.name]));
  const records = reply.evidence.filter((e) => e.kind !== 'search_center');
  return (
    <div className="card reply" data-testid="agent-reply">
      <p>
        <span className={`badge ${o.cls}`} data-testid="agent-outcome">
          {o.label}
        </span>
      </p>
      {reply.answer ? (
        <Markdown text={reply.answer} ctx={ctx} />
      ) : (
        <p className="muted">
          No answer text: the server withheld it (an answer that cites only records this turn
          returned is shown; anything else fails closed).
        </p>
      )}
      {reply.assumptions.length ? (
        <>
          <h3>Assumptions</h3>
          <ul className="limitations">
            {reply.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </>
      ) : null}
      {reply.limitations.length ? (
        <>
          <h3>Limitations</h3>
          <ul className="limitations">
            {reply.limitations.map((l, i) => (
              <li key={i}>
                <strong>{l.source}</strong>
                {l.incomplete_reason ? ` (${l.incomplete_reason})` : ''}:{' '}
                <span className="muted">{l.detail}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {records.length ? (
        <>
          <h3>Evidence ({records.length} records from this turn&apos;s tools)</h3>
          <div className="scroll evidence">
            <table data-testid="agent-evidence">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Tool</th>
                  <th>Source</th>
                  <th>Record CID</th>
                </tr>
              </thead>
              <tbody>
                {records.map((e, i) => {
                  const id = evidenceId(e);
                  const src = e.source as { dataset?: string; record_id?: string };
                  return (
                    <tr key={i}>
                      <td>
                        {id ? <CitationChip kind={id.kind} id={id.id} ctx={ctx} /> : e.kind}
                        {e.kind === 'permit' && e.property_id ? (
                          <>
                            {' '}
                            <span className="muted">on</span>{' '}
                            <CitationChip kind="property" id={e.property_id} ctx={ctx} />
                          </>
                        ) : null}
                      </td>
                      <td className="muted">{toolName.get(e.tool_call_id) ?? e.tool_call_id}</td>
                      <td className="muted">
                        {src.dataset ?? e.unpublished_source?.dataset ?? ''}
                        {src.record_id ? ` · ${src.record_id}` : ''}
                      </td>
                      <td>
                        {e.record_cid ? (
                          <a href={`#/verify?cid=${e.record_cid}`} title="Verify this CID">
                            <Cid value={e.record_cid} />
                          </a>
                        ) : (
                          <span className="muted">none (source-backed)</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      <details>
        <summary>
          Tool calls ({reply.tool_calls.length}) · model {reply.model_id}
        </summary>
        <ul className="tool-calls">
          {reply.tool_calls.map((c) => (
            <li key={c.id}>
              <code>{c.name}</code>{' '}
              <span className={`badge ${c.status === 'ok' ? 'ok' : 'warn'}`}>{c.status}</span>{' '}
              <span className="muted">{c.result_summary}</span>
              <pre>{JSON.stringify(c.args)}</pre>
            </li>
          ))}
        </ul>
        <p className="provenance">
          run {reply.run_id} · manifest <Cid value={reply.manifest_cid} /> · prompt{' '}
          {reply.prompt_version} · request {reply.request_id}
        </p>
      </details>
    </div>
  );
}

/** Demo step 9 (agent): stateless grounded chat; the client sends the whole conversation each turn. */
export function Agent() {
  const api = useApi();
  const ctx: MarkdownContext = {
    apiBase: apiOrigin(api),
    explorerOrigin: typeof location === 'undefined' ? '' : location.origin,
  };
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState(README_PROMPTS[0]!);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef(newSession());

  // Prewarm: a request the contract rejects (400) opens the chat function before the first question, at no model cost
  // (decisions.md section 32). At most once per 5 minutes per browser session: each one counts toward the daily
  // invocation limit that sets the kill switch.
  useEffect(() => {
    if (prewarmDue()) void api.agentChat({ messages: [] }).catch(() => undefined);
  }, [api]);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const question = draft.trim();
    if (!question) return;
    const next: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns(next);
    setBusy(true);
    setUnavailable(null);
    setError(null);
    try {
      const reply = (await api.agentChat({
        messages: next.map((t) => ({ role: t.role, content: t.content || '(no answer)' })),
        session_id: session.current,
      })) as unknown as ChatAnswer;
      setTurns([...next, { role: 'assistant', content: reply.answer, reply }]);
      const asked = next.filter((t) => t.role === 'user').length;
      setDraft(asked === 1 && question === README_PROMPTS[0] ? README_PROMPTS[1]! : '');
    } catch (err) {
      if (err instanceof ApiError && err.isAgentUnavailable) {
        const reason = typeof err.detail === 'string' ? err.detail : '';
        setUnavailable(
          `agent_unavailable: the agent cannot answer right now (${REASON[reason] ?? (reason || 'no reason given')}).${err.requestId ? ` Request ${err.requestId}.` : ''}`,
        );
      } else if (err instanceof ApiError && (err.status === 504 || err.status === 503)) {
        setError(
          `${err.status}: the API gateway cut the request at 30 s. Ask again; it is not retried automatically.`,
        );
      } else {
        setError(String(err));
      }
      setTurns(turns);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Agent chat">
      <p className="muted">
        The agent answers from the same tools as the lead queries and the MCP server, and cites the
        records they returned in this turn. The server checks every citation against the evidence
        below and withholds an answer that cites anything else. It is stateless: the whole
        conversation is sent each turn.
      </p>
      <p className="presets">
        {README_PROMPTS.map((p, i) => (
          <button key={p} type="button" onClick={() => setDraft(p)} disabled={busy}>
            README prompt {i + 1}
          </button>
        ))}
        {turns.length ? (
          <button
            type="button"

            disabled={busy}
            onClick={() => {
              setTurns([]);
              session.current = newSession();
              setDraft(README_PROMPTS[0]!);
            }}
          >
            New conversation
          </button>
        ) : null}
      </p>
      {turns.map((t, i) =>
        t.role === 'user' ? (
          <p key={i} className="turn user">
            <strong>you:</strong> {t.content}
          </p>
        ) : (
          <Reply key={i} reply={t.reply} ctx={ctx} />
        ),
      )}
      <form onSubmit={(e) => void send(e)}>
        <textarea
          aria-label="Message"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={busy || draft.trim() === ''}>
          {busy ? 'Asking…' : 'Ask the agent'}
        </button>
      </form>
      {busy ? (
        <p className="notice" role="status" data-testid="agent-waiting">
          Asking the agent… {elapsed} s. A first answer can take up to about 25 seconds: the agent
          resolves the place, runs the search and writes a short answer, and the first question
          after a quiet period also starts the data service.
        </p>
      ) : null}
      {unavailable ? (
        <p className="notice" role="status" data-testid="agent-unavailable">
          {unavailable}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </Section>
  );
}
