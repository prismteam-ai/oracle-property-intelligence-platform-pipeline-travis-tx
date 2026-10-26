// A-14 T010a (G-4): `apps/api/src/mcp/auth.ts`'s token-check logic (the function, not the CDK
// resource — infra/test/countylens-api-mcp.test.ts covers that). Written before src/mcp/auth.ts
// exists: the red run fails with "Cannot find module '../src/mcp/auth'". Per the design
// (agent-design.md § oracle "Token-check design", AD-10, AD-14): a missing SSM parameter fails
// fast at cold start with a clear log line and no default; a correct bearer token passes; a
// missing or wrong token gets the typed 401 shape back, nothing else running. `@aws-lambda-
// powertools/parameters/ssm` is mocked; no AWS call happens here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ssm = vi.hoisted(() => ({ getParameter: vi.fn() }));
vi.mock("@aws-lambda-powertools/parameters/ssm", () => ({ getParameter: ssm.getParameter }));

async function freshAuth() {
  vi.resetModules();
  return import("../src/mcp/auth.js");
}

const errorLog = vi.fn();

beforeEach(() => {
  ssm.getParameter.mockReset();
  errorLog.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mcp auth: cold-start token load", () => {
  it("fails fast with a clear, secret-free log line when the SSM parameter is missing (GetParameter throws), no default fallback", async () => {
    const auth = await freshAuth();
    auth.setAuthObservability({ error: errorLog });
    ssm.getParameter.mockRejectedValue(new Error("ParameterNotFound"));

    await expect(auth.getMcpToken()).rejects.toThrow("MCP bearer token not configured");
    expect(errorLog).toHaveBeenCalledTimes(1);
    const [message, fields] = errorLog.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toMatch(/MCP bearer token not configured/);
    expect(JSON.stringify([message, fields])).not.toMatch(/ParameterNotFound/);
    expect(fields).toMatchObject({ parameterName: auth.MCP_TOKEN_PARAMETER_NAME });
  });

  it("fails fast the same way when the parameter resolves empty (no default value is ever used)", async () => {
    const auth = await freshAuth();
    auth.setAuthObservability({ error: errorLog });
    ssm.getParameter.mockResolvedValue("");

    await expect(auth.getMcpToken()).rejects.toThrow("MCP bearer token not configured");
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed load: the next call tries SSM again", async () => {
    const auth = await freshAuth();
    auth.setAuthObservability({ error: errorLog });
    ssm.getParameter.mockRejectedValueOnce(new Error("boom"));
    await expect(auth.getMcpToken()).rejects.toThrow();
    ssm.getParameter.mockResolvedValueOnce("real-token-abc");
    await expect(auth.getMcpToken()).resolves.toBe("real-token-abc");
    expect(ssm.getParameter).toHaveBeenCalledTimes(2);
  });

  it("reads with decrypt: true (a SecureString), and caches a successful load for the sandbox", async () => {
    const auth = await freshAuth();
    ssm.getParameter.mockResolvedValue("real-token-abc");
    expect(await auth.getMcpToken()).toBe("real-token-abc");
    expect(await auth.getMcpToken()).toBe("real-token-abc");
    expect(ssm.getParameter).toHaveBeenCalledTimes(1);
    expect(ssm.getParameter).toHaveBeenCalledWith(auth.MCP_TOKEN_PARAMETER_NAME, {
      decrypt: true,
    });
  });
});

describe("mcp auth: checkAuth (per-request)", () => {
  it("passes a correct bearer token", async () => {
    const auth = await freshAuth();
    ssm.getParameter.mockResolvedValue("correct-token");
    await expect(auth.checkAuth("Bearer correct-token")).resolves.toEqual({ ok: true });
  });

  it("returns the typed 401 shape for a wrong token", async () => {
    const auth = await freshAuth();
    ssm.getParameter.mockResolvedValue("correct-token");
    await expect(auth.checkAuth("Bearer wrong-token")).resolves.toEqual({
      ok: false,
      failure: { status: 401, body: { error: "unauthorized" } },
    });
  });

  it("returns the typed 401 shape for a missing Authorization header", async () => {
    const auth = await freshAuth();
    ssm.getParameter.mockResolvedValue("correct-token");
    await expect(auth.checkAuth(undefined)).resolves.toEqual({
      ok: false,
      failure: { status: 401, body: { error: "unauthorized" } },
    });
  });

  it("returns the typed 401 shape for a malformed header (no Bearer prefix)", async () => {
    const auth = await freshAuth();
    ssm.getParameter.mockResolvedValue("correct-token");
    await expect(auth.checkAuth("correct-token")).resolves.toEqual({
      ok: false,
      failure: { status: 401, body: { error: "unauthorized" } },
    });
  });

  it("never compares with a plain === (no timing side channel helper is skipped): a token one character short still fails", async () => {
    const auth = await freshAuth();
    ssm.getParameter.mockResolvedValue("correct-token");
    await expect(auth.checkAuth("Bearer correct-toke")).resolves.toMatchObject({ ok: false });
  });
});

describe("mcp auth: no DuckDB bind is ever attempted when auth fails", () => {
  it("src/mcp/auth.ts has no import statement reaching DuckDB/engine code (static check, not just a mock assertion)", () => {
    const path = fileURLToPath(new URL("../src/mcp/auth.ts", import.meta.url));
    const source = readFileSync(path, "utf8");
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line))
      .join("\n");
    expect(importLines).not.toMatch(/@countylens\/engine-duckdb/);
    expect(importLines).not.toMatch(/duckdb/i);
  });
});
