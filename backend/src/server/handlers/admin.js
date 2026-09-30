// GET /api/v1/admin/submissions?kind=contact&limit=50
//
// Lets an editor read form submissions without shell access to the server.
// Protected by a bearer token (ADMIN_API_TOKEN, at least 32 characters). If
// the token is not configured the route does not exist (404). Failed attempts
// count against the strict write rate limit, which blunts guessing.

import { createHash, timingSafeEqual } from 'node:crypto';
import { SUBMISSION_KINDS } from '../../contracts/models.js';
import { HttpProblem, clientIp, sendJson } from '../http.js';

const digest = (value) => createHash('sha256').update(String(value)).digest();

export function tokenMatches(presented, expected) {
  // Hash both sides so the comparison is constant-time regardless of length.
  return timingSafeEqual(digest(presented), digest(expected));
}

export async function handleAdmin(req, res, app, url, rest) {
  if (!app.adminToken || !app.submissions || rest !== 'admin/submissions') throw new HttpProblem(404, 'Not found.');

  const match = /^Bearer\s+(\S{1,512})$/i.exec(String(req.headers.authorization || ''));
  if (!match || !tokenMatches(match[1], app.adminToken)) {
    const limit = app.writeLimiter.take(`admin:${clientIp(req, app.trustProxy)}`);
    if (!limit.ok) throw new HttpProblem(429, 'Too many attempts.', { headers: { 'Retry-After': String(limit.retryAfterSec) } });
    throw new HttpProblem(401, 'A valid admin token is required.', { headers: { 'WWW-Authenticate': 'Bearer' } });
  }

  for (const key of url.searchParams.keys()) {
    if (!['kind', 'limit'].includes(key)) throw new HttpProblem(400, `Unknown query parameter "${key}".`);
  }
  const kind = url.searchParams.get('kind');
  if (!SUBMISSION_KINDS.includes(kind)) throw new HttpProblem(400, `kind must be one of: ${SUBMISSION_KINDS.join(', ')}.`);
  const rawLimit = url.searchParams.get('limit') || '50';
  if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 200) {
    throw new HttpProblem(400, 'limit must be a whole number from 1 to 200.');
  }

  const items = await app.submissions.list(kind, { limit: Number(rawLimit) });
  // Private data: never cached, never shared cross-origin.
  return sendJson(req, res, app, 200, { apiVersion: 1, mode: app.mode, kind, count: items.length, items }, {
    cache: 'no-store, private',
    cors: {}
  });
}
