import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REPOSITORY_ROOT = "../..";
const SERVER_COMMAND = { command: "npm", args: ["run", "--silent", "mcp"] };
const CLIENT_INFO = { name: "demo-stdio-client", version: "1.0.0" };
const SAMPLE_CALL = {
  name: "find_aged_roofs",
  arguments: { place: "Rollingwood", radius_miles: 5, min_roof_age_years: 15, limit: 3 },
};

interface AgedRoof {
  situs_address: string;
  roof_age_years: number;
  roof_age_anchor: string;
  roof_age_confidence: string;
  prop_id: string;
}

export async function stdioSession(): Promise<string[]> {
  const transcript = [`$ ${[SERVER_COMMAND.command, ...SERVER_COMMAND.args].join(" ")}`];
  const transport = new StdioClientTransport({
    ...SERVER_COMMAND,
    cwd: REPOSITORY_ROOT,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer) =>
    transcript.push(`[server] ${chunk.toString().trim()}`),
  );
  const client = new Client(CLIENT_INFO);
  try {
    await client.connect(transport);
    const server = client.getServerVersion();
    transcript.push(`→ initialize`, `← ${server?.name} ${server?.version}`);

    const { tools } = await client.listTools();
    transcript.push(
      `→ tools/list`,
      `← ${tools.length} tools: ${tools.map((tool) => tool.name).join(", ")}`,
    );

    transcript.push(`→ tools/call ${SAMPLE_CALL.name} ${JSON.stringify(SAMPLE_CALL.arguments)}`);
    const result = await client.callTool(SAMPLE_CALL);
    const [content] = result.content as { text: string }[];
    const answer = JSON.parse(content?.text ?? "{}") as { totalMatches: number; rows: AgedRoof[] };
    transcript.push(
      `← ${answer.totalMatches.toLocaleString("en-US")} matches, first ${answer.rows.length}:`,
    );
    for (const row of answer.rows) {
      transcript.push(
        `   ${row.situs_address} · roof ${row.roof_age_years} years (${row.roof_age_anchor}, ${row.roof_age_confidence}) · TCAD ${row.prop_id}`,
      );
    }
    return transcript;
  } finally {
    await client.close();
  }
}
