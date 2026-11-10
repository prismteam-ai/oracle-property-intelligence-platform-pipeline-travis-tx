import { useState } from "react";
import { Badge, Card, Cid, Disclosure, type Tone } from "../components/ui.js";
import type { Dataset } from "../data/dataset.js";
import { useAsync } from "../data/hooks.js";
import type { ManifestObject, Publication } from "../data/types.js";
import { formatBytes, formatDateTime } from "../format.js";
import {
  type CheckedObject,
  CheckStatus,
  checkObject,
  type GatewayCheck,
  resolveIpns,
} from "../ipfs/gateway-check.js";
import { gatewayUrl, INDEPENDENT_GATEWAYS, IPNS_GATEWAY } from "../ipfs/gateways.js";
import { REPOSITORY_BRANCH, REPOSITORY_URL } from "../repository.js";

const LARGE_OBJECT_BYTES = 20 * 1024 * 1024;
const STATUS_TONE: Record<CheckStatus, Tone> = {
  [CheckStatus.Verified]: "good",
  [CheckStatus.Mismatch]: "bad",
  [CheckStatus.Unreachable]: "warn",
};

type Checks = Record<string, GatewayCheck[] | "running">;

interface CiCheck {
  name: string;
  gateway: string;
  status: string;
  httpStatus?: number;
  checkedAt: string;
}

interface CiRecord {
  verification: CiCheck[];
}

const CI_VERIFIED = "verified";

async function loadCiRecord(buildId: string): Promise<CiRecord | undefined> {
  const response = await fetch(`/api/publications/${buildId}`);
  return response.ok ? ((await response.json()) as CiRecord) : undefined;
}

export function PublicationPage({ dataset }: { dataset: Dataset }) {
  const { manifest, publication, publications } = dataset;
  const [checks, setChecks] = useState<Checks>({});
  const manifestObject: CheckedObject = {
    name: "manifest.json",
    cid: publication.manifestCid,
    kind: "file",
    size: 0,
  };
  const objects: CheckedObject[] = [manifest.root, ...manifest.objects];
  const record = useAsync(() => loadCiRecord(publication.buildId), publication.buildId);
  const ciChecks = record.state === "ready" ? record.value?.verification : undefined;
  const ciChecksOf = (name: string) => ciChecks?.filter((check) => check.name === name);
  const evidenceUrl = `${REPOSITORY_URL}/blob/${REPOSITORY_BRANCH}/publications/${publication.buildId}/publication.json`;

  const verify = async (object: CheckedObject) => {
    setChecks((current) => ({ ...current, [object.cid]: "running" }));
    const results = await Promise.all(
      INDEPENDENT_GATEWAYS.map((gateway) => checkObject(object, gateway.url)),
    );
    setChecks((current) => ({ ...current, [object.cid]: results }));
  };
  const verifySmall = async () => {
    for (const object of [manifestObject, ...objects]) {
      if (object.kind === "directory" || object.size < LARGE_OBJECT_BYTES) await verify(object);
    }
  };

  return (
    <div className="page">
      <Card
        title="Artifact manifest"
        subtitle={`Build ${manifest.build_id}, created ${formatDateTime(manifest.created_at)}. Every object is addressed by its CID; gateway links are derived from CIDs.`}
        actions={
          <button type="button" className="button" onClick={verifySmall}>
            Verify every file under 20 MB on two public gateways
          </button>
        }
      >
        <dl className="facts">
          <dt>Manifest CID</dt>
          <dd>
            <Cid cid={publication.manifestCid} />
            <CheckResult check={checks[publication.manifestCid]} />
            <button type="button" className="link-button" onClick={() => verify(manifestObject)}>
              verify
            </button>
          </dd>
          <dt>Verified by CI</dt>
          <dd>
            {ciChecks ? (
              <>
                {ciChecks.filter((check) => check.status === CI_VERIFIED).length} of{" "}
                {ciChecks.length} gateway checks passed when CI published this build ·{" "}
                <a href={evidenceUrl} target="_blank" rel="noreferrer">
                  record committed to git
                </a>
              </>
            ) : (
              <span className="muted">no CI record for this build</span>
            )}
          </dd>
          <dt>Dataset root (directory)</dt>
          <dd>
            <Cid cid={manifest.root.cid} /> · {formatBytes(manifest.root.size)} of files
          </dd>
          <dt>CAR of the root DAG</dt>
          <dd>
            {manifest.car.url ? (
              <a href={manifest.car.url} target="_blank" rel="noreferrer">
                {manifest.car.name}
              </a>
            ) : (
              manifest.car.name
            )}{" "}
            · {formatBytes(manifest.car.size)} · sha256{" "}
            <code className="digest">{manifest.car.sha256}</code>
          </dd>
          <dt>Pinned by</dt>
          <dd>
            {manifest.pins.map((pin) => (
              <Badge key={pin.provider} tone={pin.cid === manifest.root.cid ? "good" : "bad"}>
                {pin.provider} · same root CID
              </Badge>
            ))}
          </dd>
          <dt>DAG settings</dt>
          <dd className="muted">
            {Object.entries(manifest.dag)
              .map(([key, value]) => `${key}: ${value}`)
              .join(" · ")}
          </dd>
          <dt>Previous publication</dt>
          <dd>
            {manifest.previous ? (
              <>
                manifest <Cid cid={manifest.previous.manifest_cid} />, root{" "}
                <Cid cid={manifest.previous.root_cid} />
              </>
            ) : (
              "none (first publication)"
            )}
          </dd>
        </dl>
        <IpnsCheck publication={publication} />
      </Card>

      <Card
        title="Objects"
        subtitle="Each check downloads the object straight from a public gateway this environment does not operate and compares size and SHA-256 with the manifest (directories: the root block's hash against the CID)."
      >
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Codec</th>
                <th>Size</th>
                <th>CID</th>
                <th>SHA-256</th>
                <th>Checked by CI at publish</th>
                <th>Check now</th>
              </tr>
            </thead>
            <tbody>
              {objects.map((object) => (
                <ObjectRow
                  key={object.cid}
                  object={object as ManifestObject}
                  ciChecks={ciChecksOf(object.name)}
                  check={checks[object.cid]}
                  onVerify={() => verify(object)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <PublicationHistory publications={publications} current={publication} />

      <Card title="Raw manifest">
        <Disclosure summary="manifest.json">
          <pre className="code-block">{JSON.stringify(manifest, null, 2)}</pre>
        </Disclosure>
      </Card>
    </div>
  );
}

function ObjectRow({
  object,
  ciChecks,
  check,
  onVerify,
}: {
  object: ManifestObject;
  ciChecks: CiCheck[] | undefined;
  check: GatewayCheck[] | "running" | undefined;
  onVerify: () => void;
}) {
  const large = object.kind === "file" && object.size >= LARGE_OBJECT_BYTES;
  return (
    <tr>
      <td>
        <code>{object.name}</code>
      </td>
      <td>
        {object.kind} · {object.codec}
      </td>
      <td className="nowrap">{formatBytes(object.size)}</td>
      <td>
        <Cid cid={object.cid} />
      </td>
      <td>
        {object.sha256 ? (
          <code className="digest">{object.sha256.slice(0, 16)}…</code>
        ) : (
          "root block hash = CID"
        )}
      </td>
      <td>
        <span className="checks">
          {(ciChecks ?? []).map((ci) => (
            <Badge key={ci.gateway} tone={ci.status === CI_VERIFIED ? "good" : "warn"}>
              {new URL(ci.gateway).host}: {ci.status}
            </Badge>
          ))}
        </span>
      </td>
      <td>
        <CheckResult check={check} />
        {check !== "running" && (
          <button type="button" className="link-button" onClick={onVerify}>
            {large ? `verify (${formatBytes(object.size)} download)` : "verify"}
          </button>
        )}
      </td>
    </tr>
  );
}

function CheckResult({ check }: { check: GatewayCheck[] | "running" | undefined }) {
  if (check === undefined) return null;
  if (check === "running") return <span className="muted">checking…</span>;
  return (
    <span className="checks">
      {check.map((result) => (
        <a
          key={result.gateway}
          href={result.url}
          target="_blank"
          rel="noreferrer"
          title={result.sha256 ? `sha256 ${result.sha256}` : undefined}
        >
          <Badge tone={STATUS_TONE[result.status]}>
            {new URL(result.gateway).host}: {result.status}
            {result.bytes !== undefined && ` · ${formatBytes(result.bytes)}`} · {result.elapsedMs}{" "}
            ms
          </Badge>
        </a>
      ))}
    </span>
  );
}

function IpnsCheck({ publication }: { publication: Publication }) {
  const [resolved, setResolved] = useState<string | "running" | "failed">();
  const resolve = async () => {
    setResolved("running");
    setResolved(
      (await resolveIpns(publication.ipns.name, IPNS_GATEWAY.url).catch(() => undefined)) ??
        "failed",
    );
  };
  const live =
    resolved !== undefined && resolved !== "running" && resolved !== "failed"
      ? resolved
      : undefined;
  return (
    <div className="ipns">
      <h3>IPNS pointer</h3>
      <p>
        Name <code className="digest">{publication.ipns.name}</code> was pointed at{" "}
        <Cid cid={publication.ipns.resolvedCid} /> by this publication. IPNS is only a pointer; the
        CID is the snapshot.
      </p>
      <p>
        <button type="button" className="button secondary" onClick={resolve}>
          Resolve now through {IPNS_GATEWAY.name}
        </button>{" "}
        {resolved === "running" && <span className="muted">resolving…</span>}
        {resolved === "failed" && <Badge tone="warn">the gateway did not resolve the name</Badge>}
        {live && (
          <>
            resolves to <Cid cid={live} />{" "}
            <Badge tone={live === publication.manifestCid ? "good" : "warn"}>
              {live === publication.manifestCid
                ? "the latest manifest"
                : "not the latest manifest yet (IPNS propagation)"}
            </Badge>
          </>
        )}
      </p>
    </div>
  );
}

function PublicationHistory({
  publications,
  current,
}: {
  publications: Publication[];
  current: Publication;
}) {
  const [checks, setChecks] = useState<Record<string, GatewayCheck[] | "running">>({});
  const verify = async (publication: Publication) => {
    setChecks((existing) => ({ ...existing, [publication.buildId]: "running" }));
    const results = await Promise.all(
      INDEPENDENT_GATEWAYS.map((gateway) =>
        checkObject(
          { name: "/", cid: publication.rootCid, kind: "directory", size: 0 },
          gateway.url,
        ),
      ),
    );
    setChecks((existing) => ({ ...existing, [publication.buildId]: results }));
  };
  return (
    <Card
      title="Publication history"
      subtitle="Each incremental publication gets new CIDs; earlier CIDs are never mutated and keep resolving."
    >
      <table className="data-table">
        <thead>
          <tr>
            <th>Build</th>
            <th>Published</th>
            <th>Manifest CID</th>
            <th>Root CID</th>
            <th>Still resolves</th>
          </tr>
        </thead>
        <tbody>
          {[...publications].reverse().map((publication) => (
            <tr key={publication.buildId}>
              <td>
                <code>{publication.buildId}</code>{" "}
                {publication.buildId === current.buildId && <Badge tone="good">latest</Badge>}
              </td>
              <td className="nowrap">{formatDateTime(publication.publishedAt)}</td>
              <td>
                <Cid cid={publication.manifestCid} />
              </td>
              <td>
                <Cid cid={publication.rootCid} />{" "}
                <a
                  href={gatewayUrl(publication.rootCid)}
                  target="_blank"
                  rel="noreferrer"
                  className="muted"
                >
                  browse
                </a>
              </td>
              <td>
                <CheckResult check={checks[publication.buildId]} />
                {checks[publication.buildId] !== "running" && (
                  <button type="button" className="link-button" onClick={() => verify(publication)}>
                    check root
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
