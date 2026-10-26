// Demo mode only: editor decisions for the fictional demo stories, so the demo site shows
// the queue working (published, rejected and still-pending stories) without anyone
// pressing buttons. The decisions are fixed data in fixtures/news/demo-decisions.json,
// signed by the demo approver, which only demo mode accepts. Live mode never loads this
// file's decisions: applyDemoDecisions() throws outside demo mode.

import path from 'node:path';
import { FIXTURES_DIR, readJson } from '../config.js';
import { log } from '../lib/logger.js';
import { approvalHash, publishBlockers } from './workflow.js';
import { buildTaxonomyIndex, refsFor } from './reviewDocs.js';

export const DEMO_APPROVER_ID = 'demo-editor';
export const DEMO_DECISIONS_FILE = path.join(FIXTURES_DIR, 'news', 'demo-decisions.json');

/** The editorial fields a decision may set, as they would be set in the Studio. */
function editorialSet(decision, index) {
  const set = {};
  if (decision.headline) set.headline = decision.headline;
  if (decision.summary) { set.summary = decision.summary; set.summarySource = 'editor'; }
  if (decision.capitalTypes) set.capitalTypes = refsFor(index.capital, decision.capitalTypes);
  if (decision.assetClasses) set.assetClasses = refsFor(index.asset, decision.assetClasses);
  if (decision.geography) set.geography = decision.geography;
  if (decision.transactionType !== undefined) set.transactionType = decision.transactionType;
  if (decision.featured) set.featured = true;
  return set;
}

/**
 * Applies the fixture's decisions to pending demo stories (matched by canonical URL).
 * Stories already decided are left alone, so re-running changes nothing.
 * @returns {Promise<{published:number, rejected:number, unmatched:number}>}
 */
export async function applyDemoDecisions(ctx, file = DEMO_DECISIONS_FILE) {
  if (!ctx.demo) throw new Error('Demo decisions are only applied in demo mode.');
  if (typeof ctx.review.decide !== 'function') throw new Error('The demo queue must allow editorial writes.');
  const { decisions = [] } = readJson(file);
  const docs = await ctx.review.loadRecent(new Date(0));
  const byUrl = new Map(docs.map((d) => [d.canonicalUrl, d]));
  const license = new Map(ctx.allNewsSources.map((s) => [s.id, s.licenseStatus]));
  const index = buildTaxonomyIndex(ctx.newsTaxonomy);
  const at = ctx.now.toISOString();
  const counts = { published: 0, rejected: 0, unmatched: 0 };

  for (const decision of decisions) {
    const doc = byUrl.get(decision.canonicalUrl);
    if (!doc) { counts.unmatched++; log.warn('news.demo.unmatched', { url: decision.canonicalUrl }); continue; }
    if (doc.status !== 'pending_review') continue;
    const signed = { statusChangedAt: at, statusChangedById: DEMO_APPROVER_ID };
    if (decision.action === 'reject') {
      await ctx.review.decide(doc._id, { status: 'rejected', rejectionReason: decision.reason || 'Not relevant.', ...signed });
      counts.rejected++;
      continue;
    }
    if (decision.action !== 'publish') continue; // "pending": left for the queue
    const next = { ...doc, ...editorialSet(decision, index), status: 'published', publishedAt: at, publishedById: DEMO_APPROVER_ID, firstPublishedAt: at, ...signed };
    const blockers = publishBlockers(next, { sourceLicenseStatus: license.get(doc.sourceId) });
    if (blockers.length) { log.warn('news.demo.blocked', { story: doc._id, reasons: blockers.join('; ') }); continue; }
    next.approval = { approvedById: DEMO_APPROVER_ID, approvedByName: 'Demo editor', approvedAt: at, contentHash: approvalHash(next) };
    const { _id, ...set } = next;
    await ctx.review.decide(_id, set);
    counts.published++;
  }
  log.info('news.demo.decisions', counts);
  return counts;
}
