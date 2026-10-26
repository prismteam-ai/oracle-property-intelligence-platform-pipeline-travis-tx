// Data · Manifest (`/data/manifest`; A-13 T023, AC-3, FR-003c, FR-003d, FR-016; TC-005, TC-018,
// TC-019, TC-024). The run chain first: from the latest manifest back through
// `previousManifestCid` (data/run-chain), each run with its CID (Copy CID), finish time, previous
// CID or "previous: none", and a Verify link. Then the Atlas data table of every manifest artifact:
// name, CID, codec, size, SHA-256, CAR, and the action: "Verify" for a file ≤ 50 MB, "Verify via
// CAR" (linking to its CAR's Verify page when it has one) for a directory or a larger file. Every
// value is the manifest's; the fallback chip names Filebase when it served the read. "Stored on"
// (AM-10) says where the bytes live: Filebase pin, Pinata copy, GitHub Release CARs. A
// react-router lazy route module.
import type { ManifestArtifact, RunManifestV1 } from "@countylens/contract";
import { PROGRESS_LABELS, VERIFY_TEXTS, verifyPath } from "@countylens/shared";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { DataTabs } from "../components/DataTabs";
import { ErrorBanner } from "../components/ErrorBanner";
import { CidDisplay } from "../components/CidDisplay";
import { FallbackChip } from "../components/FallbackChip";
import { LinearProgress } from "../components/LinearProgress";
import { Provenance, formatUtc } from "../components/Provenance";
import { Skeleton } from "../components/Skeleton";
import { Icon } from "../components/Icon";
import { loadRunChain, type RunChainLink } from "../data/run-chain";
import type { LoadedRun } from "../data/run-loader";
import { RunSelect } from "../components/RunSelect";
import { runName, runNumbers, type RunNumber } from "../data/runs-index";
import { VERIFY_MAX_BYTES } from "../data/verify-lane";
import {
  RUN_STAGE_TEXTS,
  runErrorNode,
  loadManifestByCid,
  StoredOn,
  toRunLoadError,
  useLatestRun,
  type RunLoadError,
} from "./Runs.shared";
import runStyles from "./Runs.module.css";
import styles from "./DataManifest.module.css";

/** Shown in the CAR column of an artifact the manifest lists no CAR for (never blank). */
const NO_CAR_TEXT = "no CAR listed for this artifact";

export function Component(): ReactElement {
  const { state, retry } = useLatestRun();
  // The run picker: `?run={runId}` shows that indexed run's manifest; no parameter (or an
  // unknown run) shows the latest.
  const [params, setParams] = useSearchParams();
  const latest = state.kind === "ready" ? state.run : undefined;
  const wanted = params.get("run");
  const entry = latest?.index.runs.find(
    (r) => r.runId === wanted && r.runId !== latest.entry.runId,
  );
  const [other, setOther] = useState<LoadedRun | RunLoadError>();
  useEffect(() => {
    setOther(undefined);
    if (latest === undefined || entry === undefined) return;
    const controller = new AbortController();
    loadManifestByCid(entry.manifestCid, controller.signal).then(
      (read) => !controller.signal.aborted && setOther({ ...latest, entry, ...read }),
      (error: unknown) => !controller.signal.aborted && setOther(toRunLoadError(error)),
    );
    return () => controller.abort();
  }, [latest, entry]);
  const failed = other && !("manifest" in other) ? other : undefined;
  const shown = entry ? (failed ? undefined : (other as LoadedRun | undefined)) : latest;
  return (
    <section
      aria-label="Data · Manifest"
      data-route="data-manifest"
      data-state={state.kind}
      className={styles.page}
    >
      {/* Board DataManifest1440: the title left, the Run picker and manifest.json download right. */}
      <div className={runStyles.cardHead}>
        <h2 className={styles.pageTitle}>Data</h2>
        <div className={runStyles.header}>
          {latest && (
            <RunSelect
              runs={latest.index.runs}
              value={entry?.runId ?? latest.entry.runId}
              onChange={(runId) => setParams(runId === null ? {} : { run: runId })}
              label="Run"
              hideLabel
            />
          )}
          {shown ? (
            // manifest.json: the CID-checked bytes on the host that served this read.
            <a
              className={styles.download}
              href={shown.read.partUrl({ name: "manifest.json", cid: shown.manifestCid })}
              download={`manifest-${shown.manifest.runId}.json`}
            >
              <Icon name="download" size="small" />
              manifest.json
            </a>
          ) : null}
        </div>
      </div>
      <DataTabs current="manifest" verifyCid={shown?.manifestCid ?? null} />
      {failed && <ErrorBanner message={runErrorNode(failed)} />}
      {entry && !other && <Skeleton variant="rows" />}
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
          <Skeleton variant="rows" />
        </>
      ) : null}
      {state.kind === "error" ? (
        <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
      ) : null}
      {shown ? <ManifestView run={shown} /> : null}
    </section>
  );
}

function ManifestView({ run }: { readonly run: LoadedRun }): ReactElement {
  const { manifest, manifestCid, read } = run;
  return (
    <>
      <RunChain head={manifestCid} headManifest={manifest} numbers={runNumbers(run.index)}>
        {/* Board RunChain: the summary strip under the run cards. */}
        <span>
          Run {manifest.runId} · manifest <CidDisplay cid={manifestCid} />
        </span>
        <FallbackChip source={read.source} />
      </RunChain>
      <ArtifactTable manifest={manifest} />
      <Provenance>
        Manifest <CidDisplay cid={manifestCid} /> · run {manifest.runId} · read from{" "}
        {read.source.host}
      </Provenance>
      <StoredOn />
    </>
  );
}

type ChainState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly chain: readonly RunChainLink[] }
  | { readonly kind: "error"; readonly error: RunLoadError };

function RunChain({
  head,
  headManifest,
  numbers,
  children,
}: {
  readonly children: ReactNode;
  readonly head: string;
  readonly headManifest: RunManifestV1;
  /** Run numbers by run ID (runNumbers: `null` is the pilot slice), the header and Runs numbering. */
  readonly numbers: ReadonlyMap<string, RunNumber>;
}): ReactElement {
  const [state, setState] = useState<ChainState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    const load = async (cid: string): Promise<RunManifestV1> =>
      cid === head ? headManifest : (await loadManifestByCid(cid, controller.signal)).manifest;
    loadRunChain(head, load).then(
      (chain) => {
        if (!controller.signal.aborted) setState({ kind: "ready", chain });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", error: toRunLoadError(error) });
      },
    );
    return () => controller.abort();
  }, [head, headManifest]);

  return (
    <section className={runStyles.card} aria-labelledby="chain-heading">
      <div className={styles.cardHead}>
        <h3 id="chain-heading" className={styles.cardTitle}>
          Run chain
        </h3>
        <span className={runStyles.itemBody}>
          Newest first · each manifest links to the one before it (previousManifestCid)
        </span>
      </div>
      {state.kind === "loading" ? <Skeleton variant="cards" count={1} /> : null}
      {state.kind === "error" ? <ErrorBanner message={runErrorNode(state.error)} /> : null}
      {state.kind === "ready" ? (
        <ul className={styles.chainCards} aria-label="Run chain">
          {state.chain.map((link, i) => (
            <li
              key={link.manifestCid}
              className={`${styles.chainCard} ${i === 0 ? styles.chainCurrent : ""}`}
              data-chain-entry=""
              data-cid={link.manifestCid}
            >
              <span className={styles.chainLabel} data-chain-label="">
                {numbers.has(link.runId)
                  ? runName(numbers.get(link.runId) ?? null)
                  : "Run not in the index"}
                {i === 0 ? <span className={styles.chainThis}> · this run</span> : null}
              </span>
              <code className={styles.chainRunId}>{link.runId}</code>
              <span className={styles.chainCid}>
                <CidDisplay cid={link.manifestCid} />
              </span>
              <span className={runStyles.itemBody}>
                finished {formatUtc(link.finishedAt)} UTC ·{" "}
                {link.previousManifestCid === null ? (
                  "previous: none"
                ) : (
                  <>
                    previous: <CidDisplay cid={link.previousManifestCid} />
                  </>
                )}
              </span>
              <span>
                <Link className={styles.actionLink} to={verifyPath(link.manifestCid)}>
                  <Icon name="verified" size="small" />
                  Verify
                </Link>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.strip}>{children}</div>
    </section>
  );
}

/** Sizes as the board shows them (B, KB, MB, GB) in decimal units (1 KB = 1,000 bytes, as the
 *  Cost section and the bill count); exact bytes in the title. */
export function humanBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function needsCar(artifact: ManifestArtifact): boolean {
  return artifact.kind === "directory" || artifact.size > VERIFY_MAX_BYTES;
}

/** B-3: a phone card shows name, size and check; this native disclosure opens the rest (CSS). */
const ROW_DETAILS = (
  <details>
    <summary>Details</summary>
  </details>
);

/** The last three path segments of an artifact name ("b01/address/part-00000.parquet"). */
const tail = (name: string): string => name.split("/").slice(-3).join("/");

/**
 * A-16 PO note 2026-10-26 (board DataManifest1440): the artifact table spans the card, each name
 * shows its last three path segments (batch, table, file); the leading folders stay in the row as
 * visually hidden text and in the cell's tooltip, so the row still reads as its full manifest
 * name. The table scrolls inside a bounded panel with a sticky header instead of running for
 * thousands of pixels (the board's pager would hide rows; every artifact stays a row because the
 * hosted checks find each one by its manifest name). Below 600 px each row is a card (Data390).
 */
function ArtifactTable({ manifest }: { readonly manifest: RunManifestV1 }): ReactElement {
  return (
    <section className={styles.tableCard} aria-labelledby="artifacts-heading">
      <h3 id="artifacts-heading" className={styles.cardTitle}>
        Artifacts ({manifest.artifacts.length.toLocaleString("en-US")})
      </h3>
      <div className={`${styles.scroll} ${styles.artifactScroll}`} data-artifact-scroll="">
        <table className={styles.table} aria-label="Artifacts">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">CID</th>
              <th scope="col">Codec</th>
              <th scope="col" className={styles.num}>
                Size
              </th>
              <th scope="col">SHA-256</th>
              <th scope="col">CAR</th>
              <th scope="col">Verify</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {manifest.artifacts.map((artifact) => (
              <tr key={artifact.name} data-artifact={artifact.name}>
                <td title={artifact.name}>
                  <span className={styles.name}>
                    <span>{artifact.name.slice(0, -tail(artifact.name).length)}</span>
                    {tail(artifact.name)}
                  </span>
                </td>
                <td>
                  <CidDisplay cid={artifact.cid} />
                </td>
                <td className={styles.mono} data-codec={artifact.codec}>
                  {artifact.codec}
                </td>
                <td
                  className={styles.num}
                  data-size={artifact.size}
                  title={`${artifact.size.toLocaleString("en-US")} bytes`}
                >
                  {humanBytes(artifact.size)}
                </td>
                <td className={styles.digest} data-sha256={artifact.sha256} title={artifact.sha256}>
                  {artifact.sha256.slice(0, 8)}…{artifact.sha256.slice(-4)}
                </td>
                <td>
                  {artifact.carCid === undefined ? (
                    NO_CAR_TEXT
                  ) : (
                    <span data-car-cid={artifact.carCid}>
                      <CidDisplay cid={artifact.carCid} />
                    </span>
                  )}
                </td>
                <td>
                  {!needsCar(artifact) ? (
                    <Link className={styles.actionLink} to={verifyPath(artifact.cid)}>
                      <Icon name="verified" size="small" />
                      Verify
                    </Link>
                  ) : artifact.carCid !== undefined ? (
                    <Link className={styles.actionLink} to={verifyPath(artifact.carCid)}>
                      <Icon name="inventory_2" size="small" />
                      {VERIFY_TEXTS.viaCar}
                    </Link>
                  ) : (
                    <span className={styles.mono}>{VERIFY_TEXTS.viaCar}</span>
                  )}
                </td>
                <td>{ROW_DETAILS}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Board DataManifest1440 footer strip; every row stays in the scrolled panel above. */}
      <p className={styles.tableFoot}>
        {manifest.artifacts.length.toLocaleString("en-US")} artifacts · directories and files over{" "}
        {VERIFY_MAX_BYTES / 1024 / 1024} MB verify through their CAR
      </p>
    </section>
  );
}
