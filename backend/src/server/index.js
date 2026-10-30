// The optional Funds.ae server: website pages, the read API with filters and
// paging, and the website forms. GitHub Pages hosting needs none of this; the
// static files in api/v1/ are the API there and forms show a "not sent" notice.
//
// Configuration is read from the environment (documented in backend/.env.example)
// when createServer() is called, so tests can pass their own values.

import http from 'node:http';
import path from 'node:path';
import { API_DIR, DATA_DIR, loadSettings } from '../config.js';
import { createSubmissionsRepository } from '../repositories/index.js';
import { log } from '../lib/logger.js';
import { createApiReader } from './handlers/read.js';
import { HttpProblem, sendError, sendProblem } from './http.js';
import { CompositeLimiter, RateLimiter } from './rateLimit.js';
import { route } from './routes.js';
import { DEFAULT_PAGE_CSP } from './static.js';
import { mutateSanity, sanityConfigFromEnv } from '../cms/sanity.js';
import { assertJobSubmissionMutation } from '../jobs/submissionMutations.js';

const MINUTE = 60_000;

/**
 * Where Post a Job submissions go when settings jobs.review.store is "sanity": one createIfNotExists of a
 * Pending review job, checked by assertJobSubmissionMutation before it is sent. Needs SANITY_PROJECT_ID,
 * SANITY_DATASET and SANITY_WRITE_TOKEN. Returns null (submissions stay in the file queue) when not configured.
 * @param {object} http  extra mutateSanity options (tests: baseUrl, retries)
 */
export function sanityJobSink(env, http = {}) {
  let sanity;
  try {
    sanity = sanityConfigFromEnv(env);
  } catch (err) {
    log.error('server.jobs-sink-disabled', { detail: err.message });
    return null;
  }
  if (!sanity.writeToken) {
    log.error('server.jobs-sink-disabled', { detail: 'SANITY_WRITE_TOKEN is not set; Post a Job submissions stay in the file queue.' });
    return null;
  }
  return {
    async create(doc) {
      const mutation = assertJobSubmissionMutation({ createIfNotExists: doc });
      await mutateSanity(sanity, [mutation], { tag: 'fundsae.jobs.submit', retries: 1, ...http });
    }
  };
}

/**
 * @param {{ env?: Record<string,string|undefined>, apiDir?: string, dataDir?: string, now?: () => Date,
 *           jobSink?: {create(doc:object):Promise<void>}|null }} options
 *   jobSink: where job submissions go (tests pass a stand-in); built from the environment when omitted.
 */
export function buildApp({ env = process.env, apiDir, dataDir, now = () => new Date(), jobSink } = {}) {
  const settings = loadSettings();
  const demo = settings.mode === 'demo';
  const sub = settings.submissions;
  const submissionsEnabled = env.SUBMISSIONS_ENABLED !== 'false' && sub.enabled !== false;
  const adminToken = env.ADMIN_API_TOKEN && env.ADMIN_API_TOKEN.length >= 32 ? env.ADMIN_API_TOKEN : null;
  if (env.ADMIN_API_TOKEN && !adminToken) log.warn('server.admin-disabled', { detail: 'ADMIN_API_TOKEN must be at least 32 characters; the admin route is off.' });

  const resolvedApiDir = apiDir || API_DIR;
  const resolvedDataDir = dataDir || (demo ? path.join(DATA_DIR, 'demo') : DATA_DIR);
  const jobsStore = env.FUNDSAE_JOBS_STORE || settings.jobs.review.store;
  const jobs = submissionsEnabled && jobsStore === 'sanity' ? (jobSink === undefined ? sanityJobSink(env) : jobSink) : null;

  return {
    mode: settings.mode,
    now,
    allowedOrigins: (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY === 'true',
    hsts: env.HSTS === 'true',
    serveStatic: env.SERVE_STATIC !== 'false',
    pageCsp: env.STATIC_CSP || DEFAULT_PAGE_CSP,
    readApi: createApiReader(resolvedApiDir),
    readLimiter: new RateLimiter({ capacity: Number(env.RATE_LIMIT_PER_MIN || 120), windowMs: MINUTE }),
    staticLimiter: new RateLimiter({ capacity: Number(env.STATIC_RATE_LIMIT_PER_MIN || 600), windowMs: MINUTE }),
    writeLimiter: new CompositeLimiter([
      new RateLimiter({ capacity: Number(env.WRITE_RATE_LIMIT_PER_MIN || sub.writeRatePerMinute), windowMs: MINUTE }),
      new RateLimiter({ capacity: Number(env.WRITE_RATE_LIMIT_PER_HOUR || sub.writeRatePerHour), windowMs: 60 * MINUTE })
    ]),
    submissionsEnabled,
    maxBodyBytes: sub.maxBodyBytes,
    submissions: submissionsEnabled
      ? createSubmissionsRepository(resolvedDataDir, {
          hashSalt: env.SUBMISSIONS_HASH_SALT || undefined,
          // Demo storage is capped so a public demo cannot fill the disk.
          maxPerKind: demo ? sub.demoMaxPerKind : Infinity
        })
      : null,
    // Post a Job submissions go to the Sanity review queue (Careers > Jobs: pending review) when set.
    jobSink: jobs,
    adminToken
  };
}

export function createServer(options = {}) {
  const app = buildApp(options);
  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res, app);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof HttpProblem) return sendProblem(req, res, app, err);
      // Never leak stack traces or internal messages to the client.
      log.error('api.error', { path: String(req.url).slice(0, 200), detail: err?.message });
      return sendError(req, res, app, 500, 'Internal error.');
    }
  });
  // Slow-client protection.
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.app = app;
  return server;
}
