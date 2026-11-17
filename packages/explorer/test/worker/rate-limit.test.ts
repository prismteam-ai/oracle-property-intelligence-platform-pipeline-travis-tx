import { describe, expect, it } from "vitest";
import { tooManyRequests } from "../../worker/rate-limit.js";

function limiter(allow: boolean) {
  const keys: string[] = [];
  return {
    keys,
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: allow };
    },
  };
}

const request = new Request("https://explorer.test/api/agent", {
  method: "POST",
  headers: { "cf-connecting-ip": "203.0.113.7" },
});

describe("tooManyRequests", () => {
  it("lets a client through while it is under its limit", async () => {
    const allowing = limiter(true);

    expect(await tooManyRequests(allowing, request, "Slow down")).toBeUndefined();
    expect(allowing.keys).toEqual(["203.0.113.7"]);
  });

  it("answers 429 with an explanation once the client is over its limit", async () => {
    const response = await tooManyRequests(limiter(false), request, "Slow down");

    expect(response?.status).toBe(429);
    expect(await response?.json()).toEqual({ error: "Slow down" });
  });
});
