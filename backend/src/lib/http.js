// HTTP helper used for every outbound request.
// - Timeout per attempt (AbortController)
// - Retries with exponential backoff and jitter on network errors, 408, 425, 429 and 5xx
// - Honours Retry-After (capped)
// - Conditional requests (ETag / Last-Modified) so unchanged feeds cost almost nothing
// - Response size cap, so a misbehaving server cannot exhaust memory
// - Refuses to call private/loopback addresses

import { log } from './logger.js';

export class HttpError extends Error {
  constructor(message, { status, url, permanent } = {}) {
    super(message);
    this.status = status;
    this.url = url;
    this.permanent = Boolean(permanent);
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isSafePublicUrl(raw) {
  // Test suites set this to talk to a local mock server. Never set it in production.
  if (process.env.FUNDSAE_ALLOW_PRIVATE_URLS === '1') return /^https?:\/\//.test(String(raw));
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (!['http:', 'https:'].includes(u.protocol)) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host === '0.0.0.0') return false;
  if (host.includes(':')) {
    // IPv6 literal: block loopback, unspecified, unique-local, link-local and mapped addresses.
    if (host === '::1' || host === '::' || /^(fc|fd|fe8|fe9|fea|feb)/.test(host) || host.startsWith('::ffff:')) return false;
  }
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

async function readCapped(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(`Response larger than ${maxBytes} bytes`, { permanent: true });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

function retryDelay(attempt, baseMs, retryAfterHeader) {
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(retryAfterHeader) - Date.now();
    if (ms > 0) return Math.min(ms, 60_000);
  }
  const exp = baseMs * 2 ** (attempt - 1);
  return exp + Math.floor(Math.random() * baseMs);
}

/**
 * Fetch text with retries.
 * @returns {Promise<{status:number, notModified:boolean, body:string, etag?:string, lastModified?:string, finalUrl:string}>}
 */
export async function fetchText(url, opts = {}) {
  const {
    userAgent = 'FundsAeNewsBot/1.0',
    timeoutMs = 15000,
    retries = 3,
    retryBaseDelayMs = 1500,
    maxResponseBytes = 5_000_000,
    etag,
    lastModified,
    headers: extraHeaders = {},
    accept = 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.5'
  } = opts;

  if (!isSafePublicUrl(url)) throw new HttpError(`Refusing to fetch non-public URL`, { url, permanent: true });

  // extraHeaders may carry a credential (the Sanity read token): it is sent, never logged.
  const headers = { ...extraHeaders, 'User-Agent': userAgent, Accept: accept, 'Accept-Encoding': 'gzip, deflate, br' };
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;

  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
      if (res.status === 304) {
        return { status: 304, notModified: true, body: '', etag, lastModified, finalUrl: res.url || url };
      }
      if (!res.ok) {
        const permanent = !RETRYABLE_STATUS.has(res.status);
        const err = new HttpError(`HTTP ${res.status}`, { status: res.status, url, permanent });
        if (permanent || attempt > retries) throw err;
        lastErr = err;
        const wait = retryDelay(attempt, retryBaseDelayMs, res.headers.get('retry-after'));
        log.debug('http.retry', { url, status: res.status, attempt, waitMs: wait });
        await sleep(wait);
        continue;
      }
      const body = await readCapped(res, maxResponseBytes);
      return {
        status: res.status,
        notModified: false,
        body,
        etag: res.headers.get('etag') || undefined,
        lastModified: res.headers.get('last-modified') || undefined,
        finalUrl: res.url || url
      };
    } catch (err) {
      if (err instanceof HttpError && err.permanent) throw err;
      lastErr = err.name === 'AbortError' ? new HttpError(`Timed out after ${timeoutMs}ms`, { url }) : err;
      if (attempt > retries) break;
      const wait = retryDelay(attempt, retryBaseDelayMs);
      log.debug('http.retry', { url, error: lastErr.message, attempt, waitMs: wait });
      await sleep(wait);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof HttpError ? lastErr : new HttpError(lastErr?.message || 'Request failed', { url });
}

/**
 * Checks whether an article link still resolves.
 * Returns "ok", "broken" (404/410 or DNS failure) or "unknown" (blocked, timeout, other).
 * "unknown" is treated as fine: many publishers block bots, and we must not
 * drop genuine stories because of that.
 */
export async function checkLink(url, { userAgent, timeoutMs = 8000 } = {}) {
  if (!isSafePublicUrl(url)) return 'broken';
  const attempt = async (method) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': userAgent, ...(method === 'GET' ? { Range: 'bytes=0-1023' } : {}) }
      });
      res.body?.cancel?.().catch(() => {});
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let status = await attempt('HEAD');
    if (status === 405 || status === 403 || status === 501) status = await attempt('GET');
    if (status === 404 || status === 410) return 'broken';
    return status < 400 ? 'ok' : 'unknown';
  } catch (err) {
    if (/ENOTFOUND|EAI_AGAIN/.test(String(err?.cause?.code || err?.message))) return 'broken';
    return 'unknown';
  }
}

/** Run async tasks with a concurrency limit. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
