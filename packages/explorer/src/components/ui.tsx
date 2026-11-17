import type { Row } from "@travis-oracle/query-core";
import { type ReactNode, useState } from "react";
import { formatValue, shortCid } from "../format.js";
import { gatewayUrl } from "../ipfs/gateways.js";

const COPIED_MS = 1_200;
const URL_VALUE = /^https?:\/\//;

export function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {detail && <span className="stat-detail">{detail}</span>}
    </div>
  );
}

export type Tone = "good" | "bad" | "warn" | "neutral" | "info";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Cid({ cid, link = true }: { cid: string; link?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(cid);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <span className="cid" title={cid}>
      {link ? (
        <a href={gatewayUrl(cid)} target="_blank" rel="noreferrer">
          {shortCid(cid)}
        </a>
      ) : (
        <code>{shortCid(cid)}</code>
      )}
      <button type="button" className="icon-button" onClick={copy} aria-label={`Copy ${cid}`}>
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" />
      {label}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="error-note" role="alert">
      {message}
    </div>
  );
}

export function Cell({ value, column }: { value: unknown; column?: string }) {
  if (typeof value === "string" && URL_VALUE.test(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer">
        {new URL(value).host}
      </a>
    );
  }
  return <>{formatValue(value, column)}</>;
}

export function DataTable({
  rows,
  columns,
  onSelect,
  selected,
  empty = "No rows.",
}: {
  rows: Row[];
  columns?: string[];
  onSelect?: (row: Row, index: number) => void;
  selected?: number | undefined;
  empty?: string;
}) {
  const shown = columns ?? Object.keys(rows[0] ?? {});
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="table-scroll results">
      <table className="data-table compact">
        <thead>
          <tr>
            {shown.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable identity
              key={index}
              className={[onSelect ? "selectable" : "", selected === index ? "selected" : ""].join(
                " ",
              )}
              onClick={onSelect ? () => onSelect(row, index) : undefined}
            >
              {shown.map((column) => (
                <td key={column}>
                  <Cell value={row[column]} column={column} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="disclosure">
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
