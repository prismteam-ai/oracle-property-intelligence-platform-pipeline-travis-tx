// ERR-75: production error bodies must never carry a stack trace (tRPC includes `data.stack`
// whenever isDev is true, and its default is NODE_ENV !== "production", which the Lambdas don't set).
import { describe, expect, it } from "vitest";
import { appRouter } from "../src/routers/index.js";

describe("tRPC error shape (ERR-75)", () => {
  it("runs with isDev false, so no error response includes a stack", () => {
    expect(appRouter._def._config.isDev).toBe(false);
  });
});
