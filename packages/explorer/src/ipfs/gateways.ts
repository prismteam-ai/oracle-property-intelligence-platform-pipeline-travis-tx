export interface Gateway {
  name: string;
  url: string;
}

export const INDEPENDENT_GATEWAYS: readonly Gateway[] = [
  { name: "ipfs.orbitor.dev", url: "https://ipfs.orbitor.dev" },
  { name: "gw.ipfs-lens.dev", url: "https://gw.ipfs-lens.dev" },
];

export const IPNS_GATEWAY: Gateway = { name: "ipfs.orbitor.dev", url: "https://ipfs.orbitor.dev" };

export function gatewayUrl(cid: string, gateway: Gateway = IPNS_GATEWAY): string {
  return `${gateway.url}/ipfs/${cid}`;
}
