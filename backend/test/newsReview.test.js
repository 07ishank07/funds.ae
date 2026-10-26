// The review queue's safety rails: the shape of new stories, the importer mutation
// guard, pruning, the file queue, and the public filter that decides what reaches the site.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { newReviewDoc, otherSourceEntry, reviewIdFor, isReviewId, idsFromRefs, CAPITAL_REF_PREFIX } = await import('../src/news/reviewDocs.js');
const {
  assertImporterMutation, createMutation, ingestPatchMutations, pruneMutation, pruneMatches, pruneParams, stateMutation,
  ImporterMutationError, PRUNE_QUERY
} = await import('../src/news/importerMutations.js');
const { holdReasons, selectPublic, licenseLookup } = await import('../src/news/publicFilter.js');
const { createFileNewsReview } = await import('../src/repositories/newsReview.js');
const { JsonStore } = await import('../src/store/jsonStore.js');
const { planAction } = await import('../../studio/schemaTypes/newsWorkflow.js');
const { NEWS_INGEST_FIELDS, NEWS_PREFILL_FIELDS, NEWS_WORKFLOW_FIELDS } = await import('../src/news/rules.js');

const tmp = mkdtempSync(path.join(tmpdir(), 'fundsae-review-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const NOW = new Date('2026-10-26T08:00:00Z');
const APPROVER = 'pApprover01';
const article = (extra = {}) => ({
  articleId: 'a_3f2a9c0d1e2b4a5f',
  storyId: 's_9a8b7c6d5e4f30',
  title: 'ADIA and CPPIB buy Abu Dhabi logistics park',
  sourceId: 'example-wire',
  sourceName: 'Example Wire',
  originalUrl: 'https://example.com/adia-cppib?utm_source=rss',
  canonicalUrl: 'https://example.com/adia-cppib',
  guid: 'example-123',
  publishedAt: '2026-10-25T06:00:00.000Z',
  category: 'uae',
  topic: 'commercial-real-estate',
  topics: ['commercial-real-estate', 'sovereign-wealth'],
  uaeScore: 7,
  relevanceScore: 23,
  summary: 'Two institutional investors have bought a logistics park in Abu Dhabi, adding to a run of GCC industrial deals.',
  imageUrl: null,
  ...extra
});
const cls = {
  capitalTypes: ['sovereign-wealth', 'pension-funds'], assetClasses: ['industrial-logistics'], geography: ['uae'],
  transactionType: 'acquisition', confidence: 1, needsReview: false, reasons: [], explanation: 'Capital: sovereign-wealth (adia)',
  priority: 5, method: 'rules'
};
const pendingDoc = (extra = {}) => ({ ...newReviewDoc(article(), cls, { now: NOW }), ...extra });
const ctx = { now: NOW, approverIds: [APPROVER], licenseOf: () => 'wire' };

/** A story published the way the Studio does it: planAction, then apply set/unset. */
function publishedDoc(extra = {}, actionCtx = {}) {
  const doc = pendingDoc(extra);
  const plan = planAction('approvePublish', doc, { userId: APPROVER, userName: 'Ada', approverIds: [APPROVER], now: new Date('2026-10-26T07:00:00Z'), sourceLicenseStatus: 'wire', ...actionCtx });
  assert.equal(plan.ok, true, plan.reasons.join(' '));
  const next = { ...doc, ...plan.set };
  for (const f of plan.unset) delete next[f];
  return next;
}

/* --------------------------------- new stories --------------------------------- */

test('a new story enters as pending_review with ingest fields and pre-filled editorial fields', () => {
  const doc = pendingDoc();
  assert.equal(doc._id, 'queue.a_3f2a9c0d1e2b4a5f');
  assert.equal(doc._type, 'newsArticle');
  assert.equal(doc.status, 'pending_review');
  assert.equal(doc.originalHeadline, article().title);
  assert.equal(doc.originalUrl, article().originalUrl, 'provenance: the publisher link is kept as given');
  assert.equal(doc.sourcePublishedAt, article().publishedAt);
  assert.equal(doc.importedAt, NOW.toISOString());
  assert.equal(doc.excerpt, article().summary);
  assert.equal(doc.summary, article().summary);
  assert.equal(doc.summarySource, 'excerpt');
  assert.equal(doc.slug.current, 'adia-and-cppib-buy-abu-dhabi-logistics-park-3f2a');
  assert.deepEqual(idsFromRefs(doc.capitalTypes, CAPITAL_REF_PREFIX), ['sovereign-wealth', 'pension-funds']);
  assert.ok(doc.capitalTypes.every((r) => r._weak === true && r._key), 'weak, keyed references');
  assert.equal(doc.source._ref, 'newsSource-example-wire');
  assert.deepEqual(doc.otherSources, []);
  assert.equal(doc.classification.confidence, 1);
  assert.deepEqual(doc.classification.suggestedAssetClasses, ['industrial-logistics']);
  for (const field of NEWS_WORKFLOW_FIELDS.filter((f) => !['status', 'statusChangedAt'].includes(f))) assert.equal(doc[field], undefined, field);
  assert.equal('sourceImageUrl' in doc, false, 'empty values are left out');
  assert.doesNotThrow(() => createMutation(doc));
});

test('a story without an excerpt starts with no summary, so an editor must write one', () => {
  const doc = newReviewDoc(article({ summary: '' }), { ...cls, capitalTypes: [], assetClasses: [] }, { now: NOW });
  assert.equal(doc.summary, undefined);
  assert.equal(doc.summarySource, undefined);
  assert.deepEqual(doc.capitalTypes, []);
});

test('queue ids are private dotted ids and never drafts', () => {
  assert.equal(reviewIdFor('a_0123456789abcdef'), 'queue.a_0123456789abcdef');
  assert.ok(isReviewId('queue.a_0123456789abcdef'));
  for (const id of ['drafts.queue.a_0123456789abcdef', 'a_0123456789abcdef', 'queue.a_xyz', 'queue.a_0123456789abcdef.x']) assert.ok(!isReviewId(id), id);
});

/* ------------------------------ the mutation guard ------------------------------ */

test('the importer may create pending stories, patch ingest fields, prune and save its state', () => {
  const doc = pendingDoc();
  assert.doesNotThrow(() => assertImporterMutation({ createIfNotExists: doc }));
  const patches = ingestPatchMutations(doc._id, { set: { lastSeenAt: NOW.toISOString(), otherSources: [] }, setIfMissing: { excerpt: 'x' } }, { hasDraft: true });
  assert.deepEqual(patches.map((p) => p.patch.id), [doc._id, `drafts.${doc._id}`], 'an open draft is patched too');
  assert.deepEqual(ingestPatchMutations(doc._id, {}, {}), []);
  assert.doesNotThrow(() => pruneMutation({ now: NOW, pendingTtlDays: 30, rejectedTtlDays: 45 }));
  assert.doesNotThrow(() => stateMutation({ updatedAt: NOW.toISOString(), sources: [], lastRun: {} }));
});

test('the importer can never publish, approve or edit what editors own', () => {
  const refused = (mutation, pattern) => assert.throws(() => assertImporterMutation(mutation), (err) => err instanceof ImporterMutationError && pattern.test(err.message));
  const doc = pendingDoc();
  refused({ createIfNotExists: { ...doc, status: 'published' } }, /must be pending_review/);
  refused({ createIfNotExists: { ...doc, status: 'approved' } }, /must be pending_review/);
  refused({ createIfNotExists: { ...doc, approval: { approvedById: APPROVER } } }, /may not write "approval"/);
  refused({ createIfNotExists: { ...doc, publishedAt: NOW.toISOString() } }, /may not write "publishedAt"/);
  refused({ createIfNotExists: { ...doc, featured: true } }, /may not write "featured"/);
  refused({ createIfNotExists: { ...doc, _id: 'a_3f2a9c0d1e2b4a5f' } }, /not a queue id/);
  refused({ createIfNotExists: { ...doc, _id: 'drafts.queue.a_3f2a9c0d1e2b4a5f' } }, /not a queue id/);
  refused({ createIfNotExists: { ...doc, _type: 'sponsorItem' } }, /type must be newsArticle/);
  for (const field of ['headline', 'summary', 'status', 'approval', 'publishedAt', 'capitalTypes', 'slug', 'rejectionReason']) {
    refused({ patch: { id: doc._id, set: { [field]: 'x' } } }, /may not change/);
  }
  refused({ patch: { id: doc._id, set: { 'approval.approvedById': APPROVER } } }, /may not change "approval"/);
  refused({ patch: { id: doc._id, unset: ['summary'] } }, /"unset" is not allowed/);
  refused({ patch: { id: doc._id, inc: { priority: 1 } } }, /"inc" is not allowed/);
  refused({ patch: { id: doc._id, insert: { after: 'otherSources[-1]', items: [] } } }, /"insert" is not allowed/);
  refused({ patch: { id: 'sponsor-1', set: { lastSeenAt: 'x' } } }, /cannot patch/);
  refused({ patch: { id: doc._id } }, /empty patch/);
  refused({ delete: { id: doc._id } }, /only allowed through the prune query/);
  refused({ delete: { query: '*[_type == "newsArticle"]', params: { pendingBefore: 'x', rejectedBefore: 'y' } } }, /prune query/);
  refused({ createOrReplace: { ...doc } }, /only the aggregator state/);
  refused({ createOrReplace: { _id: 'newsAggregatorState', _type: 'newsAggregatorState', headline: 'x' } }, /may not hold "headline"/);
  refused({ create: doc }, /"create" is not allowed/);
  refused({ createIfNotExists: doc, patch: {} }, /one operation/);
  for (const field of NEWS_INGEST_FIELDS) assert.ok(!NEWS_WORKFLOW_FIELDS.includes(field), `${field} is not a workflow field`);
  for (const field of NEWS_PREFILL_FIELDS) assert.ok(!NEWS_WORKFLOW_FIELDS.includes(field), `${field} is not a workflow field`);
});

test('pruning removes only stale pending and rejected stories', () => {
  const params = pruneParams({ now: NOW, pendingTtlDays: 30, rejectedTtlDays: 45 });
  const old = '2026-09-01T00:00:00.000Z';
  const recent = '2026-10-20T00:00:00.000Z';
  const doc = (extra) => ({ _id: 'queue.a_3f2a9c0d1e2b4a5f', _type: 'newsArticle', ...extra });
  assert.equal(pruneMatches(doc({ status: 'pending_review', lastSeenAt: old }), params), true);
  assert.equal(pruneMatches(doc({ _id: 'drafts.queue.a_3f2a9c0d1e2b4a5f', status: 'pending_review', lastSeenAt: old }), params), true, 'its draft goes too');
  assert.equal(pruneMatches(doc({ status: 'pending_review', lastSeenAt: recent }), params), false, 'still in a feed');
  assert.equal(pruneMatches(doc({ status: 'rejected', statusChangedAt: old, lastSeenAt: recent }), params), true);
  assert.equal(pruneMatches(doc({ status: 'rejected', statusChangedAt: recent }), params), false);
  for (const status of ['approved', 'published', 'archived']) assert.equal(pruneMatches(doc({ status, lastSeenAt: old, statusChangedAt: old }), params), false, status);
  assert.equal(pruneMatches({ _id: 'sponsor-1', _type: 'sponsorItem', status: 'pending_review', lastSeenAt: old }, params), false);
  assert.match(PRUNE_QUERY, /status == "pending_review"/);
  assert.doesNotMatch(PRUNE_QUERY, /approved|published|archived/, 'the server-side filter never names a decided status');
});

/* ---------------------------------- file queue ---------------------------------- */

test('the file queue creates each story once, patches only ingest fields and prunes', async () => {
  const repo = createFileNewsReview(new JsonStore(path.join(tmp, 'queue-1')));
  const doc = pendingDoc();
  assert.deepEqual(await repo.commit([createMutation(doc)]), { created: 1, patched: 0, deleted: 0 });
  assert.deepEqual(await repo.commit([createMutation({ ...doc, headline: 'Changed by a re-import' })]), { created: 0, patched: 0, deleted: 0 });
  await repo.commit(ingestPatchMutations(doc._id, { set: { lastSeenAt: '2026-10-27T00:00:00.000Z' }, setIfMissing: { excerpt: 'ignored' } }));
  const [stored] = await repo.loadRecent(new Date('2026-10-01T00:00:00Z'));
  assert.equal(stored.headline, doc.headline, 'createIfNotExists never overwrites');
  assert.equal(stored.lastSeenAt, '2026-10-27T00:00:00.000Z');
  assert.equal(stored.excerpt, doc.excerpt, 'setIfMissing keeps an existing excerpt');
  assert.equal(await repo.count(), 1);
  assert.equal(repo.decide, undefined, 'no editorial writes unless asked for');
  await assert.rejects(repo.commit([{ patch: { id: doc._id, set: { status: 'published' } } }]), ImporterMutationError);
  await assert.rejects(repo.commit([createMutation({ ...doc, _id: 'queue.a_ffffffffffffffff', articleId: 'a_ffffffffffffffff' }), { patch: { id: doc._id, set: { headline: 'x' } } }]), ImporterMutationError);
  assert.equal(await repo.count(), 1, 'a refused batch writes nothing');
  await repo.commit([stateMutation({ updatedAt: NOW.toISOString(), sources: [{ id: 'example-wire', status: 'ok' }] })]);
  assert.equal((await repo.loadState()).sources[0].status, 'ok');
  const later = new Date('2026-12-15T00:00:00Z');
  assert.deepEqual(await repo.commit([pruneMutation({ now: later, pendingTtlDays: 30, rejectedTtlDays: 45 })]), { created: 0, patched: 0, deleted: 1 });
});

test('only due, published stories are listed as candidates', async () => {
  const repo = createFileNewsReview(new JsonStore(path.join(tmp, 'queue-2')), { editorialWrites: true });
  const doc = pendingDoc();
  await repo.commit([createMutation(doc)]);
  assert.deepEqual(await repo.listPublishedCandidates(NOW), []);
  await repo.decide(doc._id, { status: 'published', publishedAt: '2026-10-26T10:00:00.000Z' });
  assert.deepEqual(await repo.listPublishedCandidates(NOW), [], 'scheduled for later');
  assert.equal((await repo.listPublishedCandidates(new Date('2026-10-26T11:00:00Z'))).length, 1);
});

/* --------------------------------- public filter --------------------------------- */

test('an approved, published, unchanged story from a cleared source is public', () => {
  assert.deepEqual(holdReasons(publishedDoc(), ctx), []);
});

test('pending, approved, rejected and archived stories are never public, even with forged fields', () => {
  const forged = publishedDoc();
  for (const status of ['pending_review', 'approved', 'rejected', 'archived']) {
    assert.deepEqual(holdReasons({ ...forged, status }, ctx), [`status is ${status}`], status);
  }
  assert.ok(holdReasons({ ...forged, _id: `drafts.${forged._id}` }, ctx).length, 'drafts are never public');
});

test('approval must come from a listed approver and match the content', () => {
  const doc = publishedDoc();
  assert.match(holdReasons(doc, { ...ctx, approverIds: [] }).join(' '), /no approvers are configured/);
  assert.match(holdReasons(doc, { ...ctx, approverIds: ['pSomeoneElse'] }).join(' '), /not a listed approver/);
  const { approval, ...unapproved } = doc;
  assert.match(holdReasons({ ...unapproved, status: 'published' }, ctx).join(' '), /no approval/);
  assert.match(holdReasons({ ...doc, headline: 'Edited after approval by someone else' }, ctx).join(' '), /changed since it was approved/);
  const forgedHash = { ...doc, approval: { ...doc.approval, approvedById: 'pImporterRobot' } };
  assert.match(holdReasons(forgedHash, ctx).join(' '), /not a listed approver/);
});

test('scheduled stories stay off the site until their time; uncleared licences never publish', () => {
  const plan = planAction('schedule', pendingDoc(), { userId: APPROVER, approverIds: [APPROVER], now: NOW, scheduleAt: '2026-10-26T10:00:00Z', sourceLicenseStatus: 'wire' });
  const scheduled = { ...pendingDoc(), ...plan.set };
  assert.deepEqual(holdReasons(scheduled, ctx), ['scheduled for 2026-10-26T10:00:00.000Z']);
  assert.deepEqual(holdReasons(scheduled, { ...ctx, now: new Date('2026-10-26T10:00:00Z') }), [], 'public once its time comes');
  const doc = publishedDoc();
  assert.match(holdReasons(doc, { ...ctx, licenseOf: () => 'pending_review' }).join(' '), /licence status is "pending_review"/);
  assert.match(holdReasons(doc, { ...ctx, licenseOf: () => undefined }).join(' '), /licence status is "unknown"/);
});

test('selectPublic splits stories and reports held ones by id only', () => {
  const good = publishedDoc();
  const bad = { ...publishedDoc(), _id: 'queue.a_0000000000000001', headline: 'Secret pending headline that must not leak' };
  const { stories, held } = selectPublic([good, bad, null], ctx);
  assert.deepEqual(stories.map((s) => s._id), [good._id]);
  assert.deepEqual(held.map((h) => h.id), ['queue.a_0000000000000001', '(no id)']);
  assert.ok(!JSON.stringify(held).includes('Secret pending headline'), 'held reports never carry headlines');
  assert.equal(licenseLookup([{ id: 'a', licenseStatus: 'wire' }])('a'), 'wire');
});

test('other outlets are recorded with their own link and attachment time', () => {
  const entry = otherSourceEntry(article({ articleId: 'a_1111111111111111', sourceId: 'gulf-news', sourceName: 'Gulf News' }), NOW);
  assert.equal(entry._key, 'a_1111111111111111');
  assert.equal(entry.attachedAt, NOW.toISOString());
  assert.equal(entry.url, article().originalUrl);
});
