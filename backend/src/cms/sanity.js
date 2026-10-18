// Read-only client for the Sanity HTTP query API. No SDK: one GET through
// lib/http.js, which brings timeouts, retries, a response-size cap and the
// public-address check used for every outbound request.
//
// Settings come from the environment only (never from files in the repo):
//   SANITY_PROJECT_ID    required, e.g. "ab12cd34"
//   SANITY_DATASET       default "production"
//   SANITY_API_VERSION   default DEFAULT_API_VERSION (pinned so Sanity changes never surprise us)
//   SANITY_READ_TOKEN    Viewer token for a private dataset. Sent as a header, never logged.

import { fetchText, HttpError } from '../lib/http.js';
import { ConfigError } from '../config.js';

export const DEFAULT_API_VERSION = '2025-02-19';
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DATASET = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const API_VERSION = /^\d{4}-\d{2}-\d{2}$/;

/** @returns {{ projectId: string, dataset: string, apiVersion: string, token: string|null }} */
export function sanityConfigFromEnv(env = process.env) {
  const projectId = String(env.SANITY_PROJECT_ID || '').trim();
  const dataset = String(env.SANITY_DATASET || 'production').trim();
  const apiVersion = String(env.SANITY_API_VERSION || DEFAULT_API_VERSION).trim();
  const token = String(env.SANITY_READ_TOKEN || '').trim() || null;
  const problems = [];
  if (!projectId) problems.push('SANITY_PROJECT_ID is not set.');
  else if (!PROJECT_ID.test(projectId)) problems.push('SANITY_PROJECT_ID must be lowercase letters and numbers (see sanity.io/manage).');
  if (!DATASET.test(dataset)) problems.push('SANITY_DATASET must be lowercase letters, numbers, _ and -.');
  if (!API_VERSION.test(apiVersion)) problems.push('SANITY_API_VERSION must be a date such as 2025-02-19.');
  if (problems.length) throw new ConfigError(problems.join(' '));
  return { projectId, dataset, apiVersion, token };
}

/** The query URL. Only published documents are returned (drafts never reach the site). */
export function queryUrl({ projectId, dataset, apiVersion }, query, { baseUrl } = {}) {
  const origin = baseUrl || `https://${projectId}.api.sanity.io`;
  const url = new URL(`/v${apiVersion}/data/query/${dataset}`, origin);
  url.searchParams.set('query', query);
  url.searchParams.set('perspective', 'published');
  return url.toString();
}

/**
 * Runs one GROQ query and returns its `result`.
 * @param {{ projectId, dataset, apiVersion, token }} sanity
 * @param {string} query
 * @param {{ userAgent?: string, baseUrl?: string, retries?: number, retryBaseDelayMs?: number, timeoutMs?: number }} [opts]
 *   baseUrl replaces https://<projectId>.api.sanity.io (tests point it at a local mock server).
 */
export async function querySanity(sanity, query, opts = {}) {
  const { baseUrl, ...http } = opts;
  const headers = sanity.token ? { Authorization: `Bearer ${sanity.token}` } : {};
  let res;
  try {
    res = await fetchText(queryUrl(sanity, query, { baseUrl }), {
      timeoutMs: 20000,
      retries: 2,
      maxResponseBytes: 10_000_000,
      ...http,
      headers,
      accept: 'application/json'
    });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      throw new HttpError('Sanity refused the read token (check SANITY_READ_TOKEN and that it has Viewer access).', { status: err.status, permanent: true });
    }
    if (err instanceof HttpError && err.status === 404) {
      throw new HttpError('Sanity project or dataset not found (check SANITY_PROJECT_ID and SANITY_DATASET).', { status: 404, permanent: true });
    }
    throw err;
  }
  let body;
  try {
    body = JSON.parse(res.body);
  } catch {
    throw new HttpError('Sanity returned something that is not JSON.', { status: res.status });
  }
  if (!body || typeof body !== 'object' || !('result' in body)) {
    throw new HttpError('Sanity returned no result.', { status: res.status });
  }
  return body.result;
}
