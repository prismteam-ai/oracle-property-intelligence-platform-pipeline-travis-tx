// ERR-19 follow-up: the agent and MCP paths used to bind all four contract views up front (a view
// over every emitted table of a full-county run), which timed out agent.ask at 25 s. This wraps a
// QueryEngine so each statement first binds only the contract views its SQL names (the same rule
// the query/explore routers use). bindOnce is exclusive and a no-op for already-bound views, so
// concurrent calls are safe.
import { viewsReadBy, type ContractView, type QueryEngine, type Row } from "@countylens/query-core";
import { bindOnce } from "./duckdb-node.js";

export type BindViews = (cid: string, views: ContractView[]) => Promise<unknown>;

export function lazyViewEngine(
  engine: QueryEngine,
  manifestCid: string,
  bind: BindViews = bindOnce,
): QueryEngine {
  const ensure = async (sql: string): Promise<void> => {
    const views = viewsReadBy(sql);
    if (views.length > 0) await bind(manifestCid, views);
  };
  return {
    async all(sql: string): Promise<Row[]> {
      await ensure(sql);
      return engine.all(sql);
    },
    async run(sql: string): Promise<void> {
      await ensure(sql);
      return engine.run(sql);
    },
  };
}
