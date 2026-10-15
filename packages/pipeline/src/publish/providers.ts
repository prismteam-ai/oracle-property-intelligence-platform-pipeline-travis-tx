import { openAsBlob } from "node:fs";
import path from "node:path";
import { log } from "../core/log.js";

export type ProviderUploadResult = {
  provider: string;
  type: string;
  status: "pinned" | "queued" | "failed";
  detail?: string;
  origins?: string[];
};

export interface IpfsProvider {
  readonly name: string;
  readonly type: string;
  importCar(carPath: string, rootCid: string, label: string): Promise<ProviderUploadResult>;
}

export interface IpnsPublisher {
  readonly name: string;
  publish(cid: string): Promise<{ ipnsName: string; resolvedCid: string }>;
}

function authHeaders(auth?: string): Record<string, string> {
  if (!auth) return {};
  return { authorization: auth.includes(" ") ? auth : `Bearer ${auth}` };
}

export class KuboRpcProvider implements IpfsProvider {
  readonly type = "kubo-rpc";
  constructor(
    readonly name: string,
    private readonly url: string,
    private readonly auth?: string,
  ) {}

  async importCar(carPath: string, rootCid: string): Promise<ProviderUploadResult> {
    const form = new FormData();
    form.append("file", await openAsBlob(carPath), path.basename(carPath));
    const endpoint = `${this.url.replace(/\/$/, "")}/api/v0/dag/import?pin-roots=true&stats=true`;
    const res = await fetch(endpoint, {
      method: "POST",
      body: form,
      headers: authHeaders(this.auth),
    });
    const text = await res.text();
    if (!res.ok)
      return {
        provider: this.name,
        type: this.type,
        status: "failed",
        detail: `HTTP ${res.status}: ${text.slice(0, 300)}`,
      };
    const pinned = text.split("\n").some((line) => {
      if (!line.trim()) return false;
      try {
        const msg = JSON.parse(line) as { Root?: { Cid?: { "/": string }; PinErrorMsg?: string } };
        return msg.Root?.Cid?.["/"] === rootCid && !msg.Root.PinErrorMsg;
      } catch {
        return false;
      }
    });
    let origins: string[] | undefined;
    try {
      const idRes = await fetch(`${this.url.replace(/\/$/, "")}/api/v0/id`, {
        method: "POST",
        headers: authHeaders(this.auth),
      });
      if (idRes.ok) {
        const id = (await idRes.json()) as { Addresses?: string[] };
        origins = (id.Addresses ?? []).filter(
          (a) => !/\/ip4\/(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\/ip6\/::1/.test(a),
        );
      }
    } catch {
      origins = undefined;
    }
    return {
      provider: this.name,
      type: this.type,
      status: pinned ? "pinned" : "failed",
      detail: pinned ? undefined : `root ${rootCid} not reported as pinned: ${text.slice(0, 300)}`,
      origins,
    };
  }

  async catBytes(cid: string): Promise<Uint8Array> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/api/v0/cat?arg=${cid}`, {
      method: "POST",
      headers: authHeaders(this.auth),
    });
    if (!res.ok) throw new Error(`cat ${cid}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

export class PinningServiceProvider implements IpfsProvider {
  readonly type = "pinning-service";
  constructor(
    readonly name: string,
    private readonly url: string,
    private readonly token: string,
    private readonly origins: string[] = [],
  ) {}

  async importCar(_carPath: string, rootCid: string, label: string): Promise<ProviderUploadResult> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/pins`, {
      method: "POST",
      headers: { ...authHeaders(this.token), "content-type": "application/json" },
      body: JSON.stringify({ cid: rootCid, name: label, origins: this.origins }),
    });
    const text = await res.text();
    if (!res.ok)
      return {
        provider: this.name,
        type: this.type,
        status: "failed",
        detail: `HTTP ${res.status}: ${text.slice(0, 300)}`,
      };
    const body = JSON.parse(text) as { status?: string; requestid?: string };
    return {
      provider: this.name,
      type: this.type,
      status: body.status === "pinned" ? "pinned" : "queued",
      detail: `request ${body.requestid ?? "?"} status ${body.status ?? "?"}`,
    };
  }
}

export class FilebaseNamesPublisher implements IpnsPublisher {
  readonly name = "filebase-names";
  constructor(
    private readonly label: string,
    private readonly accessKey: string,
    private readonly secretKey: string,
  ) {}

  async publish(cid: string): Promise<{ ipnsName: string; resolvedCid: string }> {
    const auth = `Bearer ${Buffer.from(`${this.accessKey}:${this.secretKey}`).toString("base64")}`;
    const base = "https://api.filebase.io/v1/names";
    let res = await fetch(`${base}/${this.label}`, {
      method: "PUT",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ cid }),
    });
    if (res.status === 404) {
      res = await fetch(base, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ label: this.label, cid }),
      });
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`IPNS update failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    const body = JSON.parse(text) as { network_key?: string; cid?: string };
    if (!body.network_key)
      throw new Error(`IPNS response missing network_key: ${text.slice(0, 300)}`);
    return { ipnsName: body.network_key, resolvedCid: body.cid ?? cid };
  }
}

export function providersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  only?: string[],
): IpfsProvider[] {
  const names = (only ?? (env.ORACLE_IPFS_PROVIDERS || "").split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  return names.map((name) => {
    const key = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    const type = env[`ORACLE_IPFS_${key}_TYPE`];
    const url = env[`ORACLE_IPFS_${key}_URL`];
    if (!type || !url)
      throw new Error(`provider ${name}: set ORACLE_IPFS_${key}_TYPE and ORACLE_IPFS_${key}_URL`);
    if (type === "kubo-rpc") return new KuboRpcProvider(name, url, env[`ORACLE_IPFS_${key}_AUTH`]);
    if (type === "pinning-service") {
      const token = env[`ORACLE_IPFS_${key}_TOKEN`];
      if (!token) throw new Error(`provider ${name}: ORACLE_IPFS_${key}_TOKEN is required`);
      const origins = (env[`ORACLE_IPFS_${key}_ORIGINS`] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return new PinningServiceProvider(name, url, token, origins);
    }
    throw new Error(`provider ${name}: unsupported type ${type}`);
  });
}

export function ipnsFromEnv(env: NodeJS.ProcessEnv = process.env): IpnsPublisher | undefined {
  if (env.ORACLE_IPNS_PROVIDER !== "filebase-names") return undefined;
  const label = env.ORACLE_IPNS_LABEL;
  const ak = env.ORACLE_FILEBASE_ACCESS_KEY;
  const sk = env.ORACLE_FILEBASE_SECRET_KEY;
  if (!label || !ak || !sk) {
    log.warn("ipns_disabled", {
      reason: "ORACLE_IPNS_LABEL / ORACLE_FILEBASE_ACCESS_KEY / ORACLE_FILEBASE_SECRET_KEY missing",
    });
    return undefined;
  }
  return new FilebaseNamesPublisher(label, ak, sk);
}
