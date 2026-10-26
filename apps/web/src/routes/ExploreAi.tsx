// Explore · AI (`?mode=ai`; A-14 T033, FR-012; contracts/agent-ask.md; docs/02-design.md
// "Explore · AI"). A plain-language question goes to `agent.ask` through data/agent-ask.ts (the
// browser never calls a model provider). One response, no streaming (AD-09): while it is in
// flight the tab shows "Working…" with an elapsed timer and Cancel; the client stops at 25 s
// (AD-27 layer 3). The answer shows its prose with `[n]` citations that jump to numbered source
// rows (each with its provenance line), "How I read this" as the server's echo of the filters it
// applied (numeric ones editable, then "Ask again" re-sends them as `overrides`), and the list of
// what is missing or unknown with the reason. Outcomes: answered, no results, throttled, paused,
// timed out, failed, cancelled, plus the client-side session limit (10 answered questions; only
// `answered` counts). `data-ai-state` reports the state for the hosted tests. Not a route module:
// Explore.tsx mounts it.
import type { Missing } from "@countylens/contract";
import { AI_TEXTS, missingLabel } from "@countylens/shared";
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { CidDisplay } from "../components/CidDisplay";
import { WELCOME_QUESTIONS } from "../components/WelcomeCard";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { LinearProgress } from "../components/LinearProgress";
import { Provenance } from "../components/Provenance";
import { builtYearWords, ownedText, plainWords } from "../components/ResultRow";
import { StatusPill } from "../components/StatusPill";
import {
  askAgent,
  type AgentAskRequest,
  type AgentAskResponse,
  type AgentMatch,
  type AgentTurn,
  type AskAgent,
} from "../data/agent-ask";
import {
  howChips,
  limitReached,
  readSessionCount,
  sessionStorageOrUndefined,
  answerBlocks,
  answerInline,
  writeSessionCount,
} from "./ExploreAi.state";
import type { ExplorePageState } from "./ExploreFilters";
import exploreStyles from "./Explore.module.css";
import styles from "./ExploreAi.module.css";

export type AiState =
  | "idle"
  | "working"
  | "answered"
  | "no_results"
  | "throttled"
  | "paused"
  | "timed_out"
  | "failed"
  | "cancelled"
  | "unreachable"
  | "limit";

const MAX_TURNS = 4;
const TICK_MS = 1000;

interface Shown {
  readonly response: AgentAskResponse;
  readonly prompt: string;
}

export interface ExploreAiProps {
  /** `run=1` on arrival: send the `q` question once without waiting for Ask. */
  readonly autoRun?: boolean;
  readonly onState: (state: ExplorePageState) => void;
  /** Injected by tests; defaults to the `agent.ask` client. */
  readonly ask?: AskAgent;
  /** The drawer head (mode tabs and the collapse button), from Explore. */
  readonly head?: ReactNode;
  /** The drawer is collapsed to its strip (from 840 px; the question box stays in the DOM). */
  readonly collapsed?: boolean;
  /** The Explore results list, shown under the answer (PO 2026-10-26). */
  readonly results?: ReactNode;
  /** Called with the filters an answer applied, so the results list shows the same search. */
  readonly onAnswered?: (query: AgentAskResponse["query"]) => void;
}

/** A missing entry in words: the shared label when the reason is a contract reason, else the
 *  reason spelled out (the agent also reports reasons such as `truncated` or `not_found`). */
function missingText(field: string, reason: string): string {
  try {
    return missingLabel(field, reason as Parameters<typeof missingLabel>[1]);
  } catch {
    return reason.replaceAll("_", " ");
  }
}

/** Plain words for a contract field name (final review: no raw `snake_case` or dotted names). */
const FIELD_WORDS: Readonly<Record<string, string>> = {
  unnormalized_address: "street address",
  city_name: "city",
  postal_code: "ZIP",
  owner_is_out_of_area: "out-of-area owner",
  owner_area_class: "owner area",
  owner_mailing_postal_code: "owner mailing ZIP",
  owner_mailing_state_code: "owner mailing state",
  name_as_printed: "contractor name",
  contractor_name_as_printed: "contractor name",
  status_raw: "status as printed",
  source_url: "source link",
};
const fieldWords = (field: string): string => {
  const last = field.split(".").pop() ?? field;
  return FIELD_WORDS[last] ?? last.replaceAll("_", " ");
};

/** A row's gaps, one pill per reason naming its fields in words. */
function MissingPills({ missing }: { readonly missing: readonly Missing[] }): ReactElement {
  const groups = new Map<string, string[]>();
  for (const m of missing) groups.set(m.reason, [...(groups.get(m.reason) ?? []), m.field]);
  return (
    <>
      {[...groups].map(([reason, fields]) => (
        <StatusPill
          key={reason}
          status="unavailable"
          text={`${missingText(fields[0] ?? "", reason)}: ${fields.map(fieldWords).join(", ")}`}
          data={{ field: fields.join(","), reason }}
        />
      ))}
    </>
  );
}

/** The BBB status of a source row in words (contract `bbb_status`). */
const BBB_WORDS: Readonly<Record<string, string>> = {
  rated: "BBB rated",
  not_found: "no BBB profile found",
  blocked: "BBB blocked the lookup",
  not_checked: "BBB not checked",
};

function statusFor(response: AgentAskResponse): AiState {
  switch (response.outcome) {
    case "answered":
      return response.matches.length === 0 ? "no_results" : "answered";
    case "paused":
    case "throttled":
    case "timed_out":
    case "failed":
    case "cancelled":
      return response.outcome;
  }
}

function Match({ match }: { readonly match: AgentMatch }): ReactElement {
  const sourceMissing = match.missing.find((m) => m.field === "source_url");
  const facts: string[] = [];
  // Optional row fields the API now returns (final review: year built, owner, owned years).
  const extra = match as {
    year_built?: number | null;
    owner_name?: string | null;
    tenure_years?: number | null;
  };
  if (match.roof_age_years !== undefined) {
    facts.push(
      `roof ${match.roof_age_years} yrs (${match.roof_age_basis === undefined ? "basis not stated" : plainWords(match.roof_age_basis)}${match.roof_age_confidence === undefined ? "" : `, ${match.roof_age_confidence} confidence`})`,
    );
  }
  if (typeof extra.year_built === "number")
    facts.push(`Year built ${builtYearWords(extra.year_built)}`);
  if (typeof extra.owner_name === "string") facts.push(`Owner ${extra.owner_name}`);
  if (typeof extra.tenure_years === "number") facts.push(ownedText(extra.tenure_years));
  if (match.permit_number !== undefined) facts.push(`permit ${match.permit_number}`);
  if (match.status_class !== undefined) facts.push(match.status_class.replaceAll("_", " "));
  if (match.open_days !== undefined) facts.push(`open ${match.open_days} days`);
  if (match.contractor_resolution !== undefined)
    facts.push(`contractor ${plainWords(match.contractor_resolution)}`);
  if (match.bbb_status !== undefined)
    facts.push(BBB_WORDS[match.bbb_status] ?? `BBB ${plainWords(match.bbb_status)}`);
  const cid = match.property_cid ?? match.permit_cid;
  return (
    <li id={`ai-match-${match.n}`} tabIndex={-1} className={styles.match} data-match={match.n}>
      <span className={styles.matchNo}>{match.n}</span>
      <div className={styles.matchBody}>
        {cid === undefined ? null : <CidDisplay cid={cid} />}
        <p className={styles.facts}>{facts.length === 0 ? match.table : facts.join(" · ")}</p>
        {match.missing.length === 0 ? null : (
          <p className={styles.pills}>
            <MissingPills missing={match.missing as readonly Missing[]} />
          </p>
        )}
        <Provenance
          sourceUrl={match.source_url}
          {...(sourceMissing === undefined ? {} : { sourceUrlMissing: sourceMissing as Missing })}
          capturedAt={match.captured_at}
          tableCid={match.table_cid}
          runId={match.run_id}
        />
      </div>
    </li>
  );
}

export function ExploreAi({
  onState,
  ask = askAgent,
  head,
  collapsed = false,
  results,
  onAnswered,
  autoRun = false,
}: ExploreAiProps): ReactElement {
  // `?q=` (the "What can I ask?" card, the search box) fills the box; it is never sent until the
  // person presses Ask. PO 2026-10-26: the drawer's "Ask about this property" adds `run=1`, which
  // sends that question once on arrival (like the Roofing CRM), then leaves the URL.
  const [prompt, setPrompt] = useState(
    () => new URLSearchParams(window.location.search).get("q") ?? "",
  );
  const [state, setState] = useState<AiState>("idle");
  const [shown, setShown] = useState<Shown | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [used, setUsed] = useState(() => readSessionCount(sessionStorageOrUndefined()));
  const [draft, setDraft] = useState<Readonly<Record<string, string>>>({});
  const turns = useRef<AgentTurn[]>([]);
  const pinned = useRef<string | undefined>(undefined);
  const overrides = useRef<Record<string, unknown>>({});
  const controller = useRef<AbortController | null>(null);
  const stopReason = useRef<"cancel" | "timeout" | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    onState("ready");
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [onState]);

  useEffect(() => {
    if (state !== "working") return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((s) => s + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [state]);

  const send = useCallback(
    async (question: string, edited: Record<string, unknown>): Promise<void> => {
      if (limitReached(used)) {
        setState("limit");
        return;
      }
      const text = question.trim();
      if (text === "") return;
      overrides.current = { ...overrides.current, ...edited };
      const request: AgentAskRequest = {
        prompt: text,
        ...(turns.current.length === 0 ? {} : { turns: turns.current.slice(-MAX_TURNS) }),
        ...(Object.keys(overrides.current).length === 0 ? {} : { overrides: overrides.current }),
        ...(pinned.current === undefined ? {} : { manifest_cid: pinned.current }),
      };
      const abort = new AbortController();
      controller.current = abort;
      stopReason.current = null;
      const stop = setTimeout(() => {
        stopReason.current = "timeout";
        abort.abort();
      }, AI_TEXTS.clientStopMs);
      setState("working");
      try {
        const response = await ask(request, abort.signal);
        if (!mounted.current || stopReason.current !== null) return;
        turns.current = [...turns.current, { prompt: text, outcome: response.outcome }].slice(
          -MAX_TURNS,
        );
        const next = statusFor(response);
        const first = response.matches[0];
        if (first !== undefined) pinned.current = first.manifest_cid;
        if (response.outcome === "answered") {
          const count = used + 1;
          setUsed(count);
          writeSessionCount(sessionStorageOrUndefined(), count);
        }
        setShown({ response, prompt: text });
        if (response.outcome === "answered") onAnswered?.(response.query);
        setDraft({});
        setState(next);
      } catch {
        if (!mounted.current) return;
        if (stopReason.current === "cancel") setState("cancelled");
        else if (stopReason.current === "timeout") setState("timed_out");
        else setState("unreachable");
      } finally {
        clearTimeout(stop);
      }
    },
    [ask, used, onAnswered],
  );

  const cancel = (): void => {
    stopReason.current = "cancel";
    controller.current?.abort();
  };

  const jump = (n: number): void => {
    const row = document.getElementById(`ai-match-${n}`);
    if (row === null) return;
    row.scrollIntoView?.({ block: "center" });
    row.focus();
  };

  // Once, on arrival: the question the link carried (Explore drops `run` from the URL).
  const autoSent = useRef(false);
  useEffect(() => {
    if (!autoRun || autoSent.current) return;
    autoSent.current = true;
    if (prompt.trim() !== "") void send(prompt, {});
  }, [autoRun, prompt, send]);

  const working = state === "working";
  const atLimit = limitReached(used);
  const response = shown?.response;
  const chips = response === undefined ? null : howChips(response.query);
  const changed = Object.entries(draft).filter(([key, value]) => {
    const current = response?.query[key];
    return value !== "" && Number(value) !== current;
  });

  return (
    // ExploreQ-ai board: the question and its suggestions in the left drawer, the answer beside it.
    <div
      className={`${exploreStyles.layout} ${collapsed ? exploreStyles.collapsed : ""}`}
      data-ai-state={state}
      data-panel="ai"
    >
      <div className={exploreStyles.filters} data-drawer={collapsed ? "collapsed" : "open"}>
        {head}
        <form
          className={`${styles.form} ${collapsed ? styles.hiddenWide : ""}`}
          onSubmit={(event) => {
            event.preventDefault();
            void send(prompt, {});
          }}
        >
          <label className={styles.label} htmlFor="ai-question">
            Ask about roofing leads in Travis County
          </label>
          <textarea
            id="ai-question"
            className={styles.input}
            value={prompt}
            maxLength={2000}
            rows={3}
            disabled={working}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.ask}
              disabled={working || prompt.trim() === "" || atLimit}
            >
              Ask
            </button>
            {working ? (
              <button type="button" className={styles.cancel} onClick={cancel}>
                Cancel
              </button>
            ) : null}
            <span className={styles.counter} data-counter={used}>
              {AI_TEXTS.counter(used, AI_TEXTS.sessionLimit)}
            </span>
          </div>
          {/* ExploreQ-ai board "Suggestions": each fills the box; nothing is sent until Ask. */}
          <div className={styles.suggestions} aria-label="Suggestions" role="group">
            {WELCOME_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                className={styles.suggestion}
                disabled={working}
                onClick={() => setPrompt(q)}
                data-ai-suggestion=""
              >
                {q}
              </button>
            ))}
          </div>
        </form>
      </div>

      <div className={`${exploreStyles.results} ${styles.panel}`}>
        {state === "idle" ? (
          <p className={styles.note} data-ai-idle="">
            Ask a question in the panel, or pick a suggestion. Answers name their sources and say
            what the data does not hold.
          </p>
        ) : null}
        {working ? (
          <div role="status" className={styles.working}>
            <p className={styles.workingText}>{AI_TEXTS.workingElapsed(elapsed)}</p>
            <LinearProgress label={AI_TEXTS.working} stageText={AI_TEXTS.working} />
          </div>
        ) : null}

        {atLimit && !working ? (
          <ErrorBanner message={AI_TEXTS.limitReached(AI_TEXTS.sessionLimit)} />
        ) : null}
        {state === "throttled" ? <ErrorBanner message={AI_TEXTS.throttled} /> : null}
        {state === "paused" ? <ErrorBanner message={AI_TEXTS.paused} /> : null}
        {state === "timed_out" ? (
          <ErrorBanner
            message={AI_TEXTS.timedOut}
            onRetry={() => void send(shown?.prompt ?? prompt, {})}
          />
        ) : null}
        {state === "failed" ? <ErrorBanner message={AI_TEXTS.failed} /> : null}
        {state === "unreachable" ? (
          <ErrorBanner message={AI_TEXTS.unreachable} onRetry={() => void send(prompt, {})} />
        ) : null}
        {state === "cancelled" ? (
          <p role="status" className={styles.note}>
            {AI_TEXTS.cancelled}
          </p>
        ) : null}

        {response !== undefined &&
        (state === "answered" || state === "no_results") &&
        chips !== null ? (
          // ExploreQ-ai board: from 1240 px the answer on the left, the numbered matches on the right.
          <article className={styles.result} aria-label="Answer">
            <div className={styles.answerMain}>
              {state === "no_results" ? (
                <>
                  <h3 className={styles.heading}>{AI_TEXTS.noResults}</h3>
                  <p className={styles.note}>{AI_TEXTS.noResultsBody}</p>
                </>
              ) : null}
              {/* Explore · AI board: the question, then the prose as headings, paragraphs, items and
              an amber caveat banner (a safe Markdown subset; no raw markers, no HTML). */}
              <h3 className={styles.question}>
                <Icon name="smart_toy" size="medium" />
                {shown?.prompt ?? prompt}
              </h3>
              <div className={styles.answer} data-answer="">
                {answerBlocks(response.answer).map((block, i) => {
                  const inline = answerInline(block.text, response.matches.length).map((part, j) =>
                    part.kind === "text" ? (
                      <span key={j}>{part.text}</span>
                    ) : part.kind === "strong" ? (
                      <strong key={j}>{part.text}</strong>
                    ) : (
                      <a
                        key={j}
                        href={`#ai-match-${part.n}`}
                        className={styles.cite}
                        data-cite={part.n}
                        onClick={(event) => {
                          event.preventDefault();
                          jump(part.n);
                        }}
                      >
                        [{part.n}]
                      </a>
                    ),
                  );
                  if (block.kind === "heading")
                    return (
                      <h4 key={i} className={styles.answerHeading}>
                        {inline}
                      </h4>
                    );
                  if (block.kind === "caveat")
                    return (
                      <p key={i} className={styles.caveat} role="note">
                        <Icon name="warning" size="medium" />
                        <span>{inline}</span>
                      </p>
                    );
                  if (block.kind === "item")
                    return (
                      <p key={i} className={styles.answerItem}>
                        {inline}
                      </p>
                    );
                  return <p key={i}>{inline}</p>;
                })}
              </div>

              {response.run === undefined ? null : (
                <p className={styles.note} data-run="">
                  {AI_TEXTS.searchedRun} <code>{response.run.run_id}</code> · {AI_TEXTS.runAsOf}{" "}
                  {response.run.as_of.slice(0, 10)} · {AI_TEXTS.runManifest}{" "}
                  <CidDisplay cid={response.run.manifest_cid} />
                </p>
              )}

              <section className={styles.how} aria-label={AI_TEXTS.howTitle}>
                <h3 className={styles.heading}>{AI_TEXTS.howTitle}</h3>
                {response.how === "" ? null : <p className={styles.note}>{response.how}</p>}
                <ul className={styles.chips}>
                  {chips.editable.map(({ chip, value }) => (
                    <li key={chip.key} className={styles.chip} data-chip={chip.key}>
                      <label htmlFor={`ai-chip-${chip.key}`}>
                        {chip.label} ({chip.unit})
                      </label>
                      <input
                        id={`ai-chip-${chip.key}`}
                        type="number"
                        inputMode="decimal"
                        className={styles.chipInput}
                        min={chip.min}
                        max={chip.max}
                        step={chip.step}
                        value={draft[chip.key] ?? String(value)}
                        onChange={(event) => setDraft({ ...draft, [chip.key]: event.target.value })}
                      />
                    </li>
                  ))}
                  {chips.fixed.map((chip) => (
                    <li key={chip.key} className={styles.chipFixed} data-chip={chip.key}>
                      {chip.text}
                    </li>
                  ))}
                </ul>
                {chips.editable.length === 0 ? null : (
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.ask}
                      disabled={changed.length === 0 || atLimit}
                      onClick={() =>
                        void send(
                          shown?.prompt ?? prompt,
                          Object.fromEntries(changed.map(([key, value]) => [key, Number(value)])),
                        )
                      }
                    >
                      Ask again
                    </button>
                    <span className={styles.note}>{AI_TEXTS.howHelp}</span>
                  </div>
                )}
              </section>

              <section className={styles.missing} aria-label={AI_TEXTS.missingTitle}>
                <h3 className={styles.heading}>{AI_TEXTS.missingTitle}</h3>
                {response.missing.length === 0 ? (
                  <p className={styles.note}>{AI_TEXTS.noMissing}</p>
                ) : (
                  <ul className={styles.list} data-missing="">
                    {response.missing.map((m) => (
                      <li
                        key={`${m.field}:${m.reason}`}
                        data-field={m.field}
                        data-reason={m.reason}
                      >
                        <StatusPill
                          status="unavailable"
                          text={`${fieldWords(m.field)}: ${missingText(m.field, m.reason)}`}
                          data={{ field: m.field, reason: m.reason }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {response.matches.length === 0 ? null : (
              <section className={styles.sources} aria-label={AI_TEXTS.sourcesTitle}>
                <h3 className={styles.heading}>{AI_TEXTS.sourcesTitle}</h3>
                <ol className={styles.matches} data-matches="">
                  {response.matches.map((match) => (
                    <Match key={match.n} match={match} />
                  ))}
                </ol>
              </section>
            )}
          </article>
        ) : null}
        {results}
      </div>
    </div>
  );
}
