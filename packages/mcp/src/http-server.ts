import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { getSnapshot } from "./snapshot.js";

const port = Number(process.env.PORT || 8787);
const snapshot = await getSnapshot();
serve({ fetch: createApp().fetch, port }, () => {
  process.stdout.write(
    JSON.stringify({
      msg: "oracle_mcp_listening",
      port,
      mcp: `http://localhost:${port}/mcp`,
      runId: snapshot.source.runId,
      base: snapshot.source.base,
    }) + "\n",
  );
});
