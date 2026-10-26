// The Sanity review queue (repositories/newsReview.sanity.js) against an in-memory mock of
// Sanity's query and mutate API: the importer writes only guarded mutations with the write
// token, patches open drafts, chunks large writes, records source health; the publisher only
// reads; tokens never appear in logs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(tmpdir(), 'fundsae-sanityq-'));
process.env.FUNDSAE_ALLOW_PRIVATE_URLS = '1';
process.env.FUNDSAE_API_DIR = path.join(tmp, 'api');
process.env.LOG_LEVEL = 'debug'; // a leaked token would show up even in debug lines

const { loadAll, withNewsDefaults } = await import('../src/config.js');
const { runNews } = await import('../src/pipeline/news.js');
const { publishApprovedNews } = await import('../src/pipeline/publish.js');
const { createSanityNewsReview, createSanityNewsHealth } = await import('../src/repositories/newsReview.sanity.js');
const { createNewsReviewRepository } = await import('../src/repositories/newsReview.js');
const { sanityConfigFromEnv } = await import('../src/cms/sanity.js');
const { fromSanityNewsDoc } = await import('../src/cms/mapping.js');
const { assertImporterMutation, createMutation, pruneMatches, pruneMutation, ImporterMutationError } = await import('../src/news/importerMutations.js');
const { newReviewDoc } = await import('../src/news/reviewDocs.js');
const { approvalHash } = await import('../src/news/workflow.js');

const READ = 'skREADtoken0123456789abcdefSECRET';
const WRITE = 'skWRITEtoken0123456789abcdefSECRET';
const NOW = new Date('2026-10-26T08:00:00Z');
const base = loadAll();

/* ------------------------------ mock Sanity + feeds ------------------------------ */

const store = new Map();
const requests = [];
const feeds = new Map();
let failNextMutate = null;
let server;
let origin;

const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { let data = ''; req.on('data', (c) => { data += c; }); req.on('end', () => resolve(data)); });
const isQueue = (id) => /^queue\./.test(id);

function answer(tag, p) {
  const queue = [...store.values()].filter((d) => isQueue(d._id) && d._type === 'newsArticle');
  switch (tag) {
    case 'fundsae.news.recent': return queue.filter((d) => d.lastSeenAt >= p.since || d.importedAt >= p.since);
    case 'fundsae.news.drafts': return p.draftIds.filter((id) => store.has(id));
    case 'fundsae.news.published': return queue.filter((d) => d.status === 'published' && d.publishedAt <= p.now);
    case 'fundsae.news.by-story': return queue.filter((d) => p.storyIds.includes(d.storyId)).map(({ _id, storyId, status }) => ({ _id, storyId, status }));
    case 'fundsae.news.count': return store.size;
    case 'fundsae.news.state': return store.get('newsAggregatorState') || null;
    default: throw new Error(`unexpected query tag ${tag}`);
  }
}

/** Applies a transaction atomically, the way Sanity does, and returns its results. */
function apply(mutations) {
  const next = new Map([...store].map(([k, v]) => [k, structuredClone(v)]));
  const results = [];
  for (const m of mutations) {
    if (m.createIfNotExists) {
      const doc = m.createIfNotExists;
      results.push({ id: doc._id, operation: next.has(doc._id) ? 'update' : 'create' });
      if (!next.has(doc._id)) next.set(doc._id, structuredClone(doc));
    } else if (m.patch) {
      const doc = next.get(m.patch.id);
      if (!doc) return { error: 404 };
      for (const [k, v] of Object.entries(m.patch.setIfMissing || {})) if (doc[k] === undefined) doc[k] = v;
      Object.assign(doc, structuredClone(m.patch.set || {}));
      results.push({ id: m.patch.id, operation: 'update' });
    } else if (m.delete) {
      for (const [id, doc] of next) if (pruneMatches(doc, m.delete.params)) { next.delete(id); results.push({ id, operation: 'delete' }); }
    } else if (m.createOrReplace) {
      results.push({ id: m.createOrReplace._id, operation: next.has(m.createOrReplace._id) ? 'update' : 'create' });
      next.set(m.createOrReplace._id, structuredClone(m.createOrReplace));
    }
  }
  store.clear();
  for (const [k, v] of next) store.set(k, v);
  return { results };
}

before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const raw = await readBody(req);
    if (url.pathname.startsWith('/feeds/')) {
      const feed = feeds.get(url.pathname) || { status: 404, body: '' };
      res.writeHead(feed.status, { 'content-type': 'application/rss+xml' });
      return res.end(feed.body);
    }
    const auth = req.headers.authorization;
    const tag = url.searchParams.get('tag');
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: req.method, path: url.pathname, tag, auth, body, perspective: url.searchParams.get('perspective') });
    if (![`Bearer ${READ}`, `Bearer ${WRITE}`].includes(auth)) return send(res, 401, { error: { description: 'Unauthorized' } });
    if (url.pathname === '/v2025-02-19/data/mutate/production') {
      if (auth !== `Bearer ${WRITE}`) return send(res, 403, { error: { description: 'Forbidden' } });
      if (failNextMutate) { const status = failNextMutate; failNextMutate = null; return send(res, status, { error: { description: 'Mutation failed' } }); }
      const out = apply(body.mutations);
      return out.error ? send(res, out.error, { error: { description: 'Document not found' } }) : send(res, 200, { transactionId: 't1', results: out.results });
    }
    if (url.pathname === '/v2025-02-19/data/query/production') {
      const params = req.method === 'POST'
        ? body.params
        : Object.fromEntries([...url.searchParams].filter(([k]) => k.startsWith('$')).map(([k, v]) => [k.slice(1), JSON.parse(v)]));
      return send(res, 200, { result: answer(tag, params) });
    }
    return send(res, 404, {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

const httpOpts = () => ({ baseUrl: origin, retries: 0, retryBaseDelayMs: 1 });
const importerQueue = () => createSanityNewsReview(sanityConfigFromEnv({ SANITY_PROJECT_ID: 'ab12cd34', SANITY_WRITE_TOKEN: WRITE }), { http: httpOpts() });
const publisherQueue = () => createSanityNewsReview(sanityConfigFromEnv({ SANITY_PROJECT_ID: 'ab12cd34', SANITY_READ_TOKEN: READ }), { http: httpOpts() });
const reset = () => { store.clear(); requests.length = 0; };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>F</title>${items.map((i) =>
  `<item><title>${esc(i.title)}</title><link>${esc(i.link)}</link><guid>${esc(i.link)}</guid><pubDate>${new Date('2026-10-25T06:00:00Z').toUTCString()}</pubDate><description>${esc(i.excerpt || '')}</description></item>`).join('')}</channel></rss>`;
const MUBADALA = { title: 'Mubadala backs $250 million Dubai build-to-rent fund', link: 'https://news.example.com/mubadala-btr', excerpt: 'Abu Dhabi sovereign investor Mubadala anchors a $250 million build-to-rent fund in Dubai.' };
const source = (id, extra = {}) => withNewsDefaults({
  id, name: `Source ${id}`, homepage: 'https://example.com', type: 'rss', url: `${origin}/feeds/${id}.xml`, enabled: true,
  region: 'uae', focus: 'private-markets', priority: 2, tier: 'L2', licenseStatus: 'wire', ...extra
});

function makeCtx(review, { now = NOW, sources = [source('wire-a')] } = {}) {
  const settings = structuredClone(base.settings);
  settings.mode = 'live';
  settings.http = { ...settings.http, retries: 0, retryBaseDelayMs: 1, timeoutMs: 3000 };
  settings.news.checkLinks = false;
  settings.news.review.approverIds = ['pApprover01'];
  return {
    settings, demo: false, now, taxonomy: base.taxonomy, newsTaxonomy: base.newsTaxonomy, newsSources: sources, allNewsSources: sources,
    review, newsHealth: createSanityNewsHealth(review)
  };
}

async function captureOutput(fn) {
  const out = [];
  const original = { stdout: process.stdout.write, stderr: process.stderr.write };
  process.stdout.write = (chunk, ...rest) => { out.push(String(chunk)); return original.stdout.call(process.stdout, chunk, ...rest); };
  process.stderr.write = (chunk, ...rest) => { out.push(String(chunk)); return original.stderr.call(process.stderr, chunk, ...rest); };
  try { await fn(); } finally { process.stdout.write = original.stdout; process.stderr.write = original.stderr; }
  return out.join('');
}

/* ------------------------------------ tests ------------------------------------ */

test('the importer creates pending stories in Sanity with guarded mutations and the write token', async () => {
  reset();
  feeds.set('/feeds/wire-a.xml', { status: 200, body: rss([MUBADALA]) });
  const review = importerQueue();
  const ctx = makeCtx(review);
  const output = await captureOutput(async () => {
    const r = await runNews(ctx);
    assert.equal(r.stats.queue.created, 1);
    await ctx.newsHealth.flush({ now: NOW, lastRun: { status: 'ok' }, documents: { count: 1 } });
  });
  const doc = [...store.values()].find((d) => d._type === 'newsArticle');
  assert.match(doc._id, /^queue[.]a_[0-9a-f]{16}$/);
  assert.equal(doc.status, 'pending_review');
  const mutations = requests.filter((r) => r.path.endsWith('/mutate/production'));
  assert.ok(mutations.length >= 2, 'the import, then the state document');
  for (const m of mutations) {
    assert.equal(m.auth, `Bearer ${WRITE}`);
    assert.equal(m.tag, 'fundsae.news.import');
    for (const mutation of m.body.mutations) assert.doesNotThrow(() => assertImporterMutation(mutation));
  }
  const reads = requests.filter((r) => r.path.endsWith('/query/production'));
  assert.ok(reads.every((r) => r.perspective === 'raw' && /^fundsae[.]news[.]/.test(r.tag)));
  const state = store.get('newsAggregatorState');
  assert.deepEqual(state.sources.map((s) => [s._key, s.id, s.status]), [['wire-a', 'wire-a', 'ok']]);
  assert.equal(state.lastRun.status, 'ok');
  assert.ok(!output.includes(WRITE) && !output.includes(READ), 'no token in any log line');
});

test('re-running sends no second create and patches an editor\'s open draft as well', async () => {
  const [doc] = [...store.values()].filter((d) => d._type === 'newsArticle');
  store.set(`drafts.${doc._id}`, { ...doc, _id: `drafts.${doc._id}`, headline: 'Editor is working on this' });
  requests.length = 0;
  feeds.set('/feeds/wire-e.xml', { status: 200, body: rss([{ title: 'Mubadala anchors $250 million Dubai build-to-rent fund', link: 'https://e.example.net/btr' }]) });
  const review = importerQueue();
  const r = await runNews(makeCtx(review, { now: new Date(NOW.getTime() + 3_600_000), sources: [source('wire-a'), source('wire-e')] }));
  assert.equal(r.stats.queue.created, 0);
  assert.equal(r.stats.attached, 1);
  const sent = requests.filter((q) => q.path.endsWith('/mutate/production')).flatMap((q) => q.body.mutations);
  assert.equal(sent.filter((m) => m.createIfNotExists).length, 0);
  assert.deepEqual(sent.filter((m) => m.patch).map((m) => m.patch.id), [doc._id, `drafts.${doc._id}`]);
  assert.equal(store.get(`drafts.${doc._id}`).headline, 'Editor is working on this', 'the editor\'s draft keeps its edits');
  assert.equal(store.get(`drafts.${doc._id}`).otherSources.length, 1, 'and gets the attached outlet too');
});

test('large writes go in transactions of at most 100, and a refused mutation sends nothing', async () => {
  reset();
  const review = importerQueue();
  const article = (i) => ({
    articleId: `a_${i.toString(16).padStart(16, '0')}`, storyId: `s_${i}`, title: `Story number ${i} about a fund`, sourceId: 'wire-a', sourceName: 'Source wire-a',
    originalUrl: `https://news.example.com/${i}`, canonicalUrl: `https://news.example.com/${i}`, publishedAt: NOW.toISOString(), category: 'world', topic: 'private-equity', topics: [], summary: ''
  });
  const cls = { capitalTypes: [], assetClasses: [], geography: [], transactionType: null, confidence: 0, needsReview: true, reasons: [], explanation: '', priority: 0, method: 'rules' };
  const mutations = Array.from({ length: 250 }, (_, i) => createMutation(newReviewDoc(article(i + 1), cls, { now: NOW })));
  assert.deepEqual(await review.commit(mutations), { created: 250, patched: 0, deleted: 0 });
  assert.deepEqual(requests.filter((r) => r.path.endsWith('/mutate/production')).map((r) => r.body.mutations.length), [100, 100, 50]);
  requests.length = 0;
  await assert.rejects(review.commit([...mutations.slice(0, 3), { patch: { id: mutations[0].createIfNotExists._id, set: { status: 'published' } } }]), ImporterMutationError);
  assert.equal(requests.length, 0, 'nothing reached Sanity');
});

test('the publisher reads with the read token, never writes, and keeps only approved stories', async () => {
  reset();
  feeds.set('/feeds/wire-a.xml', { status: 200, body: rss([MUBADALA]) });
  await runNews(makeCtx(importerQueue()));
  const [doc] = [...store.values()].filter((d) => d._type === 'newsArticle');
  const set = { status: 'published', publishedAt: NOW.toISOString(), publishedById: 'pApprover01', firstPublishedAt: NOW.toISOString(), extraStudioField: 'dropped' };
  set.approval = { approvedById: 'pApprover01', approvedAt: NOW.toISOString(), contentHash: approvalHash({ ...doc, ...set }) };
  Object.assign(store.get(doc._id), set);
  requests.length = 0;
  const review = publisherQueue();
  const result = await publishApprovedNews(makeCtx(review), { allowDrop: true });
  assert.equal(result.stories, 1);
  assert.ok(requests.length > 0 && requests.every((r) => r.auth === `Bearer ${READ}` && r.path.endsWith('/query/production')), 'reads only, with the read token');
  await assert.rejects(review.commit([pruneMutation({ now: NOW, pendingTtlDays: 30, rejectedTtlDays: 45 })]), /SANITY_WRITE_TOKEN is not set/);
  assert.equal((await review.listPublishedCandidates(NOW))[0].extraStudioField, undefined, 'unknown fields never leave the mapping');
  assert.deepEqual(await review.findByStoryIds([doc.storyId, 's_missing']), [{ _id: doc._id, storyId: doc.storyId, status: 'published' }]);
  assert.equal(await review.count(), store.size);
});

test('Sanity refusals give clear messages without echoing a token', async () => {
  const wrong = createSanityNewsReview(sanityConfigFromEnv({ SANITY_PROJECT_ID: 'ab12cd34', SANITY_READ_TOKEN: 'skWRONGtoken' }), { http: httpOpts() });
  await assert.rejects(wrong.loadRecent(NOW), (err) => /refused the read token/.test(err.message) && !err.message.includes('skWRONG'));
  failNextMutate = 409;
  const review = importerQueue();
  await assert.rejects(review.commit([pruneMutation({ now: NOW, pendingTtlDays: 30, rejectedTtlDays: 45 })]), /conflict/);
  assert.equal(failNextMutate, null, 'the refusal came from Sanity');
});

test('source health round-trips through the state document; jobs health stays out', async () => {
  reset();
  const review = importerQueue();
  const health = createSanityNewsHealth(review);
  assert.deepEqual(await health.load(), { sources: {} });
  health.save({ sources: { 'wire-a': { status: 'error', lastError: 'HTTP 500', consecutiveFailures: 2 }, 'jobs:board': { status: 'ok' } } });
  await health.flush({ now: NOW, lastRun: { status: 'partial' } });
  const fresh = createSanityNewsHealth(importerQueue());
  assert.deepEqual(await fresh.load(), { sources: { 'wire-a': { status: 'error', lastError: 'HTTP 500', consecutiveFailures: 2 } } });
  assert.equal(store.get('newsAggregatorState').updatedAt, NOW.toISOString());
});

test('the factory builds the Sanity queue in live mode only, and the mapping keeps known fields', () => {
  const live = { settings: { userAgent: 'test', news: { review: { store: 'sanity' } } }, demo: false };
  assert.equal(createNewsReviewRepository(live, null, { env: { SANITY_PROJECT_ID: 'ab12cd34', SANITY_READ_TOKEN: READ } }).kind, 'sanity');
  assert.throws(() => createNewsReviewRepository({ ...live, demo: true }, null, { env: { SANITY_PROJECT_ID: 'ab12cd34' } }), /Demo mode uses the file queue/);
  assert.throws(() => createNewsReviewRepository(live, null, { env: {} }), /SANITY_PROJECT_ID is not set/);
  assert.deepEqual(fromSanityNewsDoc({ _id: 'queue.a_1', headline: 'H', secret: 'x', summary: null }), { _id: 'queue.a_1', headline: 'H' });
});
