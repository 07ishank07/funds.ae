// Method + path dispatch. Anything not matched here is 404.
//
//   GET  /health
//   GET  /api/v1/meta | news | news/:id | jobs | employers | events | sponsors | content | sources | taxonomy
//   GET  /api/v1/<static file name>.json          (same names as GitHub Pages)
//   POST /api/v1/submissions/:kind                 (contact, newsletter, advertise, event, job)
//   GET  /api/v1/admin/submissions                 (bearer token)
//   GET  /frontend_demo/*, /js/*, /assets/*, /i18n.js, /   (the website, when SERVE_STATIC is on)

import { handleRead } from './handlers/read.js';
import { handleSubmission } from './handlers/submissions.js';
import { handleAdmin } from './handlers/admin.js';
import { HttpProblem, clientIp, readCors, sendJson, writeCors, writeOriginAllowed } from './http.js';
import { serveStatic } from './static.js';

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const WRITE_METHODS = ['POST', 'OPTIONS'];

function methodNotAllowed(allowed) {
  return new HttpProblem(405, `Use ${allowed.filter((m) => m !== 'OPTIONS').join(' or ')}.`, { headers: { Allow: allowed.join(', ') } });
}

function preflight(req, res, app, { write }) {
  if (write && !writeOriginAllowed(req, app)) throw new HttpProblem(403, 'Forms can only be sent from the Funds.ae website.');
  const cors = write ? writeCors(req, app) : readCors(req, app);
  res.writeHead(204, {
    ...cors,
    'Access-Control-Allow-Methods': (write ? WRITE_METHODS : READ_METHODS).join(', '),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
    'Cache-Control': 'no-store'
  });
  res.end();
}

export async function route(req, res, app) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const ip = clientIp(req, app.trustProxy);

  if (pathname === '/health') {
    if (!READ_METHODS.includes(req.method)) throw methodNotAllowed(READ_METHODS);
    const meta = app.readApi('meta.json');
    return sendJson(req, res, app, meta ? 200 : 503, { ok: Boolean(meta), generatedAt: meta?.generatedAt || null, mode: meta?.mode || null }, { cache: 'no-store' });
  }

  if (pathname.startsWith('/api/v1/')) {
    const rest = pathname.slice('/api/v1/'.length).replace(/\/+$/, '');

    if (rest.startsWith('submissions/')) {
      if (!WRITE_METHODS.includes(req.method)) throw methodNotAllowed(WRITE_METHODS);
      if (req.method === 'OPTIONS') return preflight(req, res, app, { write: true });
      return handleSubmission(req, res, app, rest.slice('submissions/'.length));
    }

    if (!app.readLimiter.take(ip).ok) {
      throw new HttpProblem(429, 'Too many requests; try again in a minute.', { headers: { 'Retry-After': '60' } });
    }

    if (rest.startsWith('admin/')) {
      if (req.method !== 'GET') throw methodNotAllowed(['GET']);
      return handleAdmin(req, res, app, url, rest);
    }

    if (!READ_METHODS.includes(req.method)) throw methodNotAllowed(READ_METHODS);
    if (req.method === 'OPTIONS') return preflight(req, res, app, { write: false });
    if (handleRead(req, res, app, url, rest)) return;
    throw new HttpProblem(404, 'Not found.');
  }

  if (app.serveStatic && (req.method === 'GET' || req.method === 'HEAD')) {
    if (!app.staticLimiter.take(ip).ok) {
      throw new HttpProblem(429, 'Too many requests; try again in a minute.', { headers: { 'Retry-After': '60' } });
    }
    if (serveStatic(req, res, app, pathname)) return;
  }
  throw new HttpProblem(404, 'Not found.');
}
