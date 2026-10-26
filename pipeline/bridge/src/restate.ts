// Restate ingress client for the one workflow the bridge starts: AustinPermits (incremental).
// The workflow key is derived from the command ID, so a redelivered or retried command attaches to
// the same durable workflow instead of starting a second one (workflows run once per key).
// Talks only to the ingress (default http://localhost:8080), never to the Query DB.
import { z } from "zod";
import type { RestateRunner } from "./runner.js";

const NOT_COMPLETED = 470;
const POLL_START_MS = 2000;
const POLL_MAX_MS = 10_000;

const Output = z.looseObject({
  status: z.string(),
  exitCode: z.number().int(),
});

export interface RestateOptions {
  ingressUrl: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export function createRestateRunner(options: RestateOptions): RestateRunner {
  const base = options.ingressUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const seg = encodeURIComponent;

  return {
    async runIncremental(jobId, key) {
      const send = await doFetch(`${base}/AustinPermits/${seg(key)}/run/send`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jobId, mode: "incremental" }),
      });
      if (!send.ok)
        throw new Error(
          `restate send failed: HTTP ${send.status} ${(await send.text()).slice(0, 200)}`,
        );
      const path = `${base}/restate/workflow/AustinPermits/${seg(key)}/output`;
      let interval = POLL_START_MS;
      for (;;) {
        if (options.signal?.aborted === true)
          throw new Error("waiting for the workflow was aborted");
        const res = await doFetch(path, { method: "GET", headers: { accept: "application/json" } });
        if (res.status === NOT_COMPLETED) {
          await sleep(interval);
          interval = Math.min(POLL_MAX_MS, interval * 2);
          continue;
        }
        const text = await res.text();
        if (!res.ok)
          throw new Error(`workflow failed (HTTP ${res.status}): ${failureMessage(text)}`);
        return Output.parse(JSON.parse(text));
      }
    },
  };
}

function failureMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    /* not JSON */
  }
  return text.slice(0, 200);
}
