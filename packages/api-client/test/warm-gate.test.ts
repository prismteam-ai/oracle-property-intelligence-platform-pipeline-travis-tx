import { describe, expect, it } from 'vitest';
import { firstCallAlone } from '../src/warm-gate.js';

describe('firstCallAlone (decisions.md section 31)', () => {
  it('holds every request behind the first until it answers, then lets them through', async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = (async (input: string) => {
      started.push(input);
      if (input === '/v1/meta') await gate;
      return new Response(input);
    }) as unknown as typeof fetch;
    const g = firstCallAlone(f);
    const meta = g('/v1/meta');
    const runs = g('/v1/runs');
    const centers = g('/v1/search-centers');
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toEqual(['/v1/meta']);
    release();
    await Promise.all([meta, runs, centers]);
    expect(started.sort()).toEqual(['/v1/meta', '/v1/runs', '/v1/search-centers']);
  });

  it('a failed first request releases the others', async () => {
    let n = 0;
    const f = (async () => {
      if (n++ === 0) throw new TypeError('network');
      return new Response('ok');
    }) as unknown as typeof fetch;
    const g = firstCallAlone(f);
    await expect(g('/a')).rejects.toThrow('network');
    expect(await (await g('/b')).text()).toBe('ok');
  });
});
