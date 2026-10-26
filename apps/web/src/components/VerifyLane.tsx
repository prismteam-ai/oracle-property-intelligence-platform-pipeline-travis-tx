// One Verify lane (A-13 T023; research R3, data-model.md VerifyLane; AC-3, AC-7, FR-003,
// FR-003a–c): an Atlas outlined card per public gateway with the operator name, the exact URL,
// the manifest's size and SHA-256 and, once the bytes arrived, the received size and the SHA-256
// computed in this page. The lane runs data/verify-lane's state machine on mount (a simple CORS
// GET, never the CID copy; backoff 2/4/8 s) and shows each state: retrying → "rate-limited,
// retrying" or "no readable response (rate-limited or blocked), retrying"; ✓ only in `verified`;
// a mismatch shows both values. Each lane states its role in plain facts (AM-10, PO 2026-10-26):
// Pinata and orbitor are the counted public gateways; Filebase is our main storage host, a
// labelled fallback that is never counted (`data-independent="false"`), so its match shows the
// neutral info glyph, never the green ✓. A counted lane that gave up after its retries says so
// ("no readable answer after retries"), never implying tampering. `data-lane` / `data-state` are the hooks the
// hosted tests read; `onState` reports each state to the page result.
// `fetch` and `sleep` are injectable for the unit tests only.
import { VERIFY_TEXTS, isIndependentGateway } from "@countylens/shared";
import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  runVerifyLane,
  type LaneState,
  type VerifyGateway,
  type VerifyTarget,
} from "../data/verify-lane";
import { formatBytes } from "../data/format";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import styles from "./VerifyLane.module.css";

export const GATEWAY_OPERATORS: Readonly<Record<VerifyGateway, string>> =
  VERIFY_TEXTS.gatewayOperators;

export interface VerifyLaneProps {
  readonly gateway: VerifyGateway;
  /** `https://{gateway host}/ipfs/{cid}` (verifyLaneUrl). */
  readonly url: string;
  readonly target: VerifyTarget;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Every state of this lane, for the page result (independent lanes only count). */
  readonly onState?: (gateway: VerifyGateway, state: LaneState) => void;
  /** The lane title's level: 3 on its own, 4 under the page's group headings. */
  readonly headingLevel?: 3 | 4;
}

export function VerifyLane({
  gateway,
  url,
  target,
  fetch: fetchImpl,
  sleep,
  onState,
  headingLevel = 3,
}: VerifyLaneProps): ReactElement {
  const [state, setState] = useState<LaneState>({ kind: "idle" });
  // A ref, so a new callback identity never restarts the lane's fetch.
  const report = useRef(onState);
  useEffect(() => {
    report.current = onState;
  });
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "idle" });
    report.current?.(gateway, { kind: "idle" });
    runVerifyLane({
      url,
      target,
      signal: controller.signal,
      onState: (next) => {
        if (controller.signal.aborted) return;
        setState(next);
        report.current?.(gateway, next);
      },
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      ...(sleep === undefined ? {} : { sleep }),
    }).catch(() => undefined);
    return () => controller.abort();
  }, [gateway, url, target, fetchImpl, sleep]);

  const titleId = `lane-${gateway}`;
  const independent = isIndependentGateway(gateway);
  const Title = headingLevel === 4 ? "h4" : "h3";
  const gotSize =
    state.kind === "verified" ? state.size : state.kind === "mismatch" ? state.got.size : 0;
  const gotSha =
    state.kind === "verified" ? state.sha256 : state.kind === "mismatch" ? state.got.sha256 : "";
  return (
    <section
      className={styles.lane}
      aria-labelledby={titleId}
      data-lane={gateway}
      data-state={state.kind}
      data-independent={independent ? "true" : "false"}
    >
      <Title id={titleId} className={styles.title}>
        {state.kind === "verified" ? (
          independent ? (
            <span className={styles.check} aria-label="verified">
              ✓
            </span>
          ) : (
            <Icon name="info" size="small" />
          )
        ) : null}
        {GATEWAY_OPERATORS[gateway]}
      </Title>
      <p className={styles.role} data-lane-role="">
        {independent ? (
          VERIFY_TEXTS.laneRoles[gateway]
        ) : (
          <StatusPill status="info" text={VERIFY_TEXTS.laneRoles[gateway]} />
        )}
      </p>
      <p className={styles.url}>
        <code>{url}</code>
      </p>
      <dl className={styles.values}>
        <dt>Manifest size</dt>
        <dd data-expected-size="" data-value={target.size}>
          {formatBytes(target.size)}
        </dd>
        <dt>Manifest SHA-256</dt>
        <dd className={styles.digest} data-expected-sha256="" data-value={target.sha256}>
          {target.sha256}
        </dd>
        {state.kind === "verified" || state.kind === "mismatch" ? (
          <>
            <dt>Received size</dt>
            <dd data-got-size="" data-value={gotSize}>
              {formatBytes(gotSize)}
            </dd>
            <dt>SHA-256 computed here</dt>
            <dd className={styles.digest} data-got-sha256="" data-value={gotSha}>
              {gotSha}
            </dd>
          </>
        ) : null}
      </dl>
      <LaneStatus state={state} independent={independent} gateway={gateway} />
    </section>
  );
}

/** One persistent polite region: its children change, so every state (final ones too) is spoken. */
interface LaneStatusProps {
  readonly state: LaneState;
  readonly independent: boolean;
  readonly gateway: VerifyGateway;
}

function LaneStatus(props: LaneStatusProps): ReactElement {
  return (
    <p className={styles.status} role="status" aria-live="polite">
      <LaneStatusBody {...props} />
    </p>
  );
}

/** Why a counted lane gave up after its retries: no readable bytes, not tampering. */
function gaveUpReason(gateway: VerifyGateway): string {
  return gateway === "pinata"
    ? `${VERIFY_TEXTS.laneGaveUp} · ${VERIFY_TEXTS.pinataGaveUp}`
    : VERIFY_TEXTS.laneGaveUp;
}

function LaneStatusBody({ state, independent, gateway }: LaneStatusProps): ReactElement {
  switch (state.kind) {
    case "idle":
    case "fetching":
      return <>Fetching{state.kind === "fetching" ? ` · try ${state.attempt}` : ""}</>;
    case "retrying":
      return (
        <>
          <StatusPill status="warning" text={state.text} /> next try in{" "}
          {Math.round(state.delayMs / 1000)} s
        </>
      );
    case "verified":
      return independent ? (
        <StatusPill status="verified" text={VERIFY_TEXTS.verified} />
      ) : (
        <StatusPill status="info" text={VERIFY_TEXTS.fallbackVerified} />
      );
    case "mismatch":
      return (
        <span role="alert">
          <StatusPill status="error" text={state.text} />
        </span>
      );
    case "failed":
      return (
        <span role="alert">
          <StatusPill status={state.cause === "retries" ? "warning" : "error"} text={state.text} />
          {independent && state.cause === "retries" ? (
            <span className={styles.reason} data-lane-reason="">
              {gaveUpReason(gateway)}
            </span>
          ) : null}
        </span>
      );
    case "via_car":
      return <StatusPill status="info" text={state.text} />;
  }
}
