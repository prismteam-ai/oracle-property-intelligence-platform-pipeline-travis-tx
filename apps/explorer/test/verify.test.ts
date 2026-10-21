import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { multihashSha256Hex } from '../src/lib/cid.js';
import { hashOnMainThread } from '../src/lib/hash.js';
import {
  gatewayUrl,
  overallState,
  verifyObject,
  verifyOnGateway,
  type ManifestObject,
} from '../src/lib/verify.js';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name));

// Real manifest rows (run 20261018T143520Z-t5-full): the smallest file part and the first directory root.
const part: ManifestObject = {
  cid: 'bafkreiedxun32sdq3lwdcnrqmt6rqfu7xmjfqdg7xb7xa72ktoocpplovy',
  name: 'property_improvement/s0013/tables/address/part-00000.parquet',
  size: 1040,
  codec: 'file',
  sha256: '83bd1bbd4870daec31363064fd18169fbb12580cdfb87f707f4a9b9c27bd6eae',
};
const root: ManifestObject = {
  cid: 'baguqeerajqevrlhfhnhl2llxyq7auibfmpmxosbrj5y2qedhxqudppfme6la',
  name: 'county/s0001/archive (CountyIndex root)',
  size: 134,
  codec: 'directory',
  sha256: '4c0958ace53b4ebd2d77c43e0a202563d97748314f71a81067bc2837bcac2796',
  digest_of: 'root block',
};

const bytesResponse = (body: Buffer, status = 200) =>
  new Response(new Uint8Array(body), { status });
const deps = (fetchImpl: unknown) => ({
  fetch: fetchImpl as typeof fetch,
  hash: hashOnMainThread,
});

describe('gateway URLs are derived from the CID', () => {
  it('uses /ipfs/<cid> for files and ?format=raw for directory roots', () => {
    expect(gatewayUrl('https://ipfs.filebase.io', part)).toBe(
      `https://ipfs.filebase.io/ipfs/${part.cid}`,
    );
    expect(gatewayUrl('https://gateway.pinata.cloud/', root)).toBe(
      `https://gateway.pinata.cloud/ipfs/${root.cid}?format=raw`,
    );
  });
});

describe('CID multihash', () => {
  it('equals the sha256 of the real directory root block and of the real raw-leaf part', () => {
    expect(multihashSha256Hex(root.cid)).toBe(root.sha256);
    expect(multihashSha256Hex(part.cid)).toBe(part.sha256);
  });
});

describe('verifyOnGateway', () => {
  it('matches the real 1,040-byte Parquet part (size, sha256, multihash)', async () => {
    const fetchMock = vi.fn(async () => bytesResponse(fixture('part-bafkreiedxun32.parquet')));
    const result = await verifyOnGateway(part, 'https://ipfs.filebase.io', deps(fetchMock));
    expect(result.state).toBe('match');
    expect(result.size).toBe(1040);
    expect(result.sha256).toBe(part.sha256);
    expect(result.multihashMatches).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://ipfs.filebase.io/ipfs/${part.cid}`);
    expect(init.redirect).toBe('follow');
  });

  it('matches a directory root through its raw root block and the CID multihash', async () => {
    const fetchMock = vi.fn(async () => bytesResponse(fixture('root-baguqeerajqevr.block')));
    const result = await verifyOnGateway(root, 'https://gateway.pinata.cloud', deps(fetchMock));
    expect(result.state).toBe('match');
    expect(result.multihashMatches).toBe(true);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('?format=raw');
  });

  it('reports a mismatch when fetched bytes differ from the manifest', async () => {
    const tampered = Buffer.from(fixture('part-bafkreiedxun32.parquet'));
    tampered[10] = (tampered[10] ?? 0) ^ 0xff;
    const result = await verifyOnGateway(
      part,
      'https://ipfs.filebase.io',
      deps(async () => bytesResponse(tampered)),
    );
    expect(result.state).toBe('mismatch');
    expect(result.reasons.join(' ')).toContain('sha256 differs from the manifest');
  });

  it('reports a size mismatch for a truncated body', async () => {
    const result = await verifyOnGateway(
      part,
      'https://ipfs.filebase.io',
      deps(async () => bytesResponse(fixture('part-bafkreiedxun32.parquet').subarray(0, 500))),
    );
    expect(result.state).toBe('mismatch');
    expect(result.reasons[0]).toContain('size 500 differs from manifest 1040');
  });

  it('treats a timeout as unverified, never as a mismatch', async () => {
    const hangs = (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const result = await verifyOnGateway(part, 'https://ipfs.filebase.io', {
      ...deps(hangs),
      timeoutMs: 20,
    });
    expect(result.state).toBe('unverified');
    expect(result.reasons[0]).toContain('timed out');
  });

  it('treats a network or CORS failure as unverified', async () => {
    const result = await verifyOnGateway(
      part,
      'https://gateway.pinata.cloud',
      deps(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(result.state).toBe('unverified');
    expect(result.reasons[0]).toContain('no CORS');
  });

  it.each([404, 429, 504])('treats gateway status %i as unverified', async (status) => {
    const result = await verifyOnGateway(
      part,
      'https://gateway.pinata.cloud',
      deps(async () => new Response('x', { status })),
    );
    expect(result.state).toBe('unverified');
    expect(result.http).toBe(status);
  });
});

describe('verifyObject', () => {
  it('queries both gateways and a single mismatch outweighs an unverified one', async () => {
    const good = fixture('part-bafkreiedxun32.parquet');
    const bad = Buffer.alloc(1040, 1);
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith('https://ipfs.filebase.io') ? bytesResponse(good) : bytesResponse(bad),
    );
    const results = await verifyObject(part, deps(fetchMock));
    expect(results.map((r) => r.state)).toEqual(['match', 'mismatch']);
    expect(overallState(results)).toBe('mismatch');
    expect(overallState([{ state: 'match' }, { state: 'unverified' }] as never)).toBe('unverified');
    expect(overallState([{ state: 'match' }, { state: 'match' }] as never)).toBe('match');
  });
});
