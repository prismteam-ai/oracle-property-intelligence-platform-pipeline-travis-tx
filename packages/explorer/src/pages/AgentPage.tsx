import { runTool, type ToolResult } from "@travis-oracle/query-core";
import { useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type AgentEvent,
  type AgentReply,
  askAgent,
  type ChatMessage,
} from "../agent/agent-loop.js";
import { httpBackend } from "../agent/http-backend.js";
import { Badge, Card, Cid, DataTable, Disclosure, ErrorNote, Spinner } from "../components/ui.js";
import type { Dataset } from "../data/dataset.js";
import type { Database } from "../data/duckdb.js";
import { formatCount } from "../format.js";
import { datasetInfo } from "./dataset-info.js";

const EXAMPLES = [
  "Which properties in Travis County within five miles of Rollingwood have roofs older than 15 years?",
  "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?",
  "Which properties within 3 miles of Lakeway have not changed owners in more than 10 years?",
  "Show properties within 2 miles of Manor whose owners live out of state.",
];

const EVIDENCE_ROWS = 10;
const EVIDENCE_COLUMNS: Record<string, string[]> = {
  find_aged_roofs: [
    "prop_id",
    "situs_address",
    "roof_age_years",
    "roof_age_anchor",
    "roof_age_confidence",
    "distance_miles",
    "source",
  ],
  find_open_roofing_permits: [
    "permit_number",
    "address",
    "permit_state",
    "years_open",
    "contractor_name",
    "bbb_rating",
    "bbb_snapshot_date",
    "source_url",
  ],
  find_long_held_properties: [
    "prop_id",
    "situs_address",
    "ownership_years",
    "owner_name",
    "distance_miles",
    "source",
  ],
  find_out_of_area_owners: [
    "prop_id",
    "situs_address",
    "owner_name",
    "owner_locality",
    "mailing_state",
    "distance_miles",
    "source",
  ],
};

interface Turn {
  question: string;
  events: AgentEvent[];
  answer?: string;
  error?: string;
  neurons: number;
  cachedSteps: number;
  steps: number;
}

export function AgentPage({ dataset, database }: { dataset: Dataset; database: Database }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState<AgentReply["budget"] & { model: string }>();
  const history = useRef<ChatMessage[]>([]);

  const updateLast = (change: (turn: Turn) => Turn) =>
    setTurns((current) => [...current.slice(0, -1), change(current.at(-1) as Turn)]);

  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setQuestion("");
    setTurns((current) => [
      ...current,
      { question: text, events: [], neurons: 0, cachedSteps: 0, steps: 0 },
    ]);
    try {
      const outcome = await askAgent(text, history.current, {
        backend: httpBackend((reply) => {
          setBudget({ ...reply.budget, model: reply.model });
          updateLast((turn) => ({
            ...turn,
            steps: turn.steps + 1,
            cachedSteps: turn.cachedSteps + (reply.cached ? 1 : 0),
          }));
        }),
        tools: {
          run: (name, input) =>
            runTool(name, input, { sql: database, dataset: datasetInfo(dataset) }),
        },
        onEvent: (event) => updateLast((turn) => ({ ...turn, events: [...turn.events, event] })),
      });
      history.current = outcome.messages;
      updateLast((turn) => ({ ...turn, answer: outcome.answer, neurons: outcome.neurons }));
    } catch (failure) {
      updateLast((turn) => ({
        ...turn,
        error: failure instanceof Error ? failure.message : String(failure),
      }));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    history.current = [];
    setTurns([]);
  };

  return (
    <div className="page">
      <Card
        title="Roofing lead agent"
        subtitle={
          <>
            A Workers AI model picks the query tools; the tools run here in DuckDB-WASM over dataset{" "}
            <Cid cid={dataset.publication.rootCid} />, and every answer shows the rows it is based
            on.
          </>
        }
        actions={
          turns.length > 0 && (
            <button type="button" className="button secondary" onClick={reset} disabled={busy}>
              New conversation
            </button>
          )
        }
      >
        {turns.length === 0 && (
          <div className="examples-grid">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="example" onClick={() => ask(example)}>
                {example}
              </button>
            ))}
          </div>
        )}
        <div className="conversation">
          {turns.map((turn, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: turns are append-only
            <TurnView key={index} turn={turn} />
          ))}
        </div>
        <form
          className="ask"
          onSubmit={(event) => {
            event.preventDefault();
            ask(question);
          }}
        >
          <input
            aria-label="Question"
            value={question}
            placeholder={
              turns.length ? "Ask a follow-up…" : "Ask about roofing leads in Travis County…"
            }
            onChange={(event) => setQuestion(event.target.value)}
            disabled={busy}
          />
          <button type="submit" className="button" disabled={busy || !question.trim()}>
            Ask
          </button>
        </form>
        {budget && (
          <p className="muted small">
            {budget.model} · {formatCount(Math.round(budget.used))} of {formatCount(budget.limit)}{" "}
            free neurons used today by this app. Repeated questions answer from the cache at no
            cost.
          </p>
        )}
      </Card>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  return (
    <div className="turn">
      <div className="bubble user">{turn.question}</div>
      {turn.events.map((event, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: events are append-only
        <EventView key={index} event={event} />
      ))}
      {!turn.answer && !turn.error && <Spinner label="Thinking…" />}
      {turn.error && <ErrorNote message={turn.error} />}
      {turn.answer && (
        <div className="bubble agent">
          <Markdown remarkPlugins={[remarkGfm]}>{turn.answer}</Markdown>
          <p className="muted small">
            {turn.steps} model call{turn.steps === 1 ? "" : "s"}
            {turn.cachedSteps > 0 && `, ${turn.cachedSteps} from the cache`} ·{" "}
            {turn.neurons.toFixed(1)} neurons
          </p>
        </div>
      )}
    </div>
  );
}

function EventView({ event }: { event: AgentEvent }) {
  if (event.kind === "answer") return null;
  if (event.kind === "tool_call") {
    return (
      <div className="tool-event">
        <Badge tone="info">tool</Badge> <code>{event.name}</code>{" "}
        <code className="muted">{JSON.stringify(event.input)}</code>
      </div>
    );
  }
  if (event.kind === "tool_error") {
    return (
      <div className="tool-event">
        <Badge tone="warn">tool error</Badge> <code>{event.name}</code> {event.message}
      </div>
    );
  }
  return <Evidence result={event.result} />;
}

function Evidence({ result }: { result: ToolResult }) {
  const columns = EVIDENCE_COLUMNS[result.tool];
  return (
    <div className="evidence">
      <p className="small">
        <Badge tone="good">evidence</Badge>{" "}
        {result.totalMatches !== undefined
          ? `${formatCount(result.totalMatches)} matches`
          : `${result.rows.length} rows`}
        {result.center && (
          <>
            {" "}
            around{" "}
            {result.center.name ??
              `${result.center.latitude.toFixed(4)}, ${result.center.longitude.toFixed(4)}`}
          </>
        )}{" "}
        · dataset {result.dataset.rootCid && <Cid cid={result.dataset.rootCid} />}
      </p>
      {result.rows.length > 0 && (
        <DataTable rows={result.rows.slice(0, EVIDENCE_ROWS)} {...(columns && { columns })} />
      )}
      {result.related && result.related.length > 0 && <DataTable rows={result.related} />}
      {result.sql && (
        <Disclosure summary="SQL">
          <pre className="code-block">{result.sql}</pre>
        </Disclosure>
      )}
    </div>
  );
}
