import { useState } from "react";
import { AgentChat } from "./AgentChat.js";
import { MapExplorer } from "./MapExplorer.js";
import { Publication } from "./Publication.js";
import { RunSummary } from "./RunSummary.js";
import { SqlConsole } from "./SqlConsole.js";

const TABS = [
  { id: "run", label: "Pipeline run" },
  { id: "publication", label: "IPFS publication" },
  { id: "map", label: "Explore (map)" },
  { id: "agent", label: "Agent" },
  { id: "sql", label: "DuckDB SQL" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App() {
  const [tab, setTab] = useState<TabId>(() => {
    const h = window.location.hash.slice(1);
    return (TABS.find((t) => t.id === h)?.id ?? "run") as TabId;
  });
  const select = (id: TabId) => {
    setTab(id);
    window.location.hash = id;
  };
  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <strong>Oracle · Travis County, TX</strong>
          <span className="muted">Property intelligence for roofing lead discovery</span>
        </div>
        <nav>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={t.id === tab ? "tab active" : "tab"}
              onClick={() => select(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === "run" && <RunSummary />}
        {tab === "publication" && <Publication />}
        {tab === "map" && <MapExplorer />}
        {tab === "agent" && <AgentChat />}
        {tab === "sql" && <SqlConsole />}
      </main>
    </div>
  );
}
