// Token-bucket rate limiting per client IP, held in memory.
//
// The key map is bounded (least-recently-used entries are evicted), so a flood
// of distinct or spoofed addresses cannot exhaust memory. Limits are per
// process: run one instance, or put a shared limiter (e.g. at your proxy) in
// front when you scale out.

export class RateLimiter {
  /**
   * @param {{ capacity: number, windowMs: number, maxKeys?: number }} options
   *   capacity requests are allowed per windowMs, refilled continuously.
   */
  constructor({ capacity, windowMs, maxKeys = 10_000 }) {
    this.capacity = capacity;
    this.ratePerMs = capacity / windowMs;
    this.maxKeys = maxKeys;
    this.buckets = new Map();
  }

  #bucket(key, now) {
    const b = this.buckets.get(key) || { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + (now - b.at) * this.ratePerMs);
    b.at = now;
    // Re-insert so Map order tracks recency; evict the oldest over the bound.
    this.buckets.delete(key);
    this.buckets.set(key, b);
    if (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value);
    return b;
  }

  /** @returns {{ ok: boolean, retryAfterSec: number }} */
  take(key, now = Date.now()) {
    const b = this.#bucket(key, now);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, retryAfterSec: 0 };
    }
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / this.ratePerMs / 1000)) };
  }
}

/** Several limits that must all pass, e.g. 5 per minute and 30 per hour. */
export class CompositeLimiter {
  constructor(limiters) {
    this.limiters = limiters;
  }

  take(key, now = Date.now()) {
    for (const limiter of this.limiters) {
      const result = limiter.take(key, now);
      if (!result.ok) return result;
    }
    return { ok: true, retryAfterSec: 0 };
  }
}
