// T040: destination proof (FR-001c, research R9). Offline: both identity sources are
// injected command runners returning canned output; no Docker, no database, no network.
// The canned values are synthetic (test-only), never a real container or cluster.
import { describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "../travis/lib/command.js";
import { proveDestination } from "../travis/discovery/destination-proof.js";
import { DestinationSchema } from "../travis/discovery/catalog.schema.js";
import { emitCatalogYaml } from "../travis/discovery/write-catalog.js";
import { syntheticCatalog } from "./fixtures/synthetic-catalog.js";
import { must } from "./helpers.js";

const CONTAINER = "a".repeat(64);
const IMAGE_DIGEST = `sha256:${"b".repeat(64)}`;
const SYSTEM_ID = "7312345678901234567";
const AT = new Date("2026-01-01T00:00:00Z");

interface Call {
  file: string;
  args: readonly string[];
}

function ok(stdout: string): CommandResult {
  return { exit_code: 0, stdout, stderr: "" };
}

function runner(answer: (args: readonly string[]) => CommandResult, calls: Call[]): CommandRunner {
  return async (file, args) => {
    calls.push({ file, args: [...args] });
    return answer(args);
  };
}

interface Rig {
  dockerCalls: Call[];
  sqlCalls: Call[];
  docker: CommandRunner;
  sql: CommandRunner;
}

function rig(
  overrides: {
    ps?: CommandResult;
    inspect?: CommandResult;
    psql?: CommandResult;
  } = {},
): Rig {
  const dockerCalls: Call[] = [];
  const sqlCalls: Call[] = [];
  const docker = runner((args) => {
    if (args.includes("ps")) return overrides.ps ?? ok(`${CONTAINER}\n`);
    if (args[0] === "inspect") {
      return overrides.inspect ?? ok(`${CONTAINER} ${IMAGE_DIGEST} postgres:16 running\n`);
    }
    return { exit_code: 1, stdout: "", stderr: "unexpected docker call" };
  }, dockerCalls);
  const sql = runner(
    () => overrides.psql ?? ok(`${SYSTEM_ID}|elephant|16.4 (Debian 16.4-1.pgdg120+2)\n`),
    sqlCalls,
  );
  return { dockerCalls, sqlCalls, docker, sql };
}

function prove(r: Rig, configured: (() => Promise<string>) | null = async () => SYSTEM_ID) {
  return proveDestination({
    docker: r.docker,
    sql: r.sql,
    composeFile: "/abs/compose/docker-compose.yml",
    now: () => AT,
    ...(configured === null ? {} : { configured }),
  });
}

describe("T040 destination proof: two independent identities (FR-001c)", () => {
  it("proves the destination from a Docker-side and a SQL-side identity", async () => {
    const r = rig();
    const dest = await prove(r);
    expect(dest.writes_in_scope).toBe(true);
    expect(dest.proven).toBe(true);
    const ids = must(dest.independent_identity_sources);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    const [dockerSide, sqlSide] = ids as [string, string, string];
    expect(dockerSide).toMatch(/^docker-side: /);
    expect(dockerSide).toContain(CONTAINER.slice(0, 12));
    expect(dockerSide).toContain(IMAGE_DIGEST);
    expect(dockerSide).toContain("postgres:16");
    expect(sqlSide).toMatch(/^sql-side: /);
    expect(sqlSide).toContain(SYSTEM_ID);
    expect(sqlSide).toContain("database elephant");
    expect(sqlSide).toContain("server version 16.4");
    expect(dest.captured_at).toBe("2026-01-01T00:00:00Z");
    expect(DestinationSchema.safeParse(dest).success).toBe(true);
  });

  it("reads the two identities from two different sources: Docker metadata, then SQL inside that container", async () => {
    const r = rig();
    await prove(r);
    expect(r.dockerCalls.length).toBeGreaterThanOrEqual(2);
    expect(r.dockerCalls.every((c) => c.file === "docker")).toBe(true);
    expect(r.sqlCalls).toHaveLength(1);
    const sql = must(r.sqlCalls[0]);
    // the SQL runs inside the container the Docker side identified (no host/port/URL)
    expect(sql.args.slice(0, 2)).toEqual(["exec", CONTAINER]);
    expect(sql.args.join(" ")).toMatch(/pg_control_system\(\)/);
    expect(sql.args.join(" ")).toMatch(/current_database\(\)/);
    for (const arg of sql.args) {
      expect(arg).not.toMatch(/^-h$|^--host|:\/\/|password/i);
    }
  });

  it("records no connection URL, host credential, password or variable name", async () => {
    const dest = await prove(rig());
    const text = JSON.stringify(dest);
    expect(text).not.toMatch(/postgres(ql)?:\/\/|password|DATABASE_URL|PGPASSWORD|\/abs\/compose/i);
    // the block is writable by the catalog writer (no quotes, backslashes or empty lists)
    const catalog = { ...syntheticCatalog(), destination: dest };
    expect(() => emitCatalogYaml(catalog)).not.toThrow();
  });

  it("is not proven when the Postgres container is not running", async () => {
    const dest = await prove(rig({ ps: ok("") }));
    expect(dest.proven).toBe(false);
    expect(dest.independent_identity_sources).toBeUndefined();
    expect(must(dest.missing_reason)).toMatch(/docker-side/);
  });

  it("is not proven when the SQL side cannot be read", async () => {
    const dest = await prove(
      rig({ psql: { exit_code: 2, stdout: "", stderr: "psql: connection refused" } }),
    );
    expect(dest.proven).toBe(false);
    expect(must(dest.missing_reason)).toMatch(/sql-side/);
  });

  it("refuses identity output that is not the expected shape (never copies arbitrary text)", async () => {
    const dest = await prove(
      rig({ psql: ok("postgres://user:pw@localhost:5432/elephant|elephant|16.4\n") }),
    );
    expect(dest.proven).toBe(false);
    expect(JSON.stringify(dest)).not.toMatch(/postgres:\/\/|pw@/);
  });

  it("is not proven when the inspected container differs from the compose container", async () => {
    const dest = await prove(
      rig({ inspect: ok(`${"c".repeat(64)} ${IMAGE_DIGEST} postgres:16 running\n`) }),
    );
    expect(dest.proven).toBe(false);
  });

  it("is not proven when a runner throws (Docker not installed)", async () => {
    const r = rig();
    const dest = await proveDestination({
      docker: async () => {
        throw new Error("spawn docker ENOENT");
      },
      sql: r.sql,
      now: () => AT,
    });
    expect(dest.proven).toBe(false);
    expect(must(dest.missing_reason)).toMatch(/docker-side/);
  });
});

describe("OR-m4 destination proof: the configured loader connection", () => {
  it("records a config-side identity equal to the sql-side system identifier", async () => {
    const dest = await prove(rig());
    const ids = must(dest.independent_identity_sources);
    expect(ids[2]).toMatch(/^config-side: .*system_identifier \d+, equal to the sql-side/);
    expect(ids.join(" ")).not.toMatch(/DATABASE_URL|postgres(?:ql)?:\/\//);
  });

  it("is not proven without the configured-connection check", async () => {
    const dest = await prove(rig(), null);
    expect(dest.proven).toBe(false);
    expect(must(dest.missing_reason)).toMatch(
      /config-side: the configured connection was not checked/,
    );
  });

  it("is not proven when the configured connection reaches another database", async () => {
    const dest = await prove(rig(), async () => "1234567890123456789");
    expect(dest.proven).toBe(false);
    expect(must(dest.missing_reason)).toMatch(/config-side: .*different database/);
  });

  it("is not proven when the configured connection fails, and never repeats its message", async () => {
    const dest = await prove(rig(), async () => {
      throw new Error("connect ECONNREFUSED postgres://u:secret@h:5432/db");
    });
    expect(dest.proven).toBe(false);
    expect(must(dest.missing_reason)).not.toMatch(/secret|postgres:/);
  });
});
