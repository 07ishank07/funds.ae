// HTTP plumbing shared by every route: JSON responses with security headers
// and ETags, the error envelope, CORS, client IP and safe body reading.

import { createHash } from 'node:crypto';
import { errorBody } from '../contracts/envelope.js';

export class HttpProblem extends Error {
  constructor(status, message, { code, fields, headers } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.headers = headers;
  }
}

// API responses are data, never documents: nothing in them may run or be framed.
const API_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
};

export function hstsHeader(app) {
  return app.hsts ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {};
}

/**
 * CORS for public reads: any origin when ALLOWED_ORIGINS is "*" (the data is
 * public and read-only), otherwise only listed origins.
 */
export function readCors(req, app) {
  const origin = req.headers.origin;
  if (app.allowedOrigins.includes('*')) return { 'Access-Control-Allow-Origin': '*' };
  if (origin && app.allowedOrigins.includes(origin)) return { 'Access-Control-Allow-Origin': origin };
  return {};
}

/**
 * Writes are stricter: "*" never applies. A browser request must come from the
 * same origin or one listed in ALLOWED_ORIGINS. Requests without an Origin
 * header (server-to-server tools) are allowed but still validated and rate limited.
 */
export function writeOriginAllowed(req, app) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (origin === 'null') return false;
  if (app.allowedOrigins.includes(origin)) return true;
  try {
    const host = (app.trustProxy && firstHeaderValue(req.headers['x-forwarded-host'])) || req.headers.host;
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function writeCors(req, app) {
  const origin = req.headers.origin;
  return origin && writeOriginAllowed(req, app) ? { 'Access-Control-Allow-Origin': origin } : {};
}

function firstHeaderValue(value) {
  return String(value || '').split(',')[0].trim();
}

/**
 * Client IP for rate limiting. Behind a proxy (TRUST_PROXY=true) the right-most
 * X-Forwarded-For entry is the address your own proxy saw; entries to its left
 * are supplied by the client and can be forged.
 */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

export function sendJson(req, res, app, status, body, { cache, headers = {}, cors = readCors(req, app) } = {}) {
  const json = JSON.stringify(body);
  const etag = `"${createHash('sha1').update(json).digest('base64url')}"`;
  const all = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cache || (status === 200 ? 'public, max-age=300' : 'no-store'),
    ETag: etag,
    Vary: 'Origin',
    ...API_HEADERS,
    ...hstsHeader(app),
    ...cors,
    ...headers
  };
  if (status === 200 && req.headers['if-none-match'] === etag) {
    res.writeHead(304, all);
    return res.end();
  }
  res.writeHead(status, all);
  res.end(req.method === 'HEAD' ? undefined : json);
}

export function sendError(req, res, app, status, message, { code, fields, headers, cors } = {}) {
  return sendJson(req, res, app, status, errorBody(status, message, { code, fields }), { cache: 'no-store', headers, cors });
}

export function sendProblem(req, res, app, problem, opts = {}) {
  return sendError(req, res, app, problem.status, problem.message, { code: problem.code, fields: problem.fields, headers: problem.headers, ...opts });
}

/**
 * Reads a JSON request body with a hard size cap. Only application/json is
 * accepted: that also means a plain cross-site HTML form cannot post here.
 */
export async function readJsonBody(req, { maxBytes }) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpProblem(415, 'Send the form as JSON (Content-Type: application/json).');
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpProblem(413, 'The form is too large.');

  // Event-based on purpose: leaving a for-await loop early destroys the socket,
  // and the client would see a reset instead of a 413. Oversized bodies are
  // drained and discarded while the error response goes out.
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const settle = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settle(reject, new HttpProblem(413, 'The form is too large.', { headers: { Connection: 'close' } }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        settle(resolve, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        settle(reject, new HttpProblem(400, 'The request body is not valid JSON.'));
      }
    });
    req.on('error', (err) => settle(reject, err));
  });
}
