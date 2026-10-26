// Data · Verify (`/data/verify/:cid`; A-13 T023, AC-3, AC-7, FR-003, FR-003a–c, FR-016; TC-006,
// TC-018 … TC-023). The CID is looked up in the latest manifest's artifacts, then along the run
// chain (each older manifest and its artifacts); a run manifest itself is verified against the
// size and SHA-256 of the bytes the read path already accepted by CID. The page result, then
// "Counted gateways" (Pinata, orbitor: public gateways CountyLens does not operate) and the
// "Fallback gateway" group (Filebase, our main storage host, never counted), each lane an h4
// (AM-10; data/verify-lane: plain GET, never the CID copy). "Verified on Pinata and orbitor"
// depends on those two lanes only. "Stored on" closes the page. A CID found nowhere is an error
// banner, never an empty lane. The manifest read shows the fallback chip when Filebase served
// it; the lanes are unaffected. A react-router lazy route module.
import type { RunManifestV1 } from "@countylens/contract";
import { PROGRESS_LABELS, VERIFY_TEXTS, verifyPath, type ReadPathUrls } from "@countylens/shared";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Navigate, useParams } from "react-router";
import { DataTabs } from "../components/DataTabs";
import { CidDisplay } from "../components/CidDisplay";
import { ComingSoonEntries } from "../components/ComingSoonEntry";
import { ErrorBanner } from "../components/ErrorBanner";
import { FallbackChip } from "../components/FallbackChip";
import { LinearProgress } from "../components/LinearProgress";
import { Provenance } from "../components/Provenance";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { VerifyLane } from "../components/VerifyLane";
import { loadRunChain } from "../data/run-chain";
import type { LoadedRun } from "../data/run-loader";
import {
  VERIFY_FALLBACK_GATEWAYS,
  VERIFY_INDEPENDENT_GATEWAYS,
  independentResult,
  independentResultStatus,
  verifyLaneUrl,
  verifyUrlsFromEnv,
  type LaneState,
  type VerifyGateway,
  type VerifyTarget,
} from "../data/verify-lane";
import {
  RUN_STAGE_TEXTS,
  StoredOn,
  runErrorNode,
  loadManifestByCid,
  useLatestRun,
} from "./Runs.shared";
import runStyles from "./Runs.module.css";
import styles from "./DataManifest.module.css";

/** Shown when the CID is neither a manifest nor an artifact of any run in the chain. */
const CID_NOT_PUBLISHED = (cid: string): string =>
  `${cid} is not a manifest or an artifact of any published run`;

interface Found {
  readonly name: string;
  readonly target: VerifyTarget;
  readonly runId: string;
  readonly manifestCid: string;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function inManifest(manifest: RunManifestV1, manifestCid: string, cid: string): Found | null {
  const artifact = manifest.artifacts.find((a) => a.cid === cid);
  if (artifact === undefined) return null;
  return {
    name: artifact.name,
    runId: manifest.runId,
    manifestCid,
    target: {
      cid: artifact.cid,
      size: artifact.size,
      sha256: artifact.sha256,
      kind: artifact.kind,
      codec: artifact.codec,
    },
  };
}

async function asManifest(cid: string, bytes: Uint8Array, runId: string): Promise<Found> {
  return {
    name: "run manifest",
    runId,
    manifestCid: cid,
    target: {
      cid,
      size: bytes.length,
      sha256: await sha256Hex(bytes),
      kind: "table",
      codec: "raw",
    },
  };
}

/** The latest run first, then each older manifest of the chain. */
const MAX_CHAIN_LINKS = 100;

async function findCid(run: LoadedRun, cid: string, signal: AbortSignal): Promise<Found | null> {
  if (cid === run.manifestCid) return asManifest(cid, run.read.bytes, run.manifest.runId);
  const direct = inManifest(run.manifest, run.manifestCid, cid);
  if (direct !== null) return direct;
  // One link at a time (loadRunChain with a single link): each older manifest is checked as it
  // loads and the walk stops at the first hit, so an unreadable ancestor further back never
  // fails a CID that a newer manifest already holds.
  const seen = new Set<string>([run.manifestCid]);
  let cursor = run.manifest.previousManifestCid;
  while (cursor !== null && !seen.has(cursor) && seen.size <= MAX_CHAIN_LINKS) {
    seen.add(cursor);
    let older: { manifest: RunManifestV1; bytes: Uint8Array } | undefined;
    const [link] = await loadRunChain(
      cursor,
      async (c) => {
        const m = await loadManifestByCid(c, signal);
        older = { manifest: m.manifest, bytes: m.read.bytes };
        return m.manifest;
      },
      1,
    );
    if (link === undefined || older === undefined) break;
    if (link.manifestCid === cid) return asManifest(cid, older.bytes, link.runId);
    const found = inManifest(older.manifest, link.manifestCid, cid);
    if (found !== null) return found;
    cursor = link.previousManifestCid;
  }
  return null;
}

export function Component(): ReactElement {
  const { cid = "" } = useParams();
  const { state, retry } = useLatestRun();
  // A bare /data/verify verifies the latest run manifest (hosted review B-6).
  if (cid === "" && state.kind === "ready") {
    return <Navigate to={verifyPath(state.run.manifestCid)} replace />;
  }
  return (
    <section
      aria-label="Data · Verify"
      data-route="data-verify"
      data-state={state.kind}
      className={styles.page}
    >
      <h2 className={styles.pageTitle}>Data</h2>
      <DataTabs current="verify" verifyCid={null} />
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
          <Skeleton variant="cards" count={2} />
        </>
      ) : null}
      {state.kind === "error" ? (
        <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
      ) : null}
      {state.kind === "ready" ? <VerifyView key={cid} run={state.run} cid={cid} /> : null}
      {/* A-16 style pass: the board opens on the file and its lanes; the Coming soon entry
          for the gateway race follows them. */}
      <ComingSoonEntries ids={["gateway-race"]} />
    </section>
  );
}

type ViewState =
  | { readonly kind: "finding" }
  | { readonly kind: "found"; readonly found: Found; readonly urls: ReadPathUrls }
  | { readonly kind: "error"; readonly message: string };

function VerifyView({ run, cid }: { readonly run: LoadedRun; readonly cid: string }): ReactElement {
  const [state, setState] = useState<ViewState>({ kind: "finding" });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const urls = verifyUrlsFromEnv();
        const found = await findCid(run, cid, controller.signal);
        if (controller.signal.aborted) return;
        setState(
          found === null
            ? { kind: "error", message: CID_NOT_PUBLISHED(cid) }
            : { kind: "found", found, urls },
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => controller.abort();
  }, [run, cid]);

  return (
    <>
      {state.kind === "finding" ? <Skeleton variant="cards" count={2} /> : null}
      {state.kind === "error" ? <ErrorBanner message={state.message} /> : null}
      {state.kind === "found" ? (
        <>
          {/* Board DataVerify1440: the file card (name, then CID · size · codec · digest). */}
          <article
            className={`${styles.tableCard} ${styles.targetCard}`}
            aria-labelledby="verify-target"
          >
            <h3 id="verify-target" className={styles.cardTitle}>
              {state.found.name}
            </h3>
            <p className={`${runStyles.itemBody} ${styles.targetLine}`}>
              CID <CidDisplay cid={state.found.target.cid} /> ·{" "}
              {state.found.target.size.toLocaleString("en-US")} bytes · codec{" "}
              {state.found.target.codec} · expected SHA-256{" "}
              <span className={styles.mono} title={state.found.target.sha256}>
                {state.found.target.sha256.slice(0, 8)}…{state.found.target.sha256.slice(-4)}
              </span>
            </p>
            <Provenance>
              Manifest <CidDisplay cid={state.found.manifestCid} /> · run {state.found.runId}
            </Provenance>
          </article>
          <Lanes urls={state.urls} target={state.found.target} />
          <StoredOn />
        </>
      ) : null}
      {/* The manifest read (and the fallback chip) as the board's note under the lanes. */}
      <div className={`${runStyles.header} ${runStyles.itemBody}`}>
        <span>Manifest read for run {run.manifest.runId}</span>
        <FallbackChip source={run.read.source} />
      </div>
    </>
  );
}

/** The page result (independent lanes only), the independent lanes, then the fallback lane. */
function Lanes({
  urls,
  target,
}: {
  readonly urls: ReadPathUrls;
  readonly target: VerifyTarget;
}): ReactElement {
  const [states, setStates] = useState<Partial<Record<VerifyGateway, LaneState>>>({});
  const onState = useCallback((gateway: VerifyGateway, next: LaneState) => {
    setStates((prev) => (prev[gateway] === next ? prev : { ...prev, [gateway]: next }));
  }, []);
  const result = independentResult(states);
  const lane = (gateway: VerifyGateway): ReactElement => (
    <VerifyLane
      key={gateway}
      gateway={gateway}
      url={verifyLaneUrl(urls, gateway, target.cid)}
      target={target}
      onState={onState}
      headingLevel={4}
    />
  );
  return (
    <>
      <p
        className={runStyles.itemBody}
        role="status"
        aria-live="polite"
        data-verify-result={result.kind}
      >
        <StatusPill status={independentResultStatus(result)} text={result.text} />
      </p>
      <h3 className={runStyles.sectionTitle}>{VERIFY_TEXTS.countedLanesTitle}</h3>
      <p className={runStyles.helperText} data-retired-gateways="">
        {VERIFY_TEXTS.retiredGatewaysNote}
      </p>
      <div className={styles.lanes} data-lanes="independent">
        {VERIFY_INDEPENDENT_GATEWAYS.map(lane)}
      </div>
      <h3 className={runStyles.sectionTitle}>{VERIFY_TEXTS.fallbackLanesTitle}</h3>
      <div className={`${styles.lanes} ${styles.lanesFull}`} data-lanes="fallback">
        {VERIFY_FALLBACK_GATEWAYS.map(lane)}
      </div>
    </>
  );
}
