// Coverage · "Source speed and constraints" and "Cost" (A-16 T041, AC-3..AC-5, FR-003..FR-005;
// boards Coverage1440/768/390 and CoverageStates). Every figure is a cell of `docs/cost.md` or
// `docs/source-limits.md`, carried by `content/cost-limits.generated.json` (scripts/
// build-cost-limits.mjs, drift-tested), so the page cannot say more than the docs. The JSON is
// parsed with its Zod schema at load: a doc change that breaks the shape fails here, not as a
// half-rendered table.
//
// Honesty rules (AC-5): a figure the docs call "not available" shows `not available · {reason}`
// and never a zero; Cost Explorer lags a day, so the section says "as of {last billed day}" and a
// partial day is shown apart as partial; gross usage and credits are shown apart so the $0.00
// net is never read as "no cost"; a source that never became reachable shows "Blocked" with the
// dates, not a throughput.
//
// Style pass (PO 2026-10-26 06:25): Cost reads as the board's two-column resource list (name,
// the doc's parenthetical and per-use line under it, the fixed figure on the right; who pays and
// the bill line open with Details), followed by the usage, credits and budget tiles.
//
// Compact layout (A-16 PO note 2026-10-26, board Coverage1440 "Source speed and constraints"):
// full-width tables with fixed column shares; each row shows a short name (the doc's parenthetical
// as a helper line) and every cell clamped to a few lines, with a per-row "Details" toggle that
// opens the full doc text. The clamp is visual only: every cell keeps the doc's whole text, so the
// page still says exactly what the docs say. Below 840 px each row stacks as label/value lines.
// Justified differences from the board: the board's "Last bill · September" tile is the docs'
// "Gross usage" window (real figures, a window of billed days rather than a calendar month); the
// board's "Cost evidence: cost.json" link is the docs file named in the source line, since no
// cost.json is built at deploy time; the board's short cells ("~50,000 rows/min") are sample
// text, so the doc's measured sentences are shown, clamped.
import type { ReactElement, ReactNode } from "react";
import { Icon } from "../components/Icon";
import { StatusPill } from "../components/StatusPill";
import raw from "../content/cost-limits.generated.json";
import { CostLimits, type CostRow, type LimitRow } from "../content/cost-limits.schema";
import styles from "./CoverageCostLimits.module.css";
import runsStyles from "./Runs.module.css";

const DATA = CostLimits.parse(raw);

/** `$9.25` / `-$9.25`: cents. A non-zero amount under a cent reads `< $0.01`, never `$0.00`. */
export function usd(value: number): string {
  const abs = Math.abs(value);
  const text = abs > 0 && abs < 0.005 ? "< $0.01" : `$${abs.toFixed(2)}`;
  return value < 0 ? `-${text}` : text;
}

/** The doc's cost sentences print Cost Explorer figures to four decimals; show them in cents. */
export function centsInText(text: string | null): string | null {
  if (text === null) return null;
  return text.replace(/\$(\d+\.\d{3,})/g, (_, amount: string) => usd(Number(amount)));
}

/**
 * "Travis County GIS layer 6 (tcad_gis)" → ["Travis County GIS layer 6", " ", "tcad_gis"]: the
 * short label, the exact space before the last parenthetical and its text, so that label + space +
 * "(" + detail + ")" is the doc's name again, character for character.
 */
function splitName(name: string): readonly [string, string, string | null] {
  const match = /^(.+?)(\s*)\(([^()]+)\)$/.exec(name);
  return match === null ? [name, "", null] : [match[1] ?? name, match[2] ?? "", match[3] ?? null];
}

/** A table cell; inside a `.compact` table CSS clamps its content until the row is opened. */
function Cell({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <td role="cell" data-label={label}>
      <div>{children}</div>
    </td>
  );
}

/** The first cell of a compact row: the short name, its parenthetical as a helper line (CSS). */
function NameCell({
  label,
  name,
}: {
  readonly label: string;
  readonly name: string;
}): ReactElement {
  const [short, space, detail] = splitName(name);
  return (
    <td role="cell" data-label={label}>
      <span>
        <b>{short}</b>
        {detail === null ? null : (
          <>
            {space}
            <span>({detail})</span>
          </>
        )}
      </span>
    </td>
  );
}

/**
 * The last cell of a compact row: a native disclosure whose open state lifts the row's clamps in
 * CSS (`tr:has(details[open])`), so the toggle costs no script (bundle budget).
 */
const TOGGLE_CELL = (
  <td role="cell" data-label="Full text">
    <details>
      <summary>Details</summary>
    </details>
  </td>
);

/** The header cell over the toggles (named for screen readers, no visible text). */
const TOGGLE_HEAD = (
  <th role="columnheader">
    <span>Full text</span>
  </th>
);

export function SourceSpeed(): ReactElement {
  const { limits } = DATA;
  return (
    <section
      className={runsStyles.card}
      aria-labelledby="speed-heading"
      data-section="source-limits"
    >
      <div>
        <h3 id="speed-heading" className={runsStyles.sectionTitle}>
          Source speed and constraints
        </h3>
        <p className={runsStyles.helperText} data-as-of={limits.asOf}>
          as of {limits.asOf} · source: measurements from this repository&apos;s runs
          (docs/source-limits.md)
        </p>
      </div>
      <div className={runsStyles.tableWrap}>
        <table
          role="table"
          className={`${runsStyles.table} ${styles.stack} ${styles.compact}`}
          aria-label="Source limits"
        >
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">Source</th>
              <th role="columnheader">Access and page size</th>
              <th role="columnheader">Throughput</th>
              <th role="columnheader">Rate limit</th>
              <th role="columnheader">Full capture</th>
              <th role="columnheader">Constraints</th>
              {TOGGLE_HEAD}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {limits.rows.map((row) => (
              <LimitTableRow key={row.source} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      <p className={runsStyles.provenance}>
        <Icon name="info" size="small" />
        <span>
          Throughput and times are measurements from the run log. &quot;Not available&quot; says why
          a figure was never measured; &quot;Blocked&quot; lists the days the source refused access.
          Details opens the full text of a row.
        </span>
      </p>
      {/* Folded by default (PO note: compact page); a native disclosure, no script. */}
      <details>
        <summary className={runsStyles.sectionTitle}>
          Publication and read path · {limits.readPath.length} steps
        </summary>
        <div className={runsStyles.tableWrap}>
          <table
            role="table"
            className={`${runsStyles.table} ${styles.stack}`}
            aria-label="Publication and read path"
          >
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader">Step</th>
                <th role="columnheader">Measured</th>
                <th role="columnheader">Limit and effect</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {limits.readPath.map((row) => (
                <PathRow key={row.step} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

type PathStep = (typeof DATA)["limits"]["readPath"][number];

function PathRow({ row }: { readonly row: PathStep }): ReactElement {
  return (
    <tr role="row" data-path-step={row.step}>
      <NameCell label="Step" name={row.step} />
      <Cell label="Measured">{row.measured}</Cell>
      <Cell label="Limit and effect">{row.limit}</Cell>
    </tr>
  );
}

function LimitTableRow({ row }: { readonly row: LimitRow }): ReactElement {
  return (
    <tr role="row" data-limit-source={row.source} data-status={row.status}>
      <NameCell label="Source" name={row.source} />
      <Cell label="Access and page size">{row.pageSize}</Cell>
      <td role="cell" data-label="Throughput">
        <div>
          {row.status === "blocked" ? (
            <StatusPill status="error" icon="block" text="Blocked" />
          ) : row.status === "not_measured" ? (
            <StatusPill
              status="unavailable"
              text={`Not available · ${row.missingReason ?? ""}`}
              data={{ field: "throughput" }}
              short="Not available"
            />
          ) : (
            row.throughput
          )}
          {row.status === "blocked" ? (
            <span className={runsStyles.helper} data-blocked-dates={row.blockedDates.join(",")}>
              {" "}
              refused on {row.blockedDates.join(", ")}
            </span>
          ) : null}
        </div>
      </td>
      <Cell label="Rate limit">{row.rateLimit}</Cell>
      <Cell label="Full capture">{row.fullCapture}</Cell>
      <Cell label="Constraints">
        {row.antiBot}
        {row.optimisation === null ? null : (
          <span className={runsStyles.helper}> · Applied: {row.optimisation}</span>
        )}
      </Cell>
      {TOGGLE_CELL}
    </tr>
  );
}

export function CostSection(): ReactElement {
  const { cost } = DATA;
  return (
    <section className={runsStyles.card} aria-labelledby="cost-heading" data-section="cost">
      <div className={runsStyles.cardHead}>
        <div>
          <h3 id="cost-heading" className={runsStyles.sectionTitle}>
            Cost
          </h3>
          <p className={runsStyles.helperText} data-as-of={cost.asOf}>
            as of {cost.asOf} (last full billed day) · source: {cost.source} (docs/cost.md)
          </p>
        </div>
        <StatusPill
          status="verified"
          icon="savings"
          text={`${cost.fixedPerMonth} fixed per month`}
        />
      </div>
      {cost.partialDay === null ? null : (
        <div role="status" className={styles.notice} data-partial-day={cost.partialDay.day}>
          <Icon name="schedule" size="medium" />
          <p className={styles.noticeText}>
            <b>Partial (as of {cost.asOf}).</b> {cost.partialDay.day} is a partial, estimated day:{" "}
            {usd(cost.partialDay.grossUsd)} gross so far. It is shown apart and not added to the
            totals below.
          </p>
        </div>
      )}
      <div className={runsStyles.tableWrap}>
        <table
          role="table"
          className={`${runsStyles.table} ${styles.stack} ${styles.compact} ${styles.costList}`}
          aria-label="Deployed resources and idle cost"
        >
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">Deployed resource</th>
              <th role="columnheader">Fixed (idle) per month</th>
              <th role="columnheader">Per use</th>
              <th role="columnheader">Who pays per use</th>
              <th role="columnheader">Seen in the bill</th>
              {TOGGLE_HEAD}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {cost.rows.map((row) => (
              <CostTableRow key={row.component} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      {/* Board order: the resource list, then the bill and budget tiles. */}
      <div className={styles.costTiles}>
        <div className={runsStyles.tile} data-tile="gross">
          <span className={runsStyles.tileLabel}>Gross usage · {cost.gross.window}</span>
          {cost.gross.usd === null ? (
            <StatusPill
              status="unavailable"
              text={`Not available · ${cost.gross.missingReason ?? ""}`}
            />
          ) : (
            <b className={runsStyles.tileBig}>{usd(cost.gross.usd)}</b>
          )}
          <span className={runsStyles.tileLabel}>
            Real usage before credits (Cost Explorer, record type Usage)
          </span>
        </div>
        <div className={runsStyles.tile} data-tile="credits">
          <span className={runsStyles.tileLabel}>Credits · {cost.credits.window}</span>
          {cost.credits.usd === null ? (
            <StatusPill
              status="unavailable"
              text={`Not available · ${cost.credits.missingReason ?? ""}`}
            />
          ) : (
            <b className={runsStyles.tileBig}>{usd(cost.credits.usd)}</b>
          )}
          <span className={runsStyles.tileLabel}>
            Shown apart from usage: a net bill offset by credits is not &quot;no cost&quot;
          </span>
        </div>
        <div className={runsStyles.tile} data-tile="budget">
          <span className={runsStyles.tileLabel}>Budget alert</span>
          {cost.budget.text === null ? (
            <StatusPill
              status="unavailable"
              text={`Not available · ${cost.budget.missingReason ?? ""}`}
            />
          ) : (
            <b className={runsStyles.sectionTitle}>{cost.budget.text}</b>
          )}
          <span className={runsStyles.tileLabel}>Owned by the CDK Ops stack</span>
        </div>
      </div>
      <p className={runsStyles.provenance}>
        <Icon name="info" size="small" />
        <span>
          Fixed means recurring fees; per-use lines are real and are paid from credits. Figures are
          estimated by AWS and the account also hosts another project, so they are an upper bound.
        </span>
      </p>
    </section>
  );
}

function CostTableRow({ row }: { readonly row: CostRow }): ReactElement {
  const filebase = row.idle === null;
  return (
    <tr role="row" data-cost-row={row.component}>
      <NameCell label="Deployed resource" name={row.component} />
      <Cell label="Fixed (idle) per month">
        {filebase ? (
          <StatusPill
            status="unavailable"
            text={`Filebase usage: not available · ${row.missingReason ?? ""}`}
            data={{ field: "filebase_usage" }}
            short="Filebase usage: not available"
          />
        ) : (
          centsInText(row.idle)
        )}
      </Cell>
      <Cell label="Per use">{centsInText(row.perUse)}</Cell>
      <Cell label="Who pays per use">{row.whoPays}</Cell>
      <Cell label="Seen in the bill">{centsInText(row.seenInBill)}</Cell>
      {TOGGLE_CELL}
    </tr>
  );
}
