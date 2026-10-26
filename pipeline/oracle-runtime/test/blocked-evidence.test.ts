// T035: blocked-evidence tests. The evidence file under docs/evidence/blocked/ holds the
// status or timeout, time, URL, headers and a body excerpt with its SHA-256, and never a
// token, credential URL or absolute home path; geo_signal is "none" unless the saved
// response quotes an explicit signal (FR-006, FR-006b, constitution XII).
// Synthetic responses only (test-only).
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  USER_AGENT,
  createSourceClient,
  type CaptureReceipt,
  type FetchLike,
} from "../travis/lib/source-client.js";
import {
  EVIDENCE_PARENT,
  evidenceId,
  renderBlockedEvidence,
  writeBlockedEvidence,
} from "../travis/discovery/blocked-evidence.js";
import { fakeHttp, hangUntilAborted, silent, text } from "./fixtures/fake-http.js";
import { must } from "./helpers.js";

const FIXED = new Date("2026-01-01T00:00:00.000Z");
const PATH = "docs/evidence/blocked/tcad_certified-20260101T000000Z.md";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function clientFor(respond: (init: RequestInit) => Response | Promise<Response>, secret?: string) {
  const { fetch } = fakeHttp([{ match: () => true, respond: (_u, init) => respond(init) }]);
  return createSourceClient({
    fetch: fetch as FetchLike,
    sleep: async () => undefined,
    random: () => 0,
    now: () => FIXED,
    log: silent,
    timeoutMs: 20,
    ...(secret === undefined ? {} : { appToken: secret }),
  });
}

async function capture(
  respond: (init: RequestInit) => Response | Promise<Response>,
  url = "https://traviscad.test/publicinformation",
  secret?: string,
): Promise<{ receipt: CaptureReceipt; body: Buffer }> {
  const { receipt, body } = await clientFor(respond, secret).capture({
    url,
    bodyKind: "text",
    ...(secret === undefined ? {} : { useAppToken: true }),
  });
  return { receipt, body };
}

function frontMatter(doc: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(doc);
  return parse(must(m?.[1], "front matter")) as Record<string, unknown>;
}

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

describe("source client keeps stop evidence on blocked receipts only", () => {
  it("a 403 receipt carries sanitized headers and a bounded body excerpt; an ok receipt carries none", async () => {
    const body = "<html>Forbidden</html>" + "x".repeat(10_000);
    const blocked = await capture(() =>
      text(body, 403, {
        "content-type": "text/html",
        "set-cookie": "session=synthetic-secret",
        server: "synthetic",
      }),
    );
    const ev = must(blocked.receipt.stop_evidence, "stop_evidence");
    expect(ev.headers["content-type"]).toBe("text/html");
    expect(ev.headers.server).toBe("synthetic");
    expect(ev.headers["set-cookie"]).toBeUndefined();
    expect(Buffer.from(ev.excerpt_base64, "base64").byteLength).toBeLessThanOrEqual(4096);
    expect(ev.body_bytes).toBe(Buffer.byteLength(body));

    const ok = await capture(() => text("<html>ok</html>"));
    expect(ok.receipt.stop_evidence).toBeUndefined();
  });
});

describe("renderBlockedEvidence (T037)", () => {
  it("contains id/parent front matter, status, time, URL, headers and a body excerpt with its SHA-256", async () => {
    const body = "<html><title>Access denied</title>synthetic block page</html>";
    const { receipt } = await capture(() =>
      text(body, 403, { "content-type": "text/html", server: "synthetic-edge" }),
    );
    const doc = renderBlockedEvidence({
      path: PATH,
      subject: { kind: "source", key: "tcad_certified" },
      receipt,
    });
    const fm = frontMatter(doc);
    expect(fm.id).toBe(evidenceId(PATH));
    expect(String(fm.id)).toMatch(/^EV-A-01-blocked-/);
    expect(fm.parent).toBe(EVIDENCE_PARENT);
    expect(fm.http_status).toBe(403);
    expect(fm.timeout_ms).toBeUndefined();
    expect(fm.captured_at).toBe("2026-01-01T00:00:00.000Z");
    expect(fm.url).toBe("https://traviscad.test/publicinformation");
    expect(fm.body_sha256).toBe(sha(body));
    expect(fm.attempts).toBe(1);
    expect(fm.user_agent).toBe(USER_AGENT);
    expect(fm.outcome).toBe("blocked");
    expect(fm.geo_signal).toBe("none");
    expect(doc).toContain("server: synthetic-edge");
    expect(doc).toContain("content-type: text/html");
    expect(doc).toContain("synthetic block page");
    expect(doc).toContain(sha(body));
  });

  it("a timeout is recorded with timeout_ms and no status", async () => {
    const { receipt } = await capture((init) => hangUntilAborted(init));
    const fm = frontMatter(
      renderBlockedEvidence({ path: PATH, subject: { kind: "source", key: "tcad_gis" }, receipt }),
    );
    expect(fm.timeout_ms).toBe(20);
    expect(fm.http_status).toBeUndefined();
    expect(fm.outcome).toBe("blocked");
  });

  it("never writes tokens, credential URLs, cookies, auth headers or absolute home paths", async () => {
    const secret = "SYNTHETICTOKEN123";
    const body = [
      "see https://admin:hunter2@internal.test/x",
      "Bearer abc.def.ghi",
      "path /Users/someone/secret.txt and /home/someone/x and C:\\Users\\someone\\x",
      `token echoed: ${secret}`,
      "link https://example.test/a?api_key=k123&ok=1",
    ].join("\n");
    const { receipt } = await capture(
      () =>
        text(body, 403, {
          "content-type": "text/html",
          "set-cookie": "sid=cookievalue",
          "www-authenticate": "Bearer realm=x",
          "x-amz-security-token": "tokval",
          "x-request-id": "req-1",
        }),
      `https://data.test/resource.json?$$app_token=${secret}`,
      secret,
    );
    const doc = renderBlockedEvidence({
      path: PATH,
      subject: { kind: "source", key: "austin_permits" },
      receipt,
      secrets: [secret],
    });
    for (const leak of [
      secret,
      "hunter2",
      "abc.def.ghi",
      "/Users/",
      "/home/",
      "C:\\Users",
      "k123",
      "cookievalue",
      "tokval",
    ]) {
      expect(doc, leak).not.toContain(leak);
    }
    expect(doc).toContain("x-request-id: req-1");
  });

  it("geo_signal is none for a bare 403 and quotes an explicit signal from the saved response", async () => {
    const plain = await capture(() => text("Forbidden", 403));
    expect(plain.receipt.geo_signal).toBe("none");
    const geo = await capture(() =>
      text("<p>This site is not available in your country.</p>", 403),
    );
    expect(geo.receipt.geo_signal).toMatch(/not available in your country/i);
    const fm = frontMatter(
      renderBlockedEvidence({
        path: PATH,
        subject: { kind: "source", key: "tcad_certified" },
        receipt: geo.receipt,
      }),
    );
    expect(String(fm.geo_signal)).toMatch(/not available in your country/i);
  });

  it("a receipt without saved evidence (reused observation) says so instead of inventing headers", () => {
    const receipt: CaptureReceipt = {
      url: "https://www.bbb.test/search",
      method: "GET",
      status: 403,
      bytes: 10,
      sha256: "a".repeat(64),
      captured_at: "2026-01-01T00:00:00.000Z",
      user_agent: USER_AGENT,
      attempts: 1,
      outcome: "blocked",
      geo_signal: "none",
      app_token_used: false,
      timeout_ms: null,
      blocked_reason: "challenge",
      rate_limits_observed: null,
    };
    const doc = renderBlockedEvidence({
      path: "docs/evidence/blocked/bbb-x.md",
      subject: { kind: "source", key: "bbb" },
      receipt,
    });
    expect(doc).toMatch(/not captured/i);
    expect(frontMatter(doc).body_sha256).toBe("a".repeat(64));
  });
});

describe("writeBlockedEvidence (T037)", () => {
  it("writes under docs/evidence/blocked/ of the repo root and refuses any other path", () => {
    const root = mkdtempSync(join(tmpdir(), "us4-repo-"));
    tmpDirs.push(root);
    const written = writeBlockedEvidence(root, PATH, "---\nid: x\n---\n");
    expect(written).toBe(join(root, PATH));
    expect(readFileSync(written, "utf8")).toBe("---\nid: x\n---\n");
    for (const bad of [
      "docs/evidence/A-01.md",
      "docs/evidence/blocked/../../x.md",
      "/tmp/docs/evidence/blocked/x.md",
      "docs/evidence/blocked/sub/x.md",
      "docs/evidence/blocked/x.txt",
    ]) {
      expect(() => writeBlockedEvidence(root, bad, "x"), bad).toThrow();
    }
    expect(existsSync(join(root, "docs/evidence/A-01.md"))).toBe(false);
  });
});
