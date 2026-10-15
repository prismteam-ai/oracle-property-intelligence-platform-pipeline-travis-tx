import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";

const logger = new Logger({ serviceName: "oracle-travis-mcp" });
const metrics = new Metrics({ namespace: "OracleTravis", serviceName: "oracle-travis-mcp" });
const app = createApp();
app.use("*", async (c, next) => {
  const t0 = Date.now();
  await next();
  metrics.addMetric("RequestDuration", MetricUnit.Milliseconds, Date.now() - t0);
  metrics.addMetric(
    c.res.status >= 500 ? "RequestsFailed" : "RequestsProcessed",
    MetricUnit.Count,
    1,
  );
  logger.info("request", {
    path: c.req.path,
    method: c.req.method,
    status: c.res.status,
    ms: Date.now() - t0,
  });
  metrics.publishStoredMetrics();
});

export const handler = handle(app);
