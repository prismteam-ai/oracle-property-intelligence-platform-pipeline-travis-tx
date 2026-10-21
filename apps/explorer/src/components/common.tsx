import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '@travis/api-client';
import { fmtTime } from '../lib/format.js';

export function Section({
  title,
  step,
  children,
}: {
  title: string;
  step?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <h2>
        {title}
        {step ? <span className="step"> · demo {step}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/** After a few seconds it says why: an idle API opens its data service on the first call (decisions.md section 31). */
export function Loading({ what }: { what: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, []);
  return (
    <p className="muted" role="status">
      Loading {what}…
      {slow
        ? ' The first request after a quiet period starts the data service, which can take up to about 15 seconds.'
        : null}
    </p>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError
      ? `${error.status} ${error.code ?? ''}${error.detail ? ` (${error.detail})` : ''}${error.requestId ? ` · request ${error.requestId}` : ''}`
      : String(error);
  return (
    <p className="error" role="alert">
      {message}
    </p>
  );
}

export function Cid({ value }: { value: string }) {
  return (
    <code className="cid" title={value}>
      {value}
    </code>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Provenance({
  source,
  recordCid,
}: {
  source: {
    dataset: string;
    record_id: string | null;
    url: string;
    fetched_at: string;
    run_id: string;
  };
  recordCid?: string | null;
}) {
  return (
    <div className="provenance">
      <span>source {source.dataset}</span>
      {source.record_id ? <span> · record {source.record_id}</span> : null}
      <span> · fetched {fmtTime(source.fetched_at)}</span>
      <span> · run {source.run_id}</span>
      {recordCid ? (
        <span>
          {' '}
          · record CID <Cid value={recordCid} />
        </span>
      ) : null}
    </div>
  );
}
