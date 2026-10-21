import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DEFAULT_LIMITS, type Queries } from '@travis/query';
import { App, type HttpRequest } from '../app.js';
import { limitsFromEnv, queriesLoader } from '../db.js';
import { cachedFlag, ssmFlagReader, within } from '../flag.js';
import { createObservability } from '../observability.js';
import { PRIME } from '../warm.js';

const { observer, logger } = createObservability('travis-api');

/** The instance's query layer (opened at init in Lambda, reused while warm; see db.ts). */
export const getQueries: () => Promise<Queries> = queriesLoader(logger);
/** The REST and MCP kill switch (`API_FLAG_PARAM`): set when the function's daily invocations pass the limit. */
const readFlag = cachedFlag(ssmFlagReader('API_FLAG_PARAM'));
// Start both at init, so the first request finds the instance ready or nearly so.
if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  getQueries().catch(() => undefined);
  readFlag().catch(() => undefined);
}

/** The warm-up event `just warm` sends (after every deploy, and before a live demo; decisions.md section 31). */
export interface WarmEvent {
  warm: { hold_ms?: number };
}
let primed = false;
/**
 * Opens the instance if needed and, once per instance, runs the demo's default calls (PRIME) so their data is cached.
 * Then holds until `hold_ms` has passed, so simultaneous warm-ups land on separate instances.
 */
async function warm(e: WarmEvent['warm']): Promise<{ warmed: true; primed_now: boolean }> {
  const t0 = performance.now();
  const q = await getQueries();
  const primedNow = !primed;
  if (!primed) {
    primed = true;
    for (const op of PRIME) {
      const t = performance.now();
      try {
        await op.run(q);
      } catch (err) {
        logger.warn('warm call failed', { operation: op.name, error: String(err) });
      }
      logger.info('warm call', { operation: op.name, ms: Math.round(performance.now() - t) });
    }
  }
  const hold = (e.hold_ms ?? 1500) - (performance.now() - t0);
  if (hold > 0) await new Promise((r) => setTimeout(r, hold));
  logger.info('warm', { primed_now: primedNow, ms: Math.round(performance.now() - t0) });
  return { warmed: true, primed_now: primedNow };
}

const app = new App({
  queries: getQueries,
  mcpLimits: limitsFromEnv()?.mcp ?? DEFAULT_LIMITS.mcp,
  observer,
});

/** `$default`, `GET /v1/permits/text-search` and `POST /v1/mcp`: the REST router and the MCP endpoint; and warm-ups. */
export async function handler(event: WarmEvent): Promise<{ warmed: true; primed_now: boolean }>;
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2>;
export async function handler(
  event: APIGatewayProxyEventV2 | WarmEvent,
): Promise<APIGatewayProxyStructuredResultV2 | { warmed: true; primed_now: boolean }> {
  if ('warm' in event) return warm(event.warm ?? {});
  if ((await within(readFlag(), 1500, null)) === 'true') {
    const requestId = event.requestContext.requestId;
    logger.warn('budget exhausted', { requestId });
    return {
      statusCode: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId },
      body: JSON.stringify({
        error: 'api_unavailable',
        reason: 'budget_exhausted',
        detail: 'the daily request budget is used up; it resets at 00:00 UTC',
        request_id: requestId,
      }),
    };
  }
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(event.headers ?? {})) headers[k.toLowerCase()] = v;
  const req: HttpRequest = {
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: event.queryStringParameters ?? {},
    headers,
    body: event.body
      ? event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body
      : null,
    requestId: event.requestContext.requestId,
  };
  const res = await app.handle(req);
  return { statusCode: res.statusCode, headers: res.headers, body: res.body };
}
