// A-04 pilot fix: GET .../output answers HTTP 470 while the workflow still runs. The client keeps
// polling; a workflow's own failure surfaces as a failure with its message. Offline fakes only.
import { describe, expect, it } from "vitest";
import { runCli } from "../../../travis/backbone/cli.js";
import {
  IngressError,
  createRestateIngressClient,
  type IngressFetch,
} from "../../../travis/backbone/restate-client.js";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const PENDING = {
  code: 470,
  message: "the invocation exists but has not completed yet",
};

function setup(answers: (() => Response)[]) {
  const sleeps: number[] = [];
  const urls: string[] = [];
  let n = 0;
  const fetch: IngressFetch = async (url) => {
    urls.push(url);
    const answer = answers[Math.min(n, answers.length - 1)] as () => Response;
    n += 1;
    return answer();
  };
  const client = createRestateIngressClient({
    env: {},
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, sleeps, urls };
}

describe("ingress get() polls while the workflow runs", () => {
  it("returns the output after HTTP 470 twice, waiting 2 s then backing off", async () => {
    const s = setup([
      () => json(470, PENDING),
      () => json(470, PENDING),
      () => json(200, { ok: 1 }),
    ]);
    await expect(s.client.get("AustinPermits", "k1")).resolves.toEqual({ ok: 1 });
    expect(s.urls).toHaveLength(3);
    expect(s.urls[0]).toBe("http://localhost:8080/restate/workflow/AustinPermits/k1/output");
    expect(s.sleeps).toEqual([2000, 4000]);
  });

  it("caps the back-off at 10 s and never gives up on its own", async () => {
    const pending = Array.from({ length: 8 }, () => () => json(470, PENDING));
    const s = setup([...pending, () => json(200, "done")]);
    await expect(s.client.get("AustinPermits", "k1")).resolves.toBe("done");
    expect(s.sleeps).toEqual([2000, 4000, 8000, 10000, 10000, 10000, 10000, 10000]);
  });

  it("surfaces a workflow failure body as a failure with its message", async () => {
    const s = setup([
      () => json(470, PENDING),
      () => json(500, { code: 500, message: "page 3: boom" }),
    ]);
    const err = await s.client.get("AustinPermits", "k1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngressError);
    expect((err as IngressError).status).toBe(500);
    expect((err as IngressError).message).toContain("page 3: boom");
    expect(s.urls).toHaveLength(2);
  });

  it("honours an abort signal and a timeout while still pending", async () => {
    const ac = new AbortController();
    const s = setup([() => json(470, PENDING)]);
    ac.abort();
    await expect(s.client.get("AustinPermits", "k1", { signal: ac.signal })).rejects.toThrow(
      /abort/i,
    );
    const t = setup([() => json(470, PENDING)]);
    await expect(t.client.get("AustinPermits", "k1", { timeoutMs: 5000 })).rejects.toThrow(
      /timed out/i,
    );
  });

  it("the CLI exits non-zero with the workflow's message when the output is a failure", async () => {
    const s = setup([() => json(500, { code: 500, message: "page 3: boom" })]);
    const err: string[] = [];
    const code = await runCli(["permits", "--mode", "backfill"], {
      commandsDir: new URL("../../../travis/backbone/commands/", import.meta.url).pathname,
      ingress: {
        ...s.client,
        send: async () => ({ invocationId: "inv" }),
      },
      now: () => new Date("2026-10-22T03:04:00Z"),
      env: {},
      freeBytes: () => 50 * 1024 ** 3,
      stdout: () => undefined,
      stderr: (m) => err.push(m),
    });
    expect(code).not.toBe(0);
    expect(err.join("\n")).toContain("page 3: boom");
  });
});

// ERR-23: a long shared handler is submitted with /send + an idempotency key and polled, so no
// single HTTP call outlives the client's headers timeout (undici: 300 s).
describe("ingress callLong() for minutes-long handlers", () => {
  const CLIENT_TIMEOUT_MS = 300_000;

  /** A fake ingress on a virtual clock: a call held open longer than the timeout fails like undici. */
  function slowIngress(handlerMs: number) {
    let now = 0;
    const log: { method: string; path: string; idem: string | null }[] = [];
    let submittedAt: number | null = null;
    const fetch: IngressFetch = async (url, init) => {
      const path = new URL(url).pathname;
      const method = init.method ?? "GET";
      const headers = new Headers(init.headers);
      log.push({ method, path, idem: headers.get("idempotency-key") });
      if (path.endsWith("/send")) {
        submittedAt = now;
        return json(202, { invocationId: "inv_1", status: "Accepted" });
      }
      if (path.endsWith("/output")) {
        if (submittedAt !== null && now - submittedAt < handlerMs) return json(470, PENDING);
        return json(200, { pass: true, matched: 906 });
      }
      // A plain POST to the handler is held open for its whole run.
      if (handlerMs > CLIENT_TIMEOUT_MS) throw new TypeError("fetch failed");
      return json(200, { pass: true, matched: 906 });
    };
    const client = createRestateIngressClient({
      env: {},
      fetch,
      sleep: async (ms) => {
        now += ms;
      },
    });
    return { client, log };
  }

  it("the plain call dies on a 10 minute handler (the bug); callLong returns the result", async () => {
    const s = slowIngress(600_000);
    await expect(s.client.call("TcadBackbone", "joinProof", {}, "job")).rejects.toThrow(
      "fetch failed",
    );
    const out = await s.client.callLong("TcadBackbone", "joinProof", { seed: 1 }, "job");
    expect(out).toEqual({ pass: true, matched: 906 });
    const send = s.log.find((l) => l.path.endsWith("/send"));
    expect(send?.method).toBe("POST");
    expect(send?.path).toBe("/TcadBackbone/job/joinProof/send");
    expect(send?.idem).toMatch(/^joinProof-/);
    const polls = s.log.filter((l) => l.path.endsWith("/output"));
    expect(polls.length).toBeGreaterThan(5);
    expect(polls[0]?.path).toBe(
      `/restate/invocation/TcadBackbone/job/joinProof/${send?.idem}/output`,
    );
  });

  it("rejects with the handler's own failure message", async () => {
    const fetch: IngressFetch = async (url) =>
      new URL(url).pathname.endsWith("/send")
        ? json(202, { invocationId: "i" })
        : json(500, { code: 500, message: "join proof: export missing" });
    const client = createRestateIngressClient({ env: {}, fetch, sleep: async () => undefined });
    await expect(client.callLong("TcadBackbone", "joinProof", {}, "job")).rejects.toThrow(
      /export missing/,
    );
  });
});

describe("ingest --join-proof over a slow ingress", () => {
  it("prints the result and keeps join_proof= as the last line", async () => {
    const { command } = await import("../../../travis/backbone/commands/ingest.js");
    const lines: string[] = [];
    const ctx = {
      ingress: {
        callLong: async () => ({
          pass: true,
          matched: 906,
          disagreements: 0,
          no_tcad_geoid: 93,
          ambiguous_geoid: 1,
          reverse_checked: 1000,
          reverse_disagreements: 0,
        }),
      },
      print: (l: string) => lines.push(l),
    };
    const args = command.args.parse({ joinProof: true, job: "travis-a04-1", seed: "2026" });
    const result = await command.run(ctx as never, args);
    expect(result.exitCode).toBe(0);
    expect(lines.at(-1)).toBe("join_proof=pass matched=906 disagreements=0");
  });
});
