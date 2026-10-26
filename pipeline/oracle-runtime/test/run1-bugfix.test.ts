// Regression tests for the four bugs the first live run (run id "travis") found.
// SYNTHETIC TEST FIXTURES (test-only): every page below is invented, modelled on the shape
// of the saved run-1 evidence excerpts (CivicPlus and WordPress city pages behind
// Cloudflare, the BBB "Just a moment..." interstitial, the TCAD export that broke mid-stream
// and the GIS host that failed with no response). No real source is called.
//
// 1. A broken download on a reachable source is `failed` with the bytes received and the
//    advertised length kept on the receipt (the next-step wording is tested in
//    workflow.blocked.test.ts).
// 2. A 200 page is a challenge only on an explicit signal, never because Cloudflare injected
//    a `/cdn-cgi/challenge-platform/` beacon script.
// 3. A network error is not a timeout: it records `error`, never `timeout_ms`.
// 4. anti_bot says a challenge was seen whenever the receipt shows one.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import {
  createSourceClient,
  detectChallengeSignal,
  type CaptureReceipt,
  type FetchLike,
} from "../travis/lib/source-client.js";
import { blockedEvidence } from "../travis/discovery/assemble.js";
import { renderBlockedEvidence } from "../travis/discovery/blocked-evidence.js";
import { BlockedEvidenceSchema } from "../travis/discovery/catalog.schema.js";
import { missingReason } from "../travis/discovery/probes/common.js";
import { probeBbb, probeEvidencePage } from "../travis/discovery/probes/evidence.js";
import { probeGisCount } from "../travis/discovery/probes/arcgis.js";
import { fakeHttp, silent, text } from "./fixtures/fake-http.js";
import { must } from "./helpers.js";

const FIXED = new Date("2026-01-01T00:00:00.000Z");

function clientWith(fetch: FetchLike) {
  return createSourceClient({
    fetch,
    sleep: async () => undefined,
    random: () => 0,
    now: () => FIXED,
    log: silent,
    timeoutMs: 1_000,
  });
}

function answer(respond: () => Response | Promise<Response>) {
  return fakeHttp([{ match: () => true, respond }]);
}

/** The script Cloudflare injects into normal pages it serves (bot-detection beacon). */
const CF_BEACON = `<script>(function(){function c(){var b=a.contentDocument||a.contentWindow.document;if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'0000000000000000',t:'MTcwMDAwMDAwMC4wMDAwMDA='};var a=document.createElement('script');a.nonce='';a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);c()})();</script>`;

/** A CivicPlus city page (jonestown/lakeway/manor shape): normal content plus the beacon. */
function civicPlusPage(city: string, title: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta http-equiv="Content-type" content="text/html; charset=UTF-8" />
<!-- Google Tag Manager for GA4 -->
				<script>(function(w,d,s,l,i){w.GAMeasurementID='G-SYNTHETIC';})(window,document,'script','cpDataLayerGA4','GTM-SYNTH');</script>
	<title>${title} | ${city}, TX - Official Website</title>
</head>
<body>
	<div id="page"><h1>${title}</h1>
	<p>Building permits are applied for online. Synthetic paragraph about inspections and fees.</p>
	<nav><a href="/Directory">Staff Directory</a> <a href="/AgendaCenter">Agendas</a></nav></div>
${CF_BEACON}
</body>
</html>`;
}

/** A WordPress city page (round_rock shape) behind Cloudflare, with the beacon. */
const WORDPRESS_PAGE = `<!DOCTYPE html>
<html lang="en-US">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Permit Portal Help - City of Synthetic Rock</title>
<link data-rocket-prefetch href="https://www.googletagmanager.com" rel="dns-prefetch">
</head>
<body class="page"><main><h1>Permit Portal Help</h1><p>Synthetic help text for the permit portal.</p></main>
${CF_BEACON}
</body></html>`;

const CITY_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  server: "cloudflare",
  "cf-cache-status": "EXPIRED",
  "cf-ray": "0000000000000000-CAI",
};

/** The BBB interstitial (bbb shape): HTTP 403 with cf-mitigated: challenge. */
const BBB_INTERSTITIAL = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Just a moment... | Better Business Bureau®</title>
    <style id="custom-props">:root { --bds-color-black: #2d2926; }</style>
  </head>
  <body><noscript>Enable JavaScript and cookies to continue</noscript>
  <script>(function(){window._cf_chl_opt={cvId: '3'};})();</script></body>
</html>`;

const BBB_HEADERS = {
  "content-type": "text/html; charset=UTF-8",
  server: "cloudflare",
  "cf-mitigated": "challenge",
  "cf-ray": "0000000000000000-CAI",
};

describe("bug 2: a 200 page is a challenge only on an explicit signal", () => {
  const pages: Array<[string, string]> = [
    ["jonestown", civicPlusPage("Jonestown", "Permitting & Inspections")],
    ["lakeway", civicPlusPage("Lakeway", "Building and Development Services")],
    ["manor", civicPlusPage("Manor", "Building Permits")],
    ["round_rock", WORDPRESS_PAGE],
  ];

  for (const [key, page] of pages) {
    it(`${key}-shaped page with the injected challenge-platform beacon is not a challenge`, async () => {
      expect(detectChallengeSignal({ status: 200, headers: CITY_HEADERS, body: page })).toBeNull();
      const { fetch, calls } = answer(() => text(page, 200, CITY_HEADERS));
      const r = await probeEvidencePage(
        { client: clientWith(fetch), now: () => FIXED },
        `https://${key}.test/permits`,
      );
      expect(calls).toHaveLength(1);
      expect(r.status).toBe("available");
      expect(r.blocked_receipt).toBeNull();
      expect(r.challenge).toBeNull();
      expect(must(r.receipts[0]).outcome).toBe("ok");
    });
  }

  it("bbb-shaped 403 interstitial with cf-mitigated: challenge is a challenge", async () => {
    const signal = detectChallengeSignal({
      status: 403,
      headers: BBB_HEADERS,
      body: BBB_INTERSTITIAL,
    });
    expect(must(signal)).toContain("cf-mitigated: challenge");
    const { fetch, calls } = answer(() => text(BBB_INTERSTITIAL, 403, BBB_HEADERS));
    const r = await probeBbb({ client: clientWith(fetch), now: () => FIXED });
    expect(calls).toHaveLength(1);
    expect(r.status).toBe("blocked");
    const receipt = must(r.blocked_receipt);
    expect(receipt.outcome).toBe("blocked");
    expect(receipt.blocked_reason).toBe("challenge");
    expect(must(receipt.challenge_signal)).toContain("cf-mitigated: challenge");
    expect(must(r.challenge)).toContain("cf-mitigated: challenge");
  });

  it("cf-mitigated: challenge on a 200 is a challenge", () => {
    expect(
      detectChallengeSignal({
        status: 200,
        headers: { "cf-mitigated": "challenge" },
        body: "<html></html>",
      }),
    ).toContain("cf-mitigated: challenge");
  });

  it("a 200 interstitial body (no normal content) is a challenge", () => {
    for (const title of [
      "Just a moment...",
      "Attention Required! | Cloudflare",
      "Checking your browser",
    ]) {
      const body = `<html><head><title>${title}</title></head><body></body></html>`;
      expect(detectChallengeSignal({ status: 200, headers: {}, body })).not.toBeNull();
    }
  });

  it("a 503 challenge page is not retried: one attempt, blocked challenge", async () => {
    const { fetch, calls } = answer(() =>
      text(`<html><head><title>Just a moment...</title></head>${CF_BEACON}</html>`, 503),
    );
    const res = await clientWith(fetch).capture({ url: "https://x.test/p", bodyKind: "text" });
    expect(calls).toHaveLength(1);
    expect(res.receipt).toMatchObject({
      outcome: "blocked",
      blocked_reason: "challenge",
      attempts: 1,
    });
  });

  it("a 200 body that fails its parse without any challenge signal is failed, not a challenge", async () => {
    const { fetch } = answer(() => text("<html><title>Maintenance</title></html>", 200));
    const res = await clientWith(fetch).capture({
      url: "https://x.test/count.json",
      schema: z.object({ count: z.int() }),
    });
    expect(res.receipt.outcome).toBe("failed");
    expect(res.receipt.blocked_reason).toBeNull();
    expect(must(res.receipt.error)).toMatch(/unexpected/i);
    expect(missingReason(res.receipt)).not.toMatch(/challenge/i);
  });
});

describe("bug 3: a network error is not a timeout", () => {
  async function networkErrorReceipt(): Promise<CaptureReceipt> {
    const fetch: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const r = await probeGisCount({ client: clientWith(fetch), now: () => FIXED });
    return must(r.blocked_receipt);
  }

  it("the receipt records error and no timeout_ms", async () => {
    const receipt = await networkErrorReceipt();
    expect(receipt.status).toBeNull();
    expect(receipt.outcome).toBe("failed");
    expect(receipt.timeout_ms).toBeNull();
    expect(receipt.blocked_reason).toBeNull();
    expect(receipt.error).toBe("fetch failed");
    expect(missingReason(receipt)).toContain("fetch failed");
  });

  it("blocked_evidence carries error, no timeout_ms, and passes the catalog schema", async () => {
    const receipt = await networkErrorReceipt();
    const ev = blockedEvidence(receipt, "docs/evidence/blocked/tcad_gis-20260101T000000Z.md");
    expect(ev.timeout_ms).toBeUndefined();
    expect(ev.http_status).toBeUndefined();
    expect(ev.error).toBe("fetch failed");
    expect(BlockedEvidenceSchema.safeParse(ev).success).toBe(true);
  });

  it("the evidence file says network error, never a timeout", async () => {
    const receipt = await networkErrorReceipt();
    const doc = renderBlockedEvidence({
      path: "docs/evidence/blocked/tcad_gis-20260101T000000Z.md",
      subject: { kind: "source", key: "tcad_gis" },
      receipt,
    });
    const fm = parse(must(/^---\n([\s\S]*?)\n---\n/.exec(doc)?.[1])) as Record<string, unknown>;
    expect(fm.timeout_ms).toBeUndefined();
    expect(fm.error).toBe("fetch failed");
    expect(doc).toMatch(/network error/i);
    expect(doc).not.toMatch(/timed out/i);
  });

  it("blocked_evidence without http_status, timeout_ms or error is still refused", () => {
    const ev = {
      captured_at: "2026-01-01T00:00:00Z",
      url: "https://x.test/",
      evidence_path: "docs/evidence/blocked/x.md",
      body_sha256: "0".repeat(64),
      attempts: 1,
      user_agent: "ua",
      outcome: "failed",
      geo_signal: "none",
    };
    expect(BlockedEvidenceSchema.safeParse(ev).success).toBe(false);
  });
});

describe("bug 1: a broken download on a reachable source keeps what was received", () => {
  it("HTTP 200 whose stream ends early is failed (no retry) with bytes and content-length", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run1-broken-"));
    try {
      let calls = 0;
      const fetch: FetchLike = async () => {
        calls += 1;
        let sent = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull: (controller) => {
              if (!sent) {
                sent = true;
                controller.enqueue(new Uint8Array(4096));
                return;
              }
              controller.error(new TypeError("terminated"));
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/zip", "content-length": "100000" },
          },
        );
      };
      const dl = await clientWith(fetch).download({
        url: "https://traviscad.test/export.zip",
        destPath: join(dir, "export.zip"),
        inactivityMs: 60_000,
        totalMs: 120_000,
      });
      expect(calls).toBe(1);
      expect(dl.path).toBeNull();
      expect(existsSync(join(dir, "export.zip.part"))).toBe(false);
      expect(dl.receipt).toMatchObject({
        status: 200,
        outcome: "failed",
        attempts: 1,
        blocked_reason: null,
        timeout_ms: null,
        error: "terminated",
        bytes: 4096,
      });
      expect(dl.receipt.incomplete_body).toEqual({ bytes: 4096, content_length: 100000 });
      const reason = missingReason(dl.receipt);
      expect(reason).toMatch(/broke at 4096 of 100000 bytes/);
      expect(reason).toContain("terminated");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
