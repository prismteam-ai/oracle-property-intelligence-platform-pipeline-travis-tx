import { useEffect, useState } from 'react';
import { Agent } from './screens/Agent.js';
import { Manifest } from './screens/Manifest.js';
import { Mcp } from './screens/Mcp.js';
import { QueryLayer, preloadEngine } from './screens/QueryLayer.js';
import { Records } from './screens/Records.js';
import { Runs } from './screens/Runs.js';
import { Search } from './screens/Search.js';
import { Summary } from './screens/Summary.js';
import { Verify } from './screens/Verify.js';

export const ROUTES = [
  { path: 'summary', label: '1 Run summary' },
  { path: 'records', label: '2 Records by source' },
  { path: 'query-layer', label: '3 Query layer' },
  { path: 'manifest', label: '4 Manifest' },
  { path: 'verify', label: '5 Verify' },
  { path: 'runs', label: '6 Run history' },
  { path: 'search', label: '7-8 Lead queries' },
  { path: 'agent', label: 'Agent' },
  { path: 'mcp', label: 'MCP' },
] as const;

function parseHash(hash: string): { path: string; params: URLSearchParams } {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  return { path: path || 'summary', params: new URLSearchParams(query) };
}

export function App() {
  const [route, setRoute] = useState(() =>
    parseHash(typeof location === 'undefined' ? '' : location.hash),
  );
  // DuckDB-WASM is browser-only: start it once the first screen has loaded, so the query tab finds it ready
  useEffect(() => {
    const t = setTimeout(() => void preloadEngine().catch(() => undefined), 1500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return (
    <div className="app">
      <header>
        <h1>Travis County, TX · property intelligence</h1>
        <nav aria-label="Screens">
          {ROUTES.map((r) => (
            <a
              key={r.path}
              href={`#/${r.path}`}
              aria-current={route.path === r.path ? 'page' : undefined}
            >
              {r.label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        {route.path === 'summary' && <Summary />}
        {route.path === 'records' && <Records />}
        {route.path === 'query-layer' && <QueryLayer />}
        {route.path === 'manifest' && <Manifest />}
        {route.path === 'verify' && (
          <Verify
            key={route.params.get('cid') ?? ''}
            initialCid={route.params.get('cid') ?? undefined}
          />
        )}
        {route.path === 'runs' && <Runs />}
        {route.path === 'search' && <Search />}
        {route.path === 'agent' && <Agent />}
        {route.path === 'mcp' && <Mcp />}
      </main>
    </div>
  );
}
