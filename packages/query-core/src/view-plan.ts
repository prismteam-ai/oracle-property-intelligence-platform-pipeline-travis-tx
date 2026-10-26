// ERR-19 (A-03 AC-7, NFR-004): which contract views a query reads, and which views and export
// tables each views.sql statement reads, so bindManifest can bind only what a query needs. A
// cold `runs.summary` bound all emitted tables (two sequential range requests per part over
// presigned URLs) before a query that reads v_roofing_permit and v_run only.
// Derived from VIEWS_SQL itself (no hand-kept list to drift): the statements are split at each
// `CREATE OR REPLACE VIEW`, comments are stripped, and the `county.<t>` /
// `property_improvement.<t>` relations and the earlier views each statement names are collected.
// test/view-plan.test.ts pins the result. Browser-safe: no node: import.
import { VIEWS_SQL } from "./sql.js";

/** The contract/v1 views a builder may read, in views.sql order. */
export const CONTRACT_VIEWS = ["v_property", "v_roofing_permit", "v_contractor", "v_run"] as const;
export type ContractView = (typeof CONTRACT_VIEWS)[number];

export interface ViewStatement {
  /** `meta.permit` or a contract view name. */
  readonly name: string;
  /** The statement text (one `CREATE OR REPLACE VIEW … ;`). */
  readonly sql: string;
  /** `<group>.<table>` export relations the statement reads directly. */
  readonly tables: ReadonlySet<string>;
  /** Earlier views.sql views the statement reads directly. */
  readonly views: ReadonlySet<string>;
}

const CREATE = /^CREATE OR REPLACE VIEW ([\w.]+) AS\b/;
const TABLE_REF = /\b(county|property_improvement)\.(\w+)\b/g;
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, "");

function splitViews(sql: string): ViewStatement[] {
  const out: ViewStatement[] = [];
  for (const chunk of sql.split(/^(?=CREATE OR REPLACE VIEW )/m)) {
    const name = CREATE.exec(chunk)?.[1];
    if (name === undefined) continue; // the header comment block
    const code = stripComments(chunk);
    const tables = new Set([...code.matchAll(TABLE_REF)].map((m) => `${m[1]}.${m[2]}`));
    // meta.address_zip is built by bindManifest from county.address (see bind-manifest.ts).
    if (/\bmeta\.address_(zip|fields)\b/.test(code)) tables.add("county.address");
    const views = new Set(
      out.map((s) => s.name).filter((v) => new RegExp(`\\b${escape(v)}\\b`).test(code)),
    );
    out.push({ name, sql: chunk, tables, views });
  }
  return out;
}

/** views.sql as its view statements, in file order. */
export const VIEW_STATEMENTS: readonly ViewStatement[] = splitViews(VIEWS_SQL);

const CONTRACT_VIEW_REF = new RegExp(`\\b(${CONTRACT_VIEWS.join("|")})\\b`, "g");

/** The contract views `sql` reads (a query-core builder's text), in CONTRACT_VIEWS order. */
export function viewsReadBy(sql: string): ContractView[] {
  const named = new Set([...sql.matchAll(CONTRACT_VIEW_REF)].map((m) => m[1]));
  return CONTRACT_VIEWS.filter((v) => named.has(v));
}

export interface ViewPlan {
  /** The statements to run, in views.sql order (requested views and the views they read). */
  readonly statements: readonly ViewStatement[];
  /** `<group>.<table>` relations those statements read. */
  readonly tables: ReadonlySet<string>;
  /** The contract views the plan creates, in CONTRACT_VIEWS order. */
  readonly views: readonly ContractView[];
}

/** The statements and export relations needed to create `views` (transitively). */
export function planViews(views: readonly ContractView[]): ViewPlan {
  const byName = new Map(VIEW_STATEMENTS.map((s) => [s.name, s]));
  const wanted = new Set<string>();
  const visit = (name: string): void => {
    if (wanted.has(name)) return;
    const statement = byName.get(name);
    if (statement === undefined) throw new Error(`planViews: views.sql has no view ${name}`);
    wanted.add(name);
    for (const v of statement.views) visit(v);
  };
  for (const v of views) visit(v);
  const statements = VIEW_STATEMENTS.filter((s) => wanted.has(s.name));
  return {
    statements,
    tables: new Set(statements.flatMap((s) => [...s.tables])),
    views: CONTRACT_VIEWS.filter((v) => wanted.has(v)),
  };
}
