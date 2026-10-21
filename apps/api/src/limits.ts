/** Per-instance token bucket for the MCP per-tool limits (`LIMITS_JSON.mcp`): `rate` tokens a second, capacity `burst`. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = burst;
    this.last = now();
  }
  /** Returns 0 when a token was taken, else the seconds to wait for the next one. */
  take(): number {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil((1 - this.tokens) / this.rate));
  }
}

export class ToolLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  constructor(limits: Record<string, { rate: number; burst: number }>, now?: () => number) {
    for (const [tool, l] of Object.entries(limits))
      this.buckets.set(tool, new TokenBucket(l.rate, l.burst, now));
  }
  /** 0 = allowed. */
  check(tool: string): number {
    return this.buckets.get(tool)?.take() ?? 0;
  }
}
