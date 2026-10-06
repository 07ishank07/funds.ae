// URL canonicalisation: the same article reached through different links
// (tracking parameters, http vs https, www, trailing slash, AMP) must map to
// one canonical form so it is only stored once.

import { createHash } from 'node:crypto';
import { normaliseTitle } from './text.js';

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'mc_cid', 'mc_eid', 'igshid',
  'ref', 'ref_src', 'ref_url', 'referrer', 'source', 'src', 'cmpid', 'cmp', 'ito', 'ncid', 'sr_share',
  'rss', 'feed', 'from', 'share', 'output', 'outputtype', 'amp', '_ga', '_gl', 'spm', 'smid', 'partner'
]);
const TRACKING_PREFIXES = ['utm_', 'mkt_', 'pk_', 'hsa_', 'oly_', 'vero_', 'at_'];

export function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function canonicalizeUrl(raw) {
  if (!isHttpUrl(raw)) return null;
  const u = new URL(raw.trim());
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^(www|m|mobile|amp)\./, '');
  u.hash = '';
  u.username = '';
  u.password = '';
  if ((u.port === '443') || (u.port === '80')) u.port = '';

  const kept = [];
  for (const [key, value] of u.searchParams) {
    const k = key.toLowerCase();
    if (TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p))) continue;
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => a.localeCompare(b));
  u.search = kept.length ? '?' + kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';

  let pathname = u.pathname
    .replace(/\/amp\/?$/i, '/')
    .replace(/\/index\.(html?|php)$/i, '/')
    .replace(/\/{2,}/g, '/');
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
  u.pathname = pathname;
  return u.toString();
}

export function shortHash(value, length = 16) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

export const articleIdFor = (canonicalUrl) => `a_${shortHash(canonicalUrl)}`;
export const jobIdFor = (key) => `j_${shortHash(key)}`;
// "Gulf Horizon Asset Management" and "gulf horizon asset management." are one employer.
export const employerIdFor = (company) => `emp_${shortHash(normaliseTitle(company))}`;
