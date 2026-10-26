// The news workflow actions (studio/schemaTypes/newsWorkflow.js): who may run which
// action from which status, what each one changes, and that approval is bound to the
// content. The Studio's document actions are thin wrappers around these functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { planAction, planSave, approvalHash, suggestSlug } = await import('../../studio/schemaTypes/newsWorkflow.js');
const { NEWS_ACTIONS } = await import('../../studio/schemaTypes/newsRules.js');
const backend = await import('../src/news/workflow.js');

const NOW = new Date('2026-10-26T08:00:00Z');
const APPROVER = 'pApprover01';
const EDITOR = 'pEditor0002';
const ctx = (extra = {}) => ({ userId: APPROVER, userName: 'Ada Approver', approverIds: [APPROVER], now: NOW, sourceLicenseStatus: 'wire', ...extra });

const story = (extra = {}) => ({
  _id: 'queue.a_3f2a9c0d1e2b4a5f',
  articleId: 'a_3f2a9c0d1e2b4a5f',
  status: 'pending_review',
  headline: 'ADIA and CPPIB buy Abu Dhabi logistics park',
  summary: 'Two institutional investors have bought a logistics park in Abu Dhabi, adding to a run of GCC industrial deals this year.',
  excerpt: 'Two institutional investors have bought a logistics park.',
  originalUrl: 'https://example.com/adia-cppib',
  sourceName: 'Example Wire',
  capitalTypes: [{ _ref: 'capitalType-sovereign-wealth' }, { _ref: 'capitalType-pension-funds' }],
  assetClasses: [{ _ref: 'assetClass-industrial-logistics' }],
  ...extra
});

/** Applies a plan the way the Studio does: set, then unset. */
const apply = (doc, plan) => {
  const next = { ...doc, ...plan.set };
  for (const field of plan.unset) delete next[field];
  return next;
};

test('every action is defined with a label, start statuses and a target status', () => {
  for (const [name, action] of Object.entries(NEWS_ACTIONS)) {
    assert.ok(action.label && action.from.length && action.to, name);
  }
});

test('approve stamps who approved, when, and a hash of the approved content', () => {
  const plan = planAction('approve', story(), ctx());
  assert.equal(plan.ok, true, plan.reasons.join(' '));
  assert.equal(plan.set.status, 'approved');
  assert.equal(plan.set.approval.approvedById, APPROVER);
  assert.equal(plan.set.approval.approvedByName, 'Ada Approver');
  assert.equal(plan.set.approval.approvedAt, NOW.toISOString());
  assert.equal(plan.set.slug.current, 'adia-and-cppib-buy-abu-dhabi-logistics-park-3f2a', 'a missing slug is suggested');
  const approved = apply(story(), plan);
  assert.equal(plan.set.approval.contentHash, approvalHash(approved));
  assert.equal(plan.set.approval.contentHash, backend.approvalHash(approved), 'the backend recomputes the same hash');
  assert.equal(approved.publishedAt, undefined, 'approving does not publish');
});

test('only listed approvers can approve, publish or schedule; an empty list blocks everyone', () => {
  for (const name of ['approve', 'approvePublish', 'schedule']) {
    const asEditor = planAction(name, story(), ctx({ userId: EDITOR, scheduleAt: '2026-10-27T08:00:00Z' }));
    assert.equal(asEditor.ok, false, `${name} by a non-approver`);
    assert.match(asEditor.reasons[0], /Only approvers/);
    const nobody = planAction(name, story(), ctx({ approverIds: [], scheduleAt: '2026-10-27T08:00:00Z' }));
    assert.equal(nobody.ok, false, `${name} with no approvers configured`);
    assert.match(nobody.reasons[0], /No approvers are set up/);
  }
  assert.equal(planAction('publish', story({ status: 'approved' }), ctx({ userId: null })).ok, false, 'not signed in');
});

test('any editor can take a story off the site or out of the queue', () => {
  const editor = ctx({ userId: EDITOR });
  assert.equal(planAction('reject', story(), { ...editor, reason: 'Not about private capital.' }).ok, true);
  assert.equal(planAction('unpublish', story({ status: 'published' }), editor).ok, true);
  assert.equal(planAction('archive', story({ status: 'published' }), editor).ok, true);
  assert.equal(planAction('returnToReview', story({ status: 'rejected' }), editor).ok, true);
});

test('actions are only offered from the right statuses', () => {
  assert.match(planAction('publish', story(), ctx()).reasons[0], /not available for a story that is Pending review/);
  assert.equal(planAction('unpublish', story({ status: 'approved' }), ctx()).ok, false);
  assert.equal(planAction('reject', story({ status: 'published' }), ctx({ reason: 'Wrong.' })).ok, false, 'a live story is unpublished or archived, not rejected');
  assert.equal(planAction('approve', story({ status: 'archived' }), ctx()).ok, false, 'archived stories go back to review first');
  assert.equal(planAction('nonsense', story(), ctx()).ok, false);
});

test('approve and publish puts the story live now, with the approver as publisher', () => {
  const plan = planAction('approvePublish', story(), ctx());
  assert.equal(plan.ok, true, plan.reasons.join(' '));
  assert.equal(plan.set.status, 'published');
  assert.equal(plan.set.publishedAt, NOW.toISOString());
  assert.equal(plan.set.firstPublishedAt, NOW.toISOString());
  assert.equal(plan.set.publishedById, APPROVER);
  assert.equal(plan.set.approval.contentHash, approvalHash(apply(story(), plan)), 'the hash covers the publish time');
});

test('publishing again keeps the first publication date', () => {
  const plan = planAction('publish', story({ status: 'approved', firstPublishedAt: '2026-10-01T00:00:00.000Z' }), ctx());
  assert.equal(plan.ok, true);
  assert.equal(plan.set.firstPublishedAt, undefined);
  assert.equal(plan.set.publishedAt, NOW.toISOString());
});

test('schedule sets a future publication time and needs at least five minutes', () => {
  const at = '2026-10-26T12:30:00Z';
  const plan = planAction('schedule', story({ status: 'approved' }), ctx({ scheduleAt: at }));
  assert.equal(plan.ok, true, plan.reasons.join(' '));
  assert.equal(plan.set.status, 'published');
  assert.equal(plan.set.publishedAt, new Date(at).toISOString());
  assert.equal(plan.set.scheduledAt, new Date(at).toISOString());
  for (const bad of [undefined, 'tomorrow-ish', '2026-10-26T08:04:00Z', '2026-10-25T08:00:00Z']) {
    assert.match(planAction('schedule', story({ status: 'approved' }), ctx({ scheduleAt: bad })).reasons[0], /at least 5 minutes/, String(bad));
  }
});

test('approval is refused while a publish check fails, with every reason listed', () => {
  const plan = planAction('approve', story({ headline: 'Too short', summary: '' }), ctx({ sourceLicenseStatus: 'pending_review' }));
  assert.equal(plan.ok, false);
  assert.equal(plan.reasons.length, 3);
  assert.match(plan.reasons.join(' '), /headline/);
  assert.match(plan.reasons.join(' '), /summary/);
  assert.match(plan.reasons.join(' '), /licence status is "pending_review"/);
});

test('reject needs a reason; return to review clears the approval', () => {
  assert.match(planAction('reject', story(), ctx({ reason: ' no ' })).reasons[0], /reason of 5-300/);
  const rejected = planAction('reject', story(), ctx({ reason: 'Consumer property tips, not capital markets.' }));
  assert.equal(rejected.set.rejectionReason, 'Consumer property tips, not capital markets.');
  const back = planAction('returnToReview', story({ status: 'approved', approval: { approvedById: APPROVER } }), ctx());
  assert.equal(back.set.status, 'pending_review');
  assert.deepEqual(back.unset.sort(), ['approval', 'publishedAt', 'publishedById', 'rejectionReason', 'scheduledAt']);
});

test('unpublish takes a story off the site but keeps the approval record', () => {
  const plan = planAction('unpublish', story({ status: 'published', publishedAt: '2026-10-20T00:00:00Z' }), ctx({ userId: EDITOR }));
  assert.equal(plan.set.status, 'approved');
  assert.ok(plan.unset.includes('publishedAt'));
  assert.ok(!plan.unset.includes('approval'));
});

test('saving an approved or live story: approvers re-stamp the approval, others are refused', () => {
  const live = apply(story(), planAction('approvePublish', story(), ctx()));
  const edited = { ...live, headline: 'ADIA and CPPIB buy a large Abu Dhabi logistics park' };
  assert.notEqual(approvalHash(edited), live.approval.contentHash, 'the edit breaks the old approval');

  const byApprover = planSave(edited, ctx());
  assert.equal(byApprover.ok, true);
  assert.equal(byApprover.set.approval.contentHash, approvalHash(edited));

  const byEditor = planSave(edited, ctx({ userId: EDITOR }));
  assert.equal(byEditor.ok, false);
  assert.match(byEditor.reasons[0], /This story is published\. Only approvers/);

  assert.equal(planSave({ ...edited, summary: '' }, ctx()).ok, false, 'a live story must keep passing the checks');
  assert.deepEqual(planSave(story(), ctx({ userId: EDITOR })).set, {}, 'pending stories save freely');
});

test('suggested slugs are lowercase words plus four characters of the id', () => {
  assert.equal(suggestSlug({ headline: 'Aldar & Mubadala: AED 1.2bn JV — “phase 2”', articleId: 'a_9f8e7d6c5b4a3210' }), 'aldar-mubadala-aed-1-2bn-jv-phase-2-9f8e');
  const long = suggestSlug({ headline: 'word '.repeat(40), articleId: 'a_1234567890abcdef' });
  assert.ok(long.length <= 85 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(long), long);
  assert.match(suggestSlug({ headline: '' }), /^story-[0-9a-f]{4}$/);
});
