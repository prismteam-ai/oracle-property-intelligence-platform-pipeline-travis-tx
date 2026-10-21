import { useQuery } from '@tanstack/react-query';
import { apiOrigin, useApi } from '../api.js';
import { ErrorBox, Loading, Section } from '../components/common.js';

interface McpTool {
  name: string;
  description?: string;
}

/** Demo step 10: the MCP-ready interface: endpoint, an example call, and a live `tools/list`. */
export function Mcp() {
  const api = useApi();
  const endpoint = `${apiOrigin(api)}/v1/mcp`;
  const tools = useQuery({
    queryKey: ['mcp-tools'],
    queryFn: async () => {
      const response = await api.mcpToolsList();
      const result = response.result as { tools?: McpTool[] } | undefined;
      return result?.tools ?? [];
    },
  });

  const example = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'search_properties',
      arguments: {
        lat: 30.2672,
        lon: -97.7431,
        radius_miles: 5,
        roof_age_min: 15,
        open_permits: false,
        limit: 5,
      },
    },
  });
  const curl = `curl -sS -X POST '${endpoint}' \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -H 'mcp-protocol-version: 2025-06-18' \\
  -d '${example}'`;

  return (
    <Section title="MCP server">
      <p>
        Streamable HTTP, stateless JSON, protocol revision <code>2025-06-18</code>, no
        authentication. The tools are the same operations as the REST API, with the same data model.
      </p>
      <p>
        Endpoint: <code data-testid="mcp-endpoint">{endpoint}</code>
      </p>
      <h3>Example tools/call</h3>
      <pre data-testid="mcp-curl">{curl}</pre>
      <h3>Live tools/list</h3>
      {tools.isPending ? <Loading what="tools/list" /> : null}
      {tools.isError ? <ErrorBox error={tools.error} /> : null}
      {tools.data ? (
        <ul>
          {tools.data.map((t) => (
            <li key={t.name}>
              <code>{t.name}</code>{' '}
              {t.description ? <span className="muted">{t.description}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
