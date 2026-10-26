// The Atlas § 8 provenance line (A-03 T055): body-small, on-surface-variant, leading
// `description` icon. For a permit row (plan § "Atlas element map" → Row provenance):
// `Source: {source_url as link} · collected {captured_at} UTC · table {table_cid, truncated +
// copy} · run {run_id}` (TC-021); an absent source URL shows the Missing-reason label of its
// `missing` entry, never a blank. The generic form renders any children on the same line (the
// Runs card: `Index: this site (/runs/index.json) · Manifest: {CID}`). Render-only: the caller
// picks the values; this file formats them.
import type { ReactElement, ReactNode } from "react";
import type { Missing } from "@countylens/contract";
import { safeHttpUrl } from "../data/safe-url";
import { CidDisplay } from "./CidDisplay";
import { Icon } from "./Icon";
import { MissingReason } from "./MissingReason";
import styles from "./Provenance.module.css";

/** An ISO 8601 instant as a UTC calendar time, `2026-10-20 14:02:05` (the caller adds "UTC"). */
export function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** A source URL as a link when it is http(s); anything else (javascript:, data:, …) is plain text. */
export function SourceLink({
  url,
  className,
}: {
  readonly url: string;
  readonly className?: string | undefined;
}): ReactElement {
  const href = safeHttpUrl(url);
  if (href === undefined) return <span data-unsafe-url="">{url}</span>;
  return (
    <a
      href={href}
      {...(className === undefined ? {} : { className })}
      rel="noopener noreferrer"
      target="_blank"
    >
      {url}
    </a>
  );
}

export interface PermitProvenanceProps {
  /** The row's `source_url`; null only with a `missing` entry for `source_url`. */
  readonly sourceUrl: string | null;
  /** The row's `missing` entry for `source_url`, shown when `sourceUrl` is null. */
  readonly sourceUrlMissing?: Missing;
  /** The row's `captured_at` (manifest `sources[].captured_at`). */
  readonly capturedAt: string;
  /** The row's `table_cid`: the part artifact's CID from the manifest. */
  readonly tableCid: string;
  /** The row's `run_id` (manifest `runId`). */
  readonly runId: string;
}

export interface GenericProvenanceProps {
  readonly children: ReactNode;
}

export type ProvenanceProps = PermitProvenanceProps | GenericProvenanceProps;

function isGeneric(props: ProvenanceProps): props is GenericProvenanceProps {
  return "children" in props;
}

function PermitLine({
  sourceUrl,
  sourceUrlMissing,
  capturedAt,
  tableCid,
  runId,
}: PermitProvenanceProps): ReactElement {
  // contract/v1 Provenance: source_url is null only with a `not_in_export` entry.
  const missing: Missing = sourceUrlMissing ?? { field: "source_url", reason: "not_in_export" };
  return (
    <>
      Source:{" "}
      {sourceUrl === null ? (
        <MissingReason field={missing.field} reason={missing.reason} />
      ) : (
        <SourceLink url={sourceUrl} className={styles.link} />
      )}
      {" · collected "}
      <time dateTime={capturedAt}>{formatUtc(capturedAt)}</time>
      {" UTC · table "}
      <CidDisplay cid={tableCid} />
      {` · run ${runId}`}
    </>
  );
}

export function Provenance(props: ProvenanceProps): ReactElement {
  return (
    <div className={styles.line}>
      <Icon name="description" size="small" />
      <span className={styles.text}>
        {isGeneric(props) ? props.children : <PermitLine {...props} />}
      </span>
    </div>
  );
}
