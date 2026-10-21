import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../src/limits.js';

describe('token bucket', () => {
  it('allows the burst, then the rate', () => {
    let t = 0;
    const b = new TokenBucket(1, 2, () => t);
    expect([b.take(), b.take()]).toEqual([0, 0]);
    expect(b.take()).toBeGreaterThanOrEqual(1);
    t += 1000;
    expect(b.take()).toBe(0);
  });
});
