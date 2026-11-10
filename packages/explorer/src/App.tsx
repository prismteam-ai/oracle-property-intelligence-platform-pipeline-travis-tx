import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { Cid, ErrorNote, Spinner } from "./components/ui.js";
import type { Dataset } from "./data/dataset.js";
import type { Database } from "./data/duckdb.js";
import { useDatabase, useDataset } from "./data/hooks.js";
import { formatDateTime } from "./format.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { PublicationPage } from "./pages/PublicationPage.js";

const AgentPage = lazy(async () => ({ default: (await import("./pages/AgentPage.js")).AgentPage }));
const LeadsPage = lazy(async () => ({ default: (await import("./pages/LeadsPage.js")).LeadsPage }));
const McpPage = lazy(async () => ({ default: (await import("./pages/McpPage.js")).McpPage }));
const SqlPage = lazy(async () => ({ default: (await import("./pages/SqlPage.js")).SqlPage }));

enum Page {
  Overview = "overview",
  Publication = "publication",
  Leads = "leads",
  Sql = "sql",
  Agent = "agent",
  Mcp = "mcp",
}

const PAGES: { page: Page; label: string }[] = [
  { page: Page.Overview, label: "Pipeline runs" },
  { page: Page.Publication, label: "IPFS publication" },
  { page: Page.Leads, label: "Leads map" },
  { page: Page.Sql, label: "SQL" },
  { page: Page.Agent, label: "Agent" },
  { page: Page.Mcp, label: "MCP" },
];

const HASH_PREFIX = "#/";

function pageFromHash(): Page {
  const name = window.location.hash.slice(HASH_PREFIX.length);
  return Object.values(Page).includes(name as Page) ? (name as Page) : Page.Overview;
}

function useHashPage(): Page {
  const [page, setPage] = useState(pageFromHash);
  useEffect(() => {
    const update = () => setPage(pageFromHash());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return page;
}

export function App() {
  const page = useHashPage();
  const dataset = useDataset();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◆
          </span>
          <div>
            <strong>Travis Oracle</strong>
            <span className="muted small">
              Property intelligence for roofing leads · Travis County, TX
            </span>
          </div>
        </div>
        {dataset.state === "ready" && (
          <div className="dataset-badge">
            <span className="muted small">Dataset {dataset.value.build.buildId}</span>
            <Cid cid={dataset.value.publication.rootCid} />
            <span className="muted small">
              published {formatDateTime(dataset.value.publication.publishedAt)}
            </span>
          </div>
        )}
      </header>
      <nav className="tabs">
        {PAGES.map(({ page: target, label }) => (
          <a
            key={target}
            href={`${HASH_PREFIX}${target}`}
            className={target === page ? "active" : ""}
          >
            {label}
          </a>
        ))}
      </nav>
      <main>
        {dataset.state === "loading" && <Spinner label="Loading the latest publication…" />}
        {dataset.state === "failed" && <ErrorNote message={dataset.error} />}
        {dataset.state === "ready" && <PageView page={page} dataset={dataset.value} />}
      </main>
    </div>
  );
}

function PageView({ page, dataset }: { page: Page; dataset: Dataset }) {
  switch (page) {
    case Page.Overview:
      return <OverviewPage dataset={dataset} />;
    case Page.Publication:
      return <PublicationPage dataset={dataset} />;
    case Page.Leads:
      return (
        <WithDatabase dataset={dataset}>
          {(database) => <LeadsPage dataset={dataset} database={database} />}
        </WithDatabase>
      );
    case Page.Sql:
      return (
        <WithDatabase dataset={dataset}>
          {(database) => <SqlPage dataset={dataset} database={database} />}
        </WithDatabase>
      );
    case Page.Agent:
      return (
        <WithDatabase dataset={dataset}>
          {(database) => <AgentPage dataset={dataset} database={database} />}
        </WithDatabase>
      );
    case Page.Mcp:
      return (
        <WithDatabase dataset={dataset}>
          {(database) => <McpPage dataset={dataset} database={database} />}
        </WithDatabase>
      );
  }
}

function WithDatabase({
  dataset,
  children,
}: {
  dataset: Dataset;
  children: (database: Database) => ReactNode;
}) {
  const database = useDatabase(dataset);
  if (database.state === "loading")
    return <Spinner label="Starting DuckDB-WASM and attaching the published Parquet tables…" />;
  if (database.state === "failed") return <ErrorNote message={database.error} />;
  return <Suspense fallback={<Spinner label="Loading…" />}>{children(database.value)}</Suspense>;
}
