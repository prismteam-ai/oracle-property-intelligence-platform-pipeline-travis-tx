// Explore (`/tx/travis/explore`; A-13 T025/T029; contracts/ui-routes.md). One workspace with a
// left drawer (Explore1440 / ExploreQ-ai boards): its head holds the two modes as tabs, Filters
// (server-side `explore.search`, ExploreFilters) and AI (`?mode=ai`, A-14: `agent.ask` through
// ExploreAi, a lazy chunk), and the button that collapses the drawer (remembered in this browser
// only). Each mode renders the drawer's controls and the results beside them. The SQL tab was
// removed by PO decision (A-16, 2026-10-26): an old `?mode=sql` link is replaced by Filters (the
// `mode` parameter is dropped). The page is always the List view (`data-view="list"`; `view=map`
// falls back to it, FR-004a) and reports `data-state` loading | ready | error for the hosted
// tests. A react-router lazy route module.
import { lazy, Suspense, useCallback, useEffect, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router";
import { ExploreDrawerHead, type ExploreMode } from "../components/ExploreDrawerHead";
import { LinearProgress } from "../components/LinearProgress";
import { SearchBox } from "../components/SearchBox";
import { RUN_PARAM, answerFilterParams } from "./ExploreAi.state";
import { ExploreFilters, type ExplorePageState } from "./ExploreFilters";
import { patchParams } from "./ExploreFilters.state";

/** The AI tab owns the page state; its embedded results list reports none. */
const ignoreState = (): void => undefined;
import styles from "./Explore.module.css";

const ExploreAi = lazy(() => import("./ExploreAi").then((m) => ({ default: m.ExploreAi })));

const LOADING_AI = "Loading the AI panel";
const COLLAPSED_KEY = "countylens.explore.drawer.collapsed";

function storedCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function storeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(COLLAPSED_KEY, "1");
    else window.localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}

export function Component(): ReactElement {
  const [params, setParams] = useSearchParams();
  const requested = params.get("mode");
  const mode: ExploreMode = requested === "ai" ? "ai" : "filters";
  // A removed mode (`sql`) or any unknown value: drop it from the URL and show Filters.
  useEffect(() => {
    if (requested === null || requested === "ai" || requested === "filters") return;
    setParams(
      (current) => {
        const p = new URLSearchParams(current);
        p.delete("mode");
        return p;
      },
      { replace: true },
    );
  }, [requested, setParams]);
  // PO 2026-10-26: the drawer's "Ask about this property" adds `run=1`; the AI tab sends that
  // question once. Each such link remounts the AI tab (a fresh key) with the new question, and
  // `run` is dropped so a reload or Back never sends it again.
  const [askKey, setAskKey] = useState(0);
  useEffect(() => {
    if (params.get(RUN_PARAM) !== "1") return;
    setAskKey((k) => k + 1);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(RUN_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [params, setParams]);
  const [state, setState] = useState<ExplorePageState>("loading");
  const onState = useCallback((next: ExplorePageState) => setState(next), []);
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const switchTo = (next: ExploreMode): void => {
    setState("loading");
    setParams((current) => {
      const p = new URLSearchParams(current);
      p.set("mode", next);
      // PO 2026-10-26: the AI tab opens afresh; a question it was handed (`q`) is not kept.
      p.delete("q");
      if (p.get("view") === "map") p.set("view", "list");
      return p;
    });
  };
  // PO 2026-10-26: the AI tab keeps the results list; an answer writes the filters it applied into
  // the URL (the list's single source), so the list shows the answer's whole search.
  const showAnswerFilters = useCallback(
    (query: Record<string, unknown>) =>
      setParams((current) => patchParams(current, answerFilterParams(query)), { replace: true }),
    [setParams],
  );
  const head = (
    <ExploreDrawerHead
      mode={mode}
      onMode={switchTo}
      collapsed={collapsed}
      onCollapse={(next) => {
        setCollapsed(next);
        storeCollapsed(next);
      }}
    />
  );
  return (
    <section
      aria-label="Explore"
      data-route="explore"
      data-state={state}
      data-view="list"
      className={styles.page}
    >
      {/* Explore390/768 boards: the search box on the page below 1024 px (the app bar has it from there). */}
      <SearchBox className={styles.pageSearch} />
      {/* The boards have no page title row; the heading stays for screen readers. */}
      <h2 className={styles.srOnly}>Explore</h2>
      {mode === "ai" ? (
        <Suspense fallback={<LinearProgress label={LOADING_AI} stageText={LOADING_AI} />}>
          <ExploreAi
            key={askKey}
            onState={onState}
            head={head}
            collapsed={collapsed}
            onAnswered={showAnswerFilters}
            autoRun={askKey > 0}
            results={<ExploreFilters onState={ignoreState} resultsOnly />}
          />
        </Suspense>
      ) : (
        <ExploreFilters onState={onState} head={head} collapsed={collapsed} />
      )}
    </section>
  );
}
