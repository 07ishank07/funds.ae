// The news pipeline against a local mock RSS server and a file review queue, in live mode:
// new stories enter as pending, duplicates and rewrites never create a second story,
// re-imports never touch editors' work, failing sources never stop the run, every write
// the importer makes passes the mutation guard, and the publisher's safety stop holds.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(tmpdir(), 'fundsae-newspipe-'));
process.env.FUNDSAE_ALLOW_PRIVATE_URLS = '1';
process.env.FUNDSAE_API_DIR = path.join(tmp, 'api');

const { loadAll, withNewsDefaults } = await import('../src/config.js');
const { runNews } = await import('../src/pipeline/news.js');
const { publishApprovedNews } = await import('../src/pipeline/publish.js');
const { createFileNewsReview, createNewsReviewRepository } = await import('../src/repositories/newsReview.js');
const { JsonStore } = await import('../src/store/jsonStore.js');
const { assertImporterMutation } = await import('../src/news/importerMutations.js');
const { applyDemoDecisions } = await import('../src/news/demoDecisions.js');
const { selectPublic } = await import('../src/news/publicFilter.js');
const { approvalHash } = await import('../src/news/workflow.js');

const base = loadAll();
const NOW = new Date('2026-10-26T08:00:00Z');
const HOUR = 3_600_000;

/* ------------------------------- mock RSS server ------------------------------- */

const feeds = new Map(); // path -> { status, body }
const requests = [];
let server;
let origin;
before(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url);
    const feed = feeds.get(req.url) || { status: 404, body: 'not found' };
    res.writeHead(feed.status, { 'content-type': 'application/rss+xml' });
    res.end(feed.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${items
  .map((i) => `<item><title>${esc(i.title)}</title><link>${esc(i.link)}</link><guid>${esc(i.guid || i.link)}</guid>` +
    `<pubDate>${new Date(i.date || '2026-10-25T06:00:00Z').toUTCString()}</pubDate><description>${esc(i.excerpt || '')}</description></item>`)
  .join('')}</channel></rss>`;
const serve = (name, items, status = 200) => feeds.set(`/${name}.xml`, { status, body: Array.isArray(items) ? rss(items) : items });

const source = (id, extra = {}) => withNewsDefaults({
  id, name: `Source ${id}`, homepage: 'https://example.com', type: 'rss', url: `${origin}/${id}.xml`, enabled: true,
  region: 'uae', focus: 'private-markets', priority: 2, tier: 'L2', licenseStatus: 'wire', ...extra
});

function makeCtx({ sources, review, now = NOW, health } = {}) {
  const settings = structuredClone(base.settings);
  settings.mode = 'live';
  settings.http = { ...settings.http, retries: 0, retryBaseDelayMs: 1, timeoutMs: 3000 };
  settings.news.checkLinks = false;
  let state = health || { sources: {} };
  return {
    settings, demo: false, now, taxonomy: base.taxonomy, newsTaxonomy: base.newsTaxonomy,
    newsSources: sources.filter((s) => s.enabled !== false), allNewsSources: sources, review,
    newsHealth: { load: () => state, save: (s) => { state = s; } },
    health: () => state
  };
}

/** A file queue that records every mutation the importer sends (and still enforces the guard). */
function recordingQueue(name, { drafts = new Set(), countOverride } = {}) {
  const repo = createFileNewsReview(new JsonStore(path.join(tmp, name)), { editorialWrites: true });
  const sent = [];
  return {
    ...repo,
    sent,
    async existingDraftIds(ids) { return new Set(ids.filter((id) => drafts.has(id))); },
    async count() { return countOverride ?? repo.count(); },
    async commit(mutations) {
      sent.push(...structuredClone(mutations));
      // The file queue has no drafts: drop the draft copies after recording them.
      return repo.commit(mutations.filter((m) => !String(m.patch?.id || '').startsWith('drafts.')));
    }
  };
}

const MUBADALA = {
  title: 'Mubadala backs $250 million Dubai build-to-rent fund',
  link: 'https://news.example.com/mubadala-btr',
  excerpt: 'Abu Dhabi sovereign investor Mubadala is the anchor investor in a $250 million build-to-rent fund in Dubai.'
};

/* ------------------------------------ tests ------------------------------------ */

test('a new RSS article enters the review queue as pending_review, classified, and not public', async () => {
  serve('wire-a', [MUBADALA]);
  const review = recordingQueue('q-new');
  const ctx = makeCtx({ sources: [source('wire-a')], review });
  const result = await runNews(ctx);
  assert.equal(result.stats.queue.created, 1);
  const [doc] = await review.loadRecent(new Date(0));
  assert.equal(doc.status, 'pending_review');
  assert.equal(doc.originalUrl, MUBADALA.link);
  assert.equal(doc.sourceName, 'Source wire-a');
  assert.deepEqual(doc.capitalTypes.map((r) => r._key), ['sovereign-wealth']);
  assert.deepEqual(doc.assetClasses.map((r) => r._key), ['residential-multifamily']);
  assert.deepEqual(doc.geography, ['uae']);
  assert.equal(doc.classification.needsReview, false);
  assert.deepEqual(await review.listPublishedCandidates(NOW), [], 'nothing is published by the importer');
  for (const m of review.sent) assert.doesNotThrow(() => assertImporterMutation(m));
});

test('duplicates, URL variants, reused guids and rewrites never create a second story', async () => {
  serve('wire-a', [MUBADALA]);
  serve('wire-b', [
    { ...MUBADALA, link: `${MUBADALA.link}?utm_source=rss&utm_medium=feed`, guid: 'b-1' },
    { title: 'Mubadala commits $250 million to Dubai build-to-rent fund', link: 'https://other.example.org/mubadala-250m', excerpt: 'A rewrite.', date: '2026-10-25T09:00:00Z' }
  ]);
  serve('wire-c', [{ title: 'Unrelated headline about Japanese robotics exports', link: 'https://c.example.com/x', guid: 'same-guid' }]);
  const review = recordingQueue('q-dupes');
  const ctx = makeCtx({ sources: [source('wire-a'), source('wire-b', { priority: 3 })], review });
  await runNews(ctx);
  let docs = await review.loadRecent(new Date(0));
  assert.equal(docs.length, 1, 'one story for the original, its tracking-URL copy and the rewrite');
  assert.equal(docs[0].sourceId, 'wire-a', 'the more authoritative source leads');
  assert.deepEqual(docs[0].otherSources.map((o) => o.sourceId), ['wire-b']);

  // Same feeds again, plus the lead's guid reused with a new URL: nothing new is created.
  serve('wire-a', [MUBADALA, { ...MUBADALA, link: 'https://news.example.com/mubadala-btr-updated', guid: MUBADALA.link }]);
  const again = await runNews(makeCtx({ sources: [source('wire-a'), source('wire-b', { priority: 3 })], review, now: new Date(NOW.getTime() + HOUR) }));
  assert.equal(again.stats.queue.created, 0);
  assert.equal(review.sent.filter((m) => m.createIfNotExists).length, 1, 'a single create across both runs');
  docs = await review.loadRecent(new Date(0));
  assert.equal(docs.length, 1);
  assert.equal(docs[0].otherSources.length, 1, 'the rewrite is not attached twice');
});

test('a later report from another outlet is attached to the queued story, not queued again', async () => {
  serve('wire-a', [MUBADALA]);
  const review = recordingQueue('q-attach');
  await runNews(makeCtx({ sources: [source('wire-a')], review }));
  serve('wire-d', [{ title: 'Mubadala anchors $250 million Dubai build-to-rent fund', link: 'https://d.example.net/btr', date: '2026-10-25T12:00:00Z' }]);
  const later = new Date(NOW.getTime() + 2 * HOUR);
  const r = await runNews(makeCtx({ sources: [source('wire-a'), source('wire-d', { priority: 1 })], review, now: later }));
  assert.equal(r.stats.attached, 1);
  const [doc] = await review.loadRecent(new Date(0));
  assert.equal(doc.sourceId, 'wire-a', 'the lead never changes once a story is queued');
  assert.equal(doc.otherSources[0].sourceId, 'wire-d');
  assert.equal(doc.otherSources[0].attachedAt, later.toISOString());
});

test('re-importing never overwrites an editor\'s decision or edits', async () => {
  serve('wire-a', [MUBADALA]);
  const review = recordingQueue('q-editor');
  await runNews(makeCtx({ sources: [source('wire-a')], review }));
  const [doc] = await review.loadRecent(new Date(0));
  const edited = {
    headline: 'Mubadala anchors Dubai build-to-rent fund', summary: 'Our own summary of the Mubadala build-to-rent commitment in Dubai.',
    summarySource: 'editor', capitalTypes: [{ _type: 'reference', _ref: 'capitalType-sovereign-wealth', _key: 'sovereign-wealth', _weak: true }],
    status: 'published', publishedAt: NOW.toISOString(), publishedById: 'pApprover01'
  };
  const decided = { ...doc, ...edited };
  edited.approval = { approvedById: 'pApprover01', approvedAt: NOW.toISOString(), contentHash: approvalHash(decided) };
  await review.decide(doc._id, edited);

  serve('wire-a', [{ ...MUBADALA, title: 'Mubadala backs Dubai rental housing fund (updated)', excerpt: 'A changed excerpt from the feed.' }]);
  const later = new Date(NOW.getTime() + 13 * HOUR);
  await runNews(makeCtx({ sources: [source('wire-a')], review, now: later }));
  const [after] = await review.loadRecent(new Date(0));
  for (const field of ['headline', 'summary', 'summarySource', 'capitalTypes', 'status', 'publishedAt', 'approval', 'originalHeadline', 'excerpt']) {
    assert.deepEqual(after[field], { ...doc, ...edited }[field], `${field} unchanged`);
  }
  assert.equal(after.lastSeenAt, later.toISOString(), 'only the ingest-owned "last seen" moved');
  const patches = review.sent.filter((m) => m.patch);
  for (const p of patches) for (const op of ['set', 'setIfMissing']) for (const f of Object.keys(p.patch[op] || {})) {
    assert.ok(['lastSeenAt', 'excerpt', 'sourceImageUrl', 'otherSources'].includes(f), f);
  }
});

test('an open draft gets the same ingest patch, so publishing the draft cannot undo it', async () => {
  serve('wire-a', [MUBADALA]);
  const first = recordingQueue('q-draft');
  await runNews(makeCtx({ sources: [source('wire-a')], review: first }));
  const [doc] = await first.loadRecent(new Date(0));
  const review = recordingQueue('q-draft', { drafts: new Set([doc._id]) });
  serve('wire-e', [{ title: 'Mubadala anchors $250 million Dubai build-to-rent fund', link: 'https://e.example.net/btr', date: '2026-10-25T12:00:00Z' }]);
  await runNews(makeCtx({ sources: [source('wire-a'), source('wire-e')], review, now: new Date(NOW.getTime() + HOUR) }));
  const ids = review.sent.filter((m) => m.patch).map((m) => m.patch.id);
  assert.deepEqual(ids, [doc._id, `drafts.${doc._id}`]);
  const [published, draft] = review.sent.filter((m) => m.patch).map((m) => m.patch.set);
  assert.deepEqual(published, draft, 'identical patch on both copies');
});

test('failing, missing, broken and disabled sources never stop the healthy ones', async () => {
  serve('ok-feed', [MUBADALA]);
  serve('server-error', 'boom', 500);
  serve('broken-xml', '<html><body>This page moved</body></html>', 200);
  feeds.delete('/gone.xml');
  const review = recordingQueue('q-failing');
  requests.length = 0;
  const sources = [source('ok-feed'), source('server-error'), source('gone'), source('broken-xml'), source('switched-off', { enabled: false })];
  const ctx = makeCtx({ sources, review });
  const result = await runNews(ctx);
  assert.equal(result.totalSources, 4, 'disabled sources are not part of the run');
  assert.equal(result.failedSources, 3);
  assert.equal(result.stats.queue.created, 1, 'the healthy source still queued its story');
  assert.ok(!requests.some((r) => r.includes('switched-off')), 'a disabled source is never requested');
  const health = ctx.health().sources;
  assert.equal(health['ok-feed'].status, 'ok');
  assert.equal(health.gone.status, 'not-found');
  assert.ok(health.gone.pausedUntil, 'a 404 pauses the source until someone fixes its URL');
  assert.equal(health['server-error'].status, 'error');
  assert.match(health['server-error'].lastError, /500/);
});

test('when every source fails nothing is written, and an unreadable queue stops the run before any fetch', async () => {
  serve('server-error', 'boom', 500);
  const review = recordingQueue('q-allfail');
  const result = await runNews(makeCtx({ sources: [source('server-error')], review }));
  assert.equal(result.failedSources, result.totalSources);
  assert.equal(result.stats.queue.created, 0);

  requests.length = 0;
  const broken = { ...recordingQueue('q-broken'), loadRecent: async () => { throw new Error('Sanity is unreachable'); } };
  await assert.rejects(runNews(makeCtx({ sources: [source('ok-feed')], review: broken })), /unreachable/);
  assert.equal(requests.length, 0, 'no source was fetched');
  assert.equal(broken.sent.length, 0, 'nothing was written');
});

test('the document budget stops new stories but keeps the most relevant', async () => {
  serve('wire-a', [MUBADALA]);
  const review = recordingQueue('q-budget', { countOverride: 9500 });
  const r = await runNews(makeCtx({ sources: [source('wire-a')], review }));
  assert.equal(r.stats.queue.created, 0);
  assert.equal(review.sent.filter((m) => m.createIfNotExists).length, 0);
});

test('stale pending stories are pruned during a run; decided ones are kept', async () => {
  serve('wire-a', [MUBADALA]);
  const review = recordingQueue('q-prune');
  await runNews(makeCtx({ sources: [source('wire-a')], review }));
  serve('wire-a', []);
  const r = await runNews(makeCtx({ sources: [source('wire-a')], review, now: new Date(NOW.getTime() + 40 * 24 * HOUR) }));
  assert.equal(r.stats.pruned, 1);
  assert.equal(await review.count(), 0);
});

/** Publishes MUBADALA through the file queue the way an approver would, and returns the queue and its story. */
async function publishedStory(name, sources = [source('wire-a')]) {
  serve('wire-a', [MUBADALA]);
  const review = recordingQueue(name);
  await runNews(makeCtx({ sources, review }));
  const [doc] = await review.loadRecent(new Date(0));
  const set = { status: 'published', publishedAt: NOW.toISOString(), publishedById: 'pApprover01', firstPublishedAt: NOW.toISOString() };
  set.approval = { approvedById: 'pApprover01', approvedAt: NOW.toISOString(), contentHash: approvalHash({ ...doc, ...set }) };
  await review.decide(doc._id, set);
  return { review, doc: { ...doc, ...set } };
}

const writeLiveNews = (ids) => {
  mkdirSync(path.join(tmp, 'api'), { recursive: true });
  writeFileSync(path.join(tmp, 'api', 'news.json'), JSON.stringify({ count: ids.length, items: ids.map((id) => ({ id })) }));
};
const liveCount = () => JSON.parse(readFileSync(path.join(tmp, 'api', 'news.json'), 'utf8')).count;
const approverCtx = (ctx) => { ctx.settings.news.review.approverIds = ['pApprover01']; return ctx; };

test('the publisher refuses when live stories vanish from the queue (wrong dataset, revoked token)', async () => {
  writeLiveNews(['s_aaaaaaaaaaaaaa', 's_bbbbbbbbbbbbbb', 's_cccccccccccccc']);
  const ctx = approverCtx(makeCtx({ sources: [source('wire-a')], review: recordingQueue('q-empty') }));
  const refused = await publishApprovedNews(ctx);
  assert.deepEqual(refused, { refused: true, previous: 3, missing: 3 });
  assert.equal(liveCount(), 3, 'the old file stays live');
  const allowed = await publishApprovedNews(ctx, { allowDrop: true });
  assert.equal(allowed.stories, 0);
  assert.equal(liveCount(), 0);
});

test('stories an editor takes down leave the site even when most live stories go at once', async () => {
  const { review, doc } = await publishedStory('q-takedown');
  writeLiveNews([doc.storyId]);
  const ctx = approverCtx(makeCtx({ sources: [source('wire-a')], review }));
  assert.equal((await publishApprovedNews(ctx)).stories, 1, 'published while approved');
  await review.decide(doc._id, { status: 'archived' });
  const result = await publishApprovedNews(ctx);
  assert.equal(result.refused, undefined, 'an explained drop is not refused');
  assert.equal(liveCount(), 0, 'the archived story is gone from the site');
});

test('other outlets appear only when their own source is cleared; a cleared source leads a new story', async () => {
  serve('wire-a', [MUBADALA]);
  serve('pending-outlet', [{ title: 'Mubadala commits $250 million to Dubai build-to-rent fund', link: 'https://p.example.org/btr', date: '2026-10-25T05:00:00Z' }]);
  const sources = [source('wire-a', { priority: 3 }), source('pending-outlet', { priority: 1, licenseStatus: 'pending_review' })];
  const review = recordingQueue('q-outlets');
  await runNews(makeCtx({ sources, review }));
  const [doc] = await review.loadRecent(new Date(0));
  assert.equal(doc.sourceId, 'wire-a', 'the cleared source leads although the other has a better priority and reported first');
  assert.deepEqual(doc.otherSources.map((o) => o.sourceId), ['pending-outlet']);
  const set = { status: 'published', publishedAt: NOW.toISOString(), firstPublishedAt: NOW.toISOString() };
  set.approval = { approvedById: 'pApprover01', approvedAt: NOW.toISOString(), contentHash: approvalHash({ ...doc, ...set }) };
  await review.decide(doc._id, set);
  writeLiveNews([]);
  const ctx = approverCtx(makeCtx({ sources, review }));
  await publishApprovedNews(ctx);
  const story = JSON.parse(readFileSync(path.join(tmp, 'api', 'news.json'), 'utf8')).items[0];
  assert.deepEqual(story.sources.map((s) => s.sourceId), ['wire-a'], "the unreviewed outlet's headline and link are not published");
  assert.ok(!JSON.stringify(story).includes('p.example.org'));
});

test("a summary that is the publisher's excerpt is held once the source withdraws excerpt permission", async () => {
  const { review, doc } = await publishedStory('q-excerpt');
  writeLiveNews([doc.storyId]);
  const ctx = approverCtx(makeCtx({ sources: [source('wire-a', { allowExcerpt: false })], review }));
  await publishApprovedNews(ctx, { allowDrop: true });
  assert.equal(liveCount(), 0);
});

test('a missing feed image is filled in only while the story is pending', async () => {
  const { review, doc } = await publishedStory('q-image', [source('wire-a', { allowImages: true })]);
  feeds.set('/wire-a.xml', { status: 200, body: rss([MUBADALA]).replace('</item>', '<enclosure url="https://img.example.com/a.jpg" type="image/jpeg"/></item>') });
  await runNews(makeCtx({ sources: [source('wire-a', { allowImages: true })], review, now: new Date(NOW.getTime() + 13 * HOUR) }));
  const [after] = await review.loadRecent(new Date(0));
  assert.equal(after.sourceImageUrl, undefined, 'no image appears on an approved story without re-approval');
  assert.equal(after.status, doc.status);

  // Control: the same feed fills in the image while a story is still pending.
  const pending = recordingQueue('q-image-pending');
  serve('wire-a', [MUBADALA]);
  await runNews(makeCtx({ sources: [source('wire-a', { allowImages: true })], review: pending }));
  feeds.set('/wire-a.xml', { status: 200, body: rss([MUBADALA]).replace('</item>', '<enclosure url="https://img.example.com/a.jpg" type="image/jpeg"/></item>') });
  await runNews(makeCtx({ sources: [source('wire-a', { allowImages: true })], review: pending, now: new Date(NOW.getTime() + 13 * HOUR) }));
  const [filled] = await pending.loadRecent(new Date(0));
  assert.equal(filled.sourceImageUrl, 'https://img.example.com/a.jpg');
});

test('the importer can never store more than 280 characters of publisher text', () => {
  assert.throws(() => assertImporterMutation({ patch: { id: 'queue.a_3f2a9c0d1e2b4a5f', setIfMissing: { excerpt: 'x'.repeat(281) } } }), /at most 280/);
});

test('live mode refuses a file queue, and demo decisions refuse to run outside demo mode', async () => {
  const cfg = { settings: { news: { review: { store: 'file' } } }, demo: false };
  const store = new JsonStore(path.join(tmp, 'q-live'));
  assert.throws(() => createNewsReviewRepository(cfg, store), /Live mode keeps the news review queue in Sanity/);
  process.env.FUNDSAE_ALLOW_FILE_QUEUE = '1';
  try {
    assert.equal(createNewsReviewRepository(cfg, store).kind, 'file');
  } finally {
    delete process.env.FUNDSAE_ALLOW_FILE_QUEUE;
  }
  assert.equal(typeof createNewsReviewRepository({ ...cfg, demo: true }, store).decide, 'function', 'demo can record demo decisions');
  await assert.rejects(applyDemoDecisions({ demo: false, review: {} }), /only applied in demo mode/);
  assert.ok(!existsSync(path.join(tmp, 'q-live', 'news-review.json')), 'nothing written');
});

test('a published story from a source without a cleared licence stays off the site', async () => {
  serve('wire-a', [MUBADALA]);
  const review = recordingQueue('q-licence');
  await runNews(makeCtx({ sources: [source('wire-a', { licenseStatus: 'pending_review' })], review }));
  const [doc] = await review.loadRecent(new Date(0));
  const decided = { ...doc, status: 'published', publishedAt: NOW.toISOString() };
  const approval = { approvedById: 'pApprover01', approvedAt: NOW.toISOString(), contentHash: approvalHash(decided) };
  const { held } = selectPublic([{ ...decided, approval }], { now: NOW, approverIds: ['pApprover01'], licenseOf: () => 'pending_review' });
  assert.match(held[0].reasons.join(' '), /licence status is "pending_review"/);
});
