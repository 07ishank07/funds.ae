#!/usr/bin/env node
// Checks that news feeds answer with a real, current RSS/Atom/RDF feed
// (build guide Part C6 and Appendix 3).
//
//   npm run check-sources -- https://www.pehub.com/feed/   check one or more URLs
//   npm run check-sources -- --config                      check every enabled RSS source in
//                                                          config/sources.news.json ("sources")
//
// It uses the pipeline's own HTTP client and feed parser, so a pass here means the daily
// run can read the feed. A source fails when it can't be fetched, isn't a feed, has no
// items, or its newest item is older than 14 days.
// Exit codes: 0 all passed, 1 at least one failed, 2 usage error.
//
// Blocked (HTTP 403) sources must never be worked around: ask the publisher for access.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_DIR, loadSettings, readJson } from '../src/config.js';
import { fetchText, HttpError, mapLimit } from '../src/lib/http.js';
import { parseFeed, FeedParseError } from '../src/lib/feedParser.js';

export const STALE_DAYS = 14;
const DAY = 86_400_000;

// Same user-agent as the pipeline, including the contact email when one is set.
function userAgent() {
  try {
    return `${loadSettings().userAgent} source-check`;
  } catch {
    return 'FundsAeNewsBot/1.0 (+https://funds.ae/about) source-check';
  }
}

/**
 * Fetches and parses one feed.
 * @returns {Promise<{url:string, ok:boolean, status:number, format:string, items:number, newest:string, note:string}>}
 */
export async function checkFeed(url, { now = new Date(), timeoutMs = 20000, ua = userAgent() } = {}) {
  const result = { url, ok: false, status: 0, format: 'error', items: 0, newest: 'unknown', note: '' };
  try {
    const res = await fetchText(url, { userAgent: ua, timeoutMs, retries: 1, retryBaseDelayMs: 1000 });
    result.status = res.status;
    const feed = parseFeed(res.body);
    result.format = feed.format;
    result.items = feed.items.length;
    // Ignore dates more than a day in the future (bad data or scheduled posts).
    const dates = feed.items
      .map((item) => item.publishedAt)
      .filter((d) => d instanceof Date && d.getTime() <= now.getTime() + DAY);
    const newest = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
    if (newest) result.newest = newest.toISOString().slice(0, 10);
    const ageDays = newest ? (now.getTime() - newest.getTime()) / DAY : null;
    if (!feed.items.length) {
      result.note = 'feed has no items';
    } else if (ageDays !== null && ageDays > STALE_DAYS) {
      result.note = `stale: newest item is ${Math.floor(ageDays)} days old`;
    } else {
      result.ok = true;
      if (!newest) result.note = 'items have no readable dates';
    }
  } catch (err) {
    if (err instanceof FeedParseError) {
      result.status = result.status || 200;
      result.format = 'not-a-feed';
      result.note = err.message;
    } else if (err instanceof HttpError) {
      result.status = err.status || 0;
      result.note = err.status === 403
        ? 'blocked (HTTP 403): ask the publisher for access; do not bypass'
        : err.message;
    } else {
      result.note = err?.message || String(err);
    }
  }
  return result;
}

/** Enabled RSS sources from config/sources.news.json (the live list). */
export function configuredSources() {
  const cfg = readJson(path.join(CONFIG_DIR, 'sources.news.json'));
  const all = cfg.sources || [];
  return {
    checked: all.filter((s) => s.enabled !== false && s.type === 'rss'),
    skipped: all.length - all.filter((s) => s.enabled !== false && s.type === 'rss').length
  };
}

export function formatLine(label, r) {
  return [
    r.ok ? 'OK  ' : 'FAIL',
    String(r.status).padEnd(3),
    r.format.padEnd(10),
    `items=${String(r.items).padEnd(4)}`,
    `newest=${r.newest.padEnd(10)}`,
    label,
    r.note ? `(${r.note})` : ''
  ].join(' ').trimEnd();
}

export async function main(args, { log = console.log } = {}) {
  const useConfig = args.includes('--config');
  let targets;
  let skipped = 0;
  if (useConfig) {
    const cfg = configuredSources();
    targets = cfg.checked.map((s) => ({ label: `${s.id}  ${s.url}`, url: s.url }));
    skipped = cfg.skipped;
  } else {
    targets = args.filter((a) => /^https?:\/\//i.test(a)).map((url) => ({ label: url, url }));
  }
  if (!targets.length) {
    log('Usage: npm run check-sources -- <feed-url> [more urls]   or   npm run check-sources -- --config');
    return 2;
  }
  const results = await mapLimit(targets, 8, (t) => checkFeed(t.url));
  results.forEach((r, i) => log(formatLine(targets[i].label, r)));
  const failed = results.filter((r) => !r.ok).length;
  log(`\n${results.length - failed}/${results.length} passed${skipped ? `; ${skipped} disabled or non-RSS sources not checked` : ''}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
