// Public read endpoints. They serve exactly the documents published to api/v1/
// (so GitHub Pages and this server can never disagree) and add filtering and
// paging on top. Every query parameter is validated against an allow-list;
// taxonomy values are checked against the published taxonomy.json.

import { readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { log } from '../../lib/logger.js';
import { cleanText } from '../../validation/validate.js';
import { HttpProblem, sendJson } from '../http.js';

const STATIC_FILES = new Set([
  'meta.json', 'news.json', 'jobs.json', 'employers.json', 'events.json',
  'sponsors.json', 'sources.json', 'taxonomy.json', 'content.json'
]);
const STATIC_PATTERNS = [/^news\/[a-z0-9-]{2,40}\.json$/, /^news\/topics\/[a-z0-9-]{2,40}\.json$/, /^news\/sections\/[a-z0-9-]{2,60}\.json$/];
const NAMED = { meta: 'meta.json', sponsors: 'sponsors.json', sources: 'sources.json', taxonomy: 'taxonomy.json', employers: 'employers.json', content: 'content.json' };

// "v" is the cache-busting parameter the website adds; it is always allowed.
const ALLOWED_PARAMS = {
  static: [],
  named: [],
  news: ['category', 'topic', 'section', 'q', 'limit', 'offset'],
  story: [],
  jobs: ['q', 'employer', 'featured', 'limit', 'offset'],
  events: ['status', 'limit', 'offset']
};

/** Cached, mtime-checked reader for api/v1 documents. Returns null if missing or unreadable. */
export function createApiReader(dir) {
  const apiDir = path.resolve(dir);
  const cache = new Map();
  return function readApi(rel) {
    const file = path.join(apiDir, rel);
    if (!file.startsWith(apiDir + path.sep) || !existsSync(file)) return null;
    try {
      const { mtimeMs } = statSync(file);
      const hit = cache.get(file);
      if (hit && hit.mtimeMs === mtimeMs) return hit.data;
      const data = JSON.parse(readFileSync(file, 'utf8'));
      cache.set(file, { mtimeMs, data });
      return data;
    } catch (err) {
      log.error('api.read-failed', { file: rel, detail: err.message });
      return null;
    }
  };
}

function checkParams(url, kind) {
  const allowed = new Set([...ALLOWED_PARAMS[kind], 'v']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new HttpProblem(400, `Unknown query parameter "${key}".`);
  }
}

function intParam(url, name, def, min, max) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return def;
  if (!/^\d{1,6}$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new HttpProblem(400, `${name} must be a whole number from ${min} to ${max}.`);
  }
  return Number(raw);
}

function enumParam(url, name, values) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return null;
  if (!values.includes(raw)) throw new HttpProblem(400, `Unknown ${name} "${raw.slice(0, 40)}".`);
  return raw;
}

function textQuery(url) {
  const q = cleanText(url.searchParams.get('q') || '').toLowerCase();
  if (q.length > 100) throw new HttpProblem(400, 'q must be 100 characters or fewer.');
  return q;
}

function requireDoc(doc) {
  if (!doc) throw new HttpProblem(503, 'Data has not been generated yet. Run npm run ingest.');
  return doc;
}

function paged(req, res, app, doc, items, url, extra = {}) {
  const limit = intParam(url, 'limit', 20, 1, 100);
  const offset = intParam(url, 'offset', 0, 0, 10_000);
  const { items: _all, count: _count, ...meta } = doc;
  return sendJson(req, res, app, 200, {
    ...meta,
    ...extra,
    total: items.length,
    limit,
    offset,
    count: Math.max(0, Math.min(limit, items.length - offset)),
    items: items.slice(offset, offset + limit)
  });
}

/** meta.json from GitHub Pages says forms are off; this server says what is true here. */
function withCapabilities(meta, app) {
  return { ...meta, capabilities: { ...(meta.capabilities || {}), submissions: app.submissionsEnabled } };
}

/** Today's calendar date in the UAE, which is how event dates are written. */
export function dubaiToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * @param {string} rest  path after /api/v1/, without trailing slash
 * @returns {boolean} false when no read route matches
 */
export function handleRead(req, res, app, url, rest) {
  if (STATIC_FILES.has(rest) || STATIC_PATTERNS.some((re) => re.test(rest))) {
    checkParams(url, 'static');
    const doc = app.readApi(rest);
    if (!doc) throw new HttpProblem(404, 'Not found.');
    sendJson(req, res, app, 200, rest === 'meta.json' ? withCapabilities(doc, app) : doc);
    return true;
  }

  if (Object.hasOwn(NAMED, rest)) {
    checkParams(url, 'named');
    const doc = requireDoc(app.readApi(NAMED[rest]));
    sendJson(req, res, app, 200, rest === 'meta' ? withCapabilities(doc, app) : doc);
    return true;
  }

  if (rest === 'news') {
    checkParams(url, 'news');
    const all = requireDoc(app.readApi('news.json'));
    const taxonomy = app.readApi('taxonomy.json') || { categories: [], topics: [], sections: [] };
    const category = enumParam(url, 'category', taxonomy.categories.map((c) => c.id));
    const topic = enumParam(url, 'topic', taxonomy.topics.map((t) => t.id));
    const sectionId = enumParam(url, 'section', (taxonomy.sections || []).map((s) => s.id));
    const section = sectionId && taxonomy.sections.find((s) => s.id === sectionId);
    const q = textQuery(url);
    const items = all.items.filter((s) =>
      (!category || s.category === category) &&
      (!topic || s.topic === topic || s.topics.includes(topic)) &&
      (!section || ((section.topics.includes(s.topic) || s.topics.some((t) => section.topics.includes(t))) && (!section.category || s.category === section.category))) &&
      (!q || `${s.headline} ${s.summary || ''} ${s.sources.map((x) => x.source).join(' ')}`.toLowerCase().includes(q))
    );
    paged(req, res, app, all, items, url);
    return true;
  }

  const story = /^news\/([^/]+)$/.exec(rest);
  if (story) {
    checkParams(url, 'story');
    if (!/^s_[a-f0-9]{8,20}$/.test(story[1])) throw new HttpProblem(400, 'Invalid story id.');
    const all = requireDoc(app.readApi('news.json'));
    const found = all.items.find((s) => s.id === story[1]);
    if (!found) throw new HttpProblem(404, 'Story not found.');
    sendJson(req, res, app, 200, found);
    return true;
  }

  if (rest === 'jobs') {
    checkParams(url, 'jobs');
    const all = requireDoc(app.readApi('jobs.json'));
    const q = textQuery(url);
    const employer = url.searchParams.get('employer');
    if (employer && !/^emp_[a-f0-9]{16}$/.test(employer)) throw new HttpProblem(400, 'Invalid employer id.');
    const featured = enumParam(url, 'featured', ['true', 'false']);
    const items = all.items.filter((j) =>
      (!q || `${j.title} ${j.company} ${j.location || ''}`.toLowerCase().includes(q)) &&
      (!employer || j.employerId === employer) &&
      (!featured || j.featured === (featured === 'true'))
    );
    paged(req, res, app, all, items, url);
    return true;
  }

  if (rest === 'events') {
    checkParams(url, 'events');
    const all = requireDoc(app.readApi('events.json'));
    const status = enumParam(url, 'status', ['upcoming', 'past']);
    const today = dubaiToday(app.now());
    let items = all.items;
    if (status === 'upcoming') items = items.filter((e) => (e.endDate || e.startDate) >= today);
    if (status === 'past') items = items.filter((e) => (e.endDate || e.startDate) < today).reverse();
    paged(req, res, app, all, items, url, status ? { status } : {});
    return true;
  }

  return false;
}
