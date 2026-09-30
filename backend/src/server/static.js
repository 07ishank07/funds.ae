// Serves the website itself so one process can host pages, API and forms.
//
// Only these locations are reachable (everything else is 404):
//   /frontend_demo/*   the pages          /js/*       the website scripts
//   /assets/*          sponsor images     /i18n.js    the language switch
//   /                  redirects to /frontend_demo/this.html
// backend/, admin/, .github/, dotfiles and any extension not listed below are
// never served. admin/ is deliberately excluded: it holds a GitHub token in
// the browser and should not share an origin with the public site's API.

import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, ASSETS_DIR } from '../config.js';
import { hstsHeader } from './http.js';

export const HOME_PATH = '/frontend_demo/this.html';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

// The home page is a design-tool bundle: it unpacks itself into blob: URLs,
// runs inline scripts and uses new Function(), so 'unsafe-inline',
// 'unsafe-eval' and blob: are required for it to render. Everything else is
// locked to this origin plus the font and CDN hosts the pages already use.
// Rebuilding this.html as plain HTML would allow a much stricter policy.
export const DEFAULT_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' blob: https://fonts.googleapis.com",
  "font-src 'self' data: blob: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' blob:",
  "frame-src 'self' blob: about:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

export function staticRoots() {
  return [
    { prefix: '/frontend_demo/', dir: path.join(REPO_ROOT, 'frontend_demo') },
    { prefix: '/js/', dir: path.join(REPO_ROOT, 'js') },
    { prefix: '/assets/', dir: ASSETS_DIR }
  ];
}

const SINGLE_FILES = { '/i18n.js': path.join(REPO_ROOT, 'i18n.js') };

/**
 * Maps a URL pathname to a file inside an allowed root, or null.
 * The pathname is still percent-encoded (as URL.pathname returns it); each
 * segment is decoded on its own so "%2f" or "%5c" can never introduce a
 * separator, and ".." or dotfiles are rejected outright.
 */
export function resolveStaticPath(pathname, roots = staticRoots()) {
  if (Object.hasOwn(SINGLE_FILES, pathname)) return SINGLE_FILES[pathname];
  const root = roots.find((r) => pathname.startsWith(r.prefix));
  if (!root) return null;
  const segments = [];
  for (const raw of pathname.slice(root.prefix.length).split('/')) {
    let seg;
    try { seg = decodeURIComponent(raw); } catch { return null; }
    if (!seg || seg.startsWith('.') || /[\\/:\0]/.test(seg)) return null;
    segments.push(seg);
  }
  if (!segments.length) return null;
  const file = path.resolve(root.dir, ...segments);
  if (!file.startsWith(root.dir + path.sep)) return null;
  if (!Object.hasOwn(TYPES, path.extname(file).toLowerCase())) return null;
  return file;
}

export function serveStatic(req, res, app, pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(302, { Location: HOME_PATH, 'Cache-Control': 'no-cache', ...hstsHeader(app) });
    return res.end();
  }
  const file = resolveStaticPath(pathname);
  let stat;
  try { stat = file && existsSync(file) ? statSync(file) : null; } catch { stat = null; }
  if (!stat || !stat.isFile()) return false;

  const ext = path.extname(file).toLowerCase();
  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  const headers = {
    'Content-Type': TYPES[ext],
    'Cache-Control': ext === '.html' || ext === '.js' ? 'no-cache' : 'public, max-age=3600',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    ...hstsHeader(app)
  };
  if (ext === '.html') {
    headers['Content-Security-Policy'] = app.pageCsp;
    headers['X-Frame-Options'] = 'SAMEORIGIN';
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
  return true;
}
