// The only rule for what reaches the public site. The queue's query already asks for
// published stories, but every story is checked again here, in code the importer and
// the Studio cannot change:
//   - status "published" and publishedAt has passed (scheduled stories wait);
//   - approved by a Sanity user id listed in settings.json news.review.approverIds;
//   - the content still matches the approval (approval.contentHash);
//   - every publish check passes, including the licence gate (src/news/workflow.js);
//   - a summary that is the publisher's excerpt still has the publisher's permission.
// A story that fails is held back and reported by id only, never by headline or by who
// approved it (the reasons end up in run history, which is public on GitHub Pages).

import { approvalHash, publishBlockers } from './workflow.js';
import { isReviewId } from './reviewDocs.js';

/**
 * @param {object} doc  review document
 * @param {{now:Date, approverIds:string[], licenseOf:(sourceId:string)=>string|undefined,
 *          allowsExcerpt?:(sourceId:string)=>boolean}} ctx
 * @returns {string[]} why the story is not public (empty = public)
 */
export function holdReasons(doc, { now, approverIds, licenseOf, allowsExcerpt = () => true }) {
  if (!doc || !isReviewId(doc._id)) return ['not a published queue document'];
  if (doc.status !== 'published') return [`status is ${doc.status || 'missing'}`];
  const reasons = [];
  const liveAt = doc.publishedAt ? new Date(doc.publishedAt) : null;
  if (!liveAt || Number.isNaN(liveAt.getTime())) reasons.push('no publication time');
  else if (liveAt > now) reasons.push(`scheduled for ${liveAt.toISOString()}`);
  const approval = doc.approval || {};
  if (!approval.approvedById || !approval.approvedAt) reasons.push('no approval');
  else if (!approverIds?.length) reasons.push('no approvers are configured (news.review.approverIds)');
  else if (!approverIds.includes(approval.approvedById)) reasons.push('approved by someone who is not a listed approver');
  if (approval.contentHash !== approvalHash(doc)) reasons.push('changed since it was approved');
  reasons.push(...publishBlockers(doc, { sourceLicenseStatus: licenseOf(doc.sourceId) }));
  const excerptSummary = doc.summarySource === 'excerpt' || (doc.summary && doc.summary === doc.excerpt);
  if (excerptSummary && !allowsExcerpt(doc.sourceId)) reasons.push("the summary is the publisher's excerpt, which the source no longer allows");
  return reasons;
}

/** Splits candidates into public stories and held ones ({id, reasons}). */
export function selectPublic(docs, ctx) {
  const stories = [];
  const held = [];
  for (const doc of docs) {
    const reasons = holdReasons(doc, ctx);
    if (reasons.length) held.push({ id: doc?._id || '(no id)', reasons });
    else stories.push(doc);
  }
  return { stories, held };
}

/** licenseOf() for selectPublic: the licence status of each source in the registry. */
export function licenseLookup(allNewsSources) {
  const byId = new Map(allNewsSources.map((s) => [s.id, s.licenseStatus]));
  return (sourceId) => byId.get(sourceId);
}

/** allowsExcerpt() for selectPublic: false only when the registry says so for that source. */
export function excerptLookup(allNewsSources) {
  const denied = new Set(allNewsSources.filter((s) => s.allowExcerpt === false).map((s) => s.id));
  return (sourceId) => !denied.has(sourceId);
}
