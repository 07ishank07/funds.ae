// Client for the Sanity HTTP API. No SDK: requests go through lib/http.js, which brings
// timeouts, retries, a response-size cap and the public-address check used for every
// outbound request.
//
// Settings come from the environment only (never from files in the repo):
//   SANITY_PROJECT_ID    required, e.g. "ab12cd34"
//   SANITY_DATASET       default "production"
//   SANITY_API_VERSION   default DEFAULT_API_VERSION (pinned so Sanity changes never surprise us)
//   SANITY_READ_TOKEN    Viewer token: reads private documents (the news queue's queue.* ids).
//   SANITY_WRITE_TOKEN   Editor token, for the news importer only: creates pending stories and records
//                        source health (docs/NEWS-REVIEW-GUIDE.md). Nothing else is given it.
// Tokens are sent as an Authorization header and never logged.

import { fetchText, HttpError } from '../lib/http.js';
import { ConfigError } from '../config.js';

export const DEFAULT_API_VERSION = '2025-02-19';
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DATASET = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const API_VERSION = /^\d{4}-\d{2}-\d{2}$/;
const TAG = /^[a-z0-9][a-z0-9.-]{0,74}$/;
const MAX_GET_URL = 8000;
export const MUTATION_CHUNK = 100;

/** @returns {{ projectId: string, dataset: string, apiVersion: string, token: string|null, writeToken: string|null }} */
export function sanityConfigFromEnv(env = process.env) {
  const projectId = String(env.SANITY_PROJECT_ID || '').trim();
  const dataset = String(env.SANITY_DATASET || 'production').trim();
  const apiVersion = String(env.SANITY_API_VERSION || DEFAULT_API_VERSION).trim();
  const writeToken = String(env.SANITY_WRITE_TOKEN || '').trim() || null;
  // Reads use the read token; the importer, which only has the write token, reads with that.
  const token = String(env.SANITY_READ_TOKEN || '').trim() || writeToken;
  const problems = [];
  if (!projectId) problems.push('SANITY_PROJECT_ID is not set.');
  else if (!PROJECT_ID.test(projectId)) problems.push('SANITY_PROJECT_ID must be lowercase letters and numbers (see sanity.io/manage).');
  if (!DATASET.test(dataset)) problems.push('SANITY_DATASET must be lowercase letters, numbers, _ and -.');
  if (!API_VERSION.test(apiVersion)) problems.push('SANITY_API_VERSION must be a date such as 2025-02-19.');
  if (problems.length) throw new ConfigError(problems.join(' '));
  return { projectId, dataset, apiVersion, token, writeToken };
}

const originOf = ({ projectId }, baseUrl) => baseUrl || `https://${projectId}.api.sanity.io`;

/**
 * The query URL. By default only published documents are returned (drafts never reach the site);
 * the news queue reads with perspective "raw" and filters ids itself (path("queue.*")).
 * GROQ parameters are passed as $name=<JSON>.
 */
export function queryUrl(sanity, query, { baseUrl, perspective = 'published', params = {}, tag } = {}) {
  const url = new URL(`/v${sanity.apiVersion}/data/query/${sanity.dataset}`, originOf(sanity, baseUrl));
  url.searchParams.set('query', query);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(`$${name}`, JSON.stringify(value));
  url.searchParams.set('perspective', perspective);
  if (tag) url.searchParams.set('tag', tag);
  return url.toString();
}

function explain(err, kind) {
  if (!(err instanceof HttpError)) return err;
  if (err.status === 401 || err.status === 403) {
    return new HttpError(kind === 'write'
      ? 'Sanity refused the write token (check SANITY_WRITE_TOKEN and that it has Editor access).'
      : 'Sanity refused the read token (check SANITY_READ_TOKEN and that it has Viewer access).', { status: err.status, permanent: true });
  }
  if (err.status === 404) {
    return new HttpError('Sanity project or dataset not found (check SANITY_PROJECT_ID and SANITY_DATASET).', { status: 404, permanent: true });
  }
  if (err.status === 409) return new HttpError('Sanity reported a conflict: a document changed at the same moment. Run again.', { status: 409, permanent: true });
  if (err.status === 400 && err.detail) return new HttpError(`Sanity refused the request: ${err.detail}`, { status: 400, permanent: true });
  return err;
}

function parseResult(res, field) {
  let body;
  try {
    body = JSON.parse(res.body);
  } catch {
    throw new HttpError('Sanity returned something that is not JSON.', { status: res.status });
  }
  if (!body || typeof body !== 'object' || !(field in body)) throw new HttpError(`Sanity returned no ${field}.`, { status: res.status });
  return body[field];
}

/**
 * Runs one GROQ query and returns its `result`. Long queries (many parameters) are sent as POST.
 * @param {{ projectId, dataset, apiVersion, token }} sanity
 * @param {string} query
 * @param {{ params?: object, perspective?: string, tag?: string, userAgent?: string, baseUrl?: string,
 *           retries?: number, retryBaseDelayMs?: number, timeoutMs?: number }} [opts]
 *   baseUrl replaces https://<projectId>.api.sanity.io (tests point it at a local mock server).
 */
export async function querySanity(sanity, query, opts = {}) {
  const { baseUrl, params = {}, perspective = 'published', tag, ...http } = opts;
  if (tag && !TAG.test(tag)) throw new ConfigError(`Invalid Sanity request tag "${tag}".`);
  const headers = sanity.token ? { Authorization: `Bearer ${sanity.token}` } : {};
  const getUrl = queryUrl(sanity, query, { baseUrl, perspective, params, tag });
  const request = { timeoutMs: 20000, retries: 2, maxResponseBytes: 10_000_000, ...http, headers, accept: 'application/json', errorDetail: true };
  let res;
  try {
    if (getUrl.length <= MAX_GET_URL) {
      res = await fetchText(getUrl, request);
    } else {
      const url = new URL(`/v${sanity.apiVersion}/data/query/${sanity.dataset}`, originOf(sanity, baseUrl));
      url.searchParams.set('perspective', perspective);
      if (tag) url.searchParams.set('tag', tag);
      res = await fetchText(url.toString(), { ...request, method: 'POST', json: { query, params } });
    }
  } catch (err) {
    throw explain(err, 'read');
  }
  return parseResult(res, 'result');
}

/**
 * Sends mutations with the write token, in transactions of at most MUTATION_CHUNK. Callers send only
 * mutations that are safe to repeat (createIfNotExists, set/setIfMissing patches, delete by query,
 * createOrReplace of a state document), so a retry after a timeout cannot do harm.
 * @returns {Promise<{id:string, operation:string}[]>} one result per changed document
 */
export async function mutateSanity(sanity, mutations, opts = {}) {
  const { baseUrl, tag, ...http } = opts;
  if (!sanity.writeToken) throw new ConfigError('SANITY_WRITE_TOKEN is not set: only the news importer writes to Sanity, and it needs an Editor token.');
  if (tag && !TAG.test(tag)) throw new ConfigError(`Invalid Sanity request tag "${tag}".`);
  const url = new URL(`/v${sanity.apiVersion}/data/mutate/${sanity.dataset}`, originOf(sanity, baseUrl));
  url.searchParams.set('returnIds', 'true');
  url.searchParams.set('visibility', 'sync');
  if (tag) url.searchParams.set('tag', tag);
  const results = [];
  for (let i = 0; i < mutations.length; i += MUTATION_CHUNK) {
    let res;
    try {
      res = await fetchText(url.toString(), {
        timeoutMs: 30000, retries: 2, maxResponseBytes: 5_000_000, ...http,
        method: 'POST', json: { mutations: mutations.slice(i, i + MUTATION_CHUNK) },
        headers: { Authorization: `Bearer ${sanity.writeToken}` }, accept: 'application/json', errorDetail: true
      });
    } catch (err) {
      throw explain(err, 'write');
    }
    results.push(...(parseResult(res, 'results') || []));
  }
  return results;
}
