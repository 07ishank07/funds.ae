// News pipeline: fetch -> normalise -> quality filter -> deduplicate (this run and the
// review queue) -> classify (topics, Capital Types, Asset Classes) -> relevance filter ->
// link check -> group into stories -> write to the review queue -> prune.
//
// Nothing here publishes. New stories enter the queue as pending_review and reach the
// site only after an approver publishes them in the Studio (docs/NEWS-REVIEW-GUIDE.md);
// publishApprovedNews() in pipeline/publish.js builds the API from those alone.

import { NEWS_ADAPTERS } from '../adapters/index.js';
import { log } from '../lib/logger.js';
import { mapLimit, checkLink } from '../lib/http.js';
import { htmlToText, cleanExcerpt, truncate, normaliseTitle, escapeRegExp } from '../lib/text.js';
import { canonicalizeUrl, articleIdFor, isHttpUrl } from '../lib/url.js';
import { buildClassifier, classifyArticle } from '../lib/classify.js';
import { buildTaxonomyClassifier, classifyTaxonomy } from '../lib/taxonomyClassify.js';
import { buildQualityRules, assessQuality, isPressRelease } from '../lib/quality.js';
import { fingerprint, findStory, storyIdFor } from '../lib/grouping.js';
import { stateFor, isPaused, recordSuccess, recordFailure } from '../lib/sourceHealth.js';
import { newReviewDoc, otherSourceEntry } from '../news/reviewDocs.js';
import { createMutation, ingestPatchMutations, pruneMutation } from '../news/importerMutations.js';
import { PUBLISHABLE_LICENSE_STATUSES } from '../news/rules.js';

const DAY = 86_400_000;
const TITLE_DEDUPE_WINDOW = 7 * DAY;

/** Turns a raw feed item into clean, bounded, plain-text fields. */
export function normaliseItem(raw, source, settings, now) {
  let title = htmlToText(raw.title);
  // Some feeds append " - Publisher" or " | Publisher" to every headline.
  title = title.replace(new RegExp(`\\s+[-|–—]\\s+${escapeRegExp(source.name)}\\s*$`, 'i'), '').trim();

  let link = (raw.link || '').trim();
  if (link && !isHttpUrl(link) && source.homepage) {
    try { link = new URL(link, source.homepage).toString(); } catch { link = ''; }
  }

  let summary = cleanExcerpt(htmlToText(raw.summaryHtml));
  if (!summary) summary = cleanExcerpt(htmlToText(raw.contentHtml));
  summary = truncate(summary, settings.news.excerptMaxChars);
  if (normaliseTitle(summary) === normaliseTitle(title)) summary = '';
  // Publishers whose terms don't allow their excerpt get headline + link only.
  if (source.allowExcerpt === false) summary = '';

  let imageUrl = null;
  // Images are opt-in per source (allowImages: true), set once the publisher's terms allow it.
  if (source.allowImages === true) {
    const candidate = raw.images?.[0] || raw.htmlImage || null;
    // Only https images: the site is served over https and must not load mixed content.
    if (candidate && /^https:\/\//i.test(candidate)) imageUrl = candidate;
  }

  let publishedAt = raw.publishedAt instanceof Date ? raw.publishedAt : null;
  let dateEstimated = false;
  if (!publishedAt) {
    publishedAt = now;
    dateEstimated = true;
  } else if (publishedAt.getTime() > now.getTime() + 3_600_000) {
    publishedAt = now; // clock skew or scheduled posts
    dateEstimated = true;
  }

  return {
    title,
    link,
    guid: String(raw.guid || link || '').trim(),
    summary,
    imageUrl,
    publishedAt,
    dateEstimated,
    categories: raw.categories || []
  };
}

/** Grouping and dedupe view of a queue story's articles: its lead and every outlet attached to it. */
function storyMembers(doc) {
  const lead = { articleId: doc.articleId, title: doc.originalHeadline, sourceId: doc.sourceId, guid: doc.guid, publishedAt: doc.sourcePublishedAt };
  const others = (doc.otherSources || []).map((o) => ({ articleId: o.articleId, title: o.title, sourceId: o.sourceId, guid: o.guid, publishedAt: o.publishedAt }));
  return [lead, ...others].filter((m) => m.articleId && m.title && m.publishedAt);
}

const timeOf = (iso) => new Date(iso).getTime();

/**
 * @param ctx  { settings, newsSources, allNewsSources, taxonomy, newsTaxonomy, now, demo,
 *              review: NewsReviewRepository, newsHealth: { load(), save(state) } }
 */
export async function runNews(ctx) {
  const { settings, newsSources, allNewsSources, taxonomy, newsTaxonomy, review, newsHealth, now, demo } = ctx;
  const cfg = settings.news;
  const queueCfg = cfg.review;
  const classifier = buildClassifier(taxonomy);
  const taxonomyClassifier = buildTaxonomyClassifier(newsTaxonomy, taxonomy);
  const rules = buildQualityRules(taxonomy);
  const sourcePriority = new Map(allNewsSources.map((s) => [s.id, s.priority ?? 5]));
  // A story can only be published from a source whose licence is cleared, so such a source leads when it can.
  const cleared = new Set(allNewsSources.filter((s) => PUBLISHABLE_LICENSE_STATUSES.includes(s.licenseStatus)).map((s) => s.id));

  // The queue is read before anything is fetched: if it cannot be read, nothing is written.
  const recent = await review.loadRecent(new Date(now.getTime() - (cfg.maxAgeDays + 3) * DAY));
  const feedState = await newsHealth.load();

  // Indexes over the queue (lead articles and attached outlets) and over this run's new articles.
  const known = new Map(); // articleId -> queue doc (null while the article is new in this run)
  const byGuid = new Map(); // sourceId::guid -> { doc }
  const byTitleKey = new Map(); // sourceId::title -> { doc, publishedAt }
  const articlesById = new Map(); // articleId -> member with .fp, for grouping
  const stories = []; // grouping candidates: queue stories plus stories founded in this run
  for (const doc of recent) {
    const members = storyMembers(doc);
    if (!members.length) continue;
    const times = members.map((m) => timeOf(m.publishedAt));
    const story = {
      doc,
      articleIds: [],
      added: [],
      firstPublishedAt: new Date(Math.min(...times)).toISOString(),
      lastPublishedAt: new Date(Math.max(...times)).toISOString()
    };
    for (const m of members) {
      m.fp = fingerprint(m);
      articlesById.set(m.articleId, m);
      story.articleIds.push(m.articleId);
      known.set(m.articleId, doc);
      if (m.guid) byGuid.set(`${m.sourceId}::${m.guid}`, { doc });
      byTitleKey.set(`${m.sourceId}::${normaliseTitle(m.title)}`, { doc, publishedAt: m.publishedAt });
    }
    stories.push(story);
  }

  const stats = {
    sources: {}, fetched: 0, added: 0, duplicates: 0, filtered: {}, grouped: 0, newStories: 0, attached: 0,
    pruned: 0, queue: {}
  };
  const bump = (reason) => { stats.filtered[reason] = (stats.filtered[reason] || 0) + 1; };

  /* 1. Fetch every source (isolated: one failure never stops the others). */
  const results = await mapLimit(newsSources, settings.http.concurrency, async (source) => {
    const state = stateFor(feedState, source.id);
    const s = (stats.sources[source.id] = { name: source.name, status: 'ok', fetched: 0, added: 0 });
    if (!demo && isPaused(state, now)) {
      s.status = state.status;
      log.warn('news.source.skipped', { source: source.id, reason: state.status, until: state.pausedUntil });
      return { source, items: [], skipped: true };
    }
    try {
      const out = await NEWS_ADAPTERS[source.type](source, { settings, demo, now, state });
      recordSuccess(state, now, {
        etag: out.etag ?? state.etag,
        lastModified: out.lastModified ?? state.lastModified,
        format: out.format ?? state.format,
        lastItemCount: out.notModified ? state.lastItemCount : out.items.length
      });
      if (out.notModified) s.status = 'not-modified';
      const items = out.items.slice(0, cfg.maxItemsPerFeed);
      s.fetched = items.length;
      log.info('news.source.fetched', { source: source.id, items: items.length, notModified: out.notModified || undefined });
      return { source, items };
    } catch (err) {
      recordFailure(state, err, now, settings);
      s.status = state.status;
      s.error = state.lastError;
      log.warn('news.source.failed', { source: source.id, error: state.lastError, status: state.status, failures: state.consecutiveFailures });
      return { source, items: [], failed: true };
    }
  });

  /* 2. Normalise, filter, deduplicate and classify. */
  const seen = new Map(); // queue doc id -> { doc, backfill } for stories found in the feeds again
  const markSeen = (doc, backfill) => {
    const entry = seen.get(doc._id) || { doc, backfill: {} };
    Object.assign(entry.backfill, backfill);
    seen.set(doc._id, entry);
  };
  const pending = new Map(); // articleId -> new article (dedupes across feeds within this run)
  for (const { source, items } of results) {
    for (const raw of items) {
      stats.fetched++;
      const item = normaliseItem(raw, source, settings, now);
      const quality = assessQuality(rules, item, settings, now);
      if (!quality.ok) { bump(quality.reason); continue; }

      const canonicalUrl = canonicalizeUrl(item.link);
      if (!canonicalUrl) { bump('invalid-link'); continue; }
      const articleId = articleIdFor(canonicalUrl);
      const guidKey = `${source.id}::${item.guid}`;
      const titleKey = `${source.id}::${normaliseTitle(item.title)}`;

      const sameTitle = byTitleKey.get(titleKey);
      const titleDuplicate = Boolean(sameTitle) && Math.abs(timeOf(sameTitle.publishedAt) - item.publishedAt.getTime()) < TITLE_DEDUPE_WINDOW;
      const guidHit = byGuid.get(guidKey);
      if (known.has(articleId) || guidHit || titleDuplicate) {
        // Already queued (or new in this run): refresh when it was last seen, and fill in a
        // missing excerpt or image on the story's own lead article. Nothing editorial changes.
        const doc = known.get(articleId) || guidHit?.doc || (titleDuplicate ? sameTitle.doc : null);
        if (doc) markSeen(doc, doc.articleId === articleId ? { excerpt: item.summary || undefined, sourceImageUrl: item.imageUrl || undefined } : {});
        stats.duplicates++;
        continue;
      }

      const cls = classifyArticle(classifier, item, source, settings);
      const threshold = source.focus === 'private-markets' ? cfg.focusedSourceRelevanceThreshold : cfg.relevanceThreshold;
      if (cls.relevance < threshold) { bump('not-relevant'); continue; }

      const article = {
        articleId,
        title: item.title,
        sourceId: source.id,
        sourceName: source.name,
        originalUrl: item.link,
        canonicalUrl,
        guid: item.guid,
        publishedAt: item.publishedAt.toISOString(),
        dateEstimated: item.dateEstimated || undefined,
        category: cls.category,
        topic: cls.topic,
        topics: cls.topics,
        uaeScore: cls.uaeScore,
        relevanceScore: cls.relevance,
        summary: item.summary,
        imageUrl: item.imageUrl,
        isPressRelease: isPressRelease(rules, item) || undefined,
        taxonomy: classifyTaxonomy(taxonomyClassifier, item, { uae: cls.category === 'uae' })
      };
      pending.set(articleId, article);
      known.set(articleId, null);
      byGuid.set(guidKey, { doc: null });
      byTitleKey.set(titleKey, { doc: null, publishedAt: article.publishedAt });
    }
  }

  /* 3. Broken-link check on new articles only (live mode). */
  let candidates = [...pending.values()];
  if (!demo && cfg.checkLinks && candidates.length) {
    const statuses = await mapLimit(candidates, settings.http.concurrency, (a) =>
      checkLink(a.originalUrl, { userAgent: settings.userAgent, timeoutMs: cfg.linkCheckTimeoutMs })
    );
    candidates = candidates.filter((a, i) => {
      if (statuses[i] === 'broken') {
        bump('broken-link');
        log.info('news.article.broken', { source: a.sourceId, url: a.originalUrl });
        return false;
      }
      return true;
    });
  }

  /* 4. Group into stories, oldest first. Queue stories keep their lead: a new report of one is
        attached as another outlet. A story founded in this run takes as lead a source with a
        cleared licence if it has one, then the most authoritative (lowest priority number), then
        the earliest report, preferring original reporting. */
  candidates.sort((a, b) => timeOf(a.publishedAt) - timeOf(b.publishedAt));
  for (const article of candidates) {
    article.fp = fingerprint(article);
    articlesById.set(article.articleId, article);
    const story = findStory(article, stories, articlesById, cfg.grouping);
    if (story) {
      story.articleIds.push(article.articleId);
      story.added.push(article);
      if (article.publishedAt < story.firstPublishedAt) story.firstPublishedAt = article.publishedAt;
      if (article.publishedAt > story.lastPublishedAt) story.lastPublishedAt = article.publishedAt;
      stats.grouped++;
    } else {
      stories.push({ doc: null, articleIds: [article.articleId], added: [article], firstPublishedAt: article.publishedAt, lastPublishedAt: article.publishedAt });
    }
  }

  /* 5. Turn the result into queue writes: new stories, outlets attached to queued stories, and
        "last seen" refreshes (throttled, so editors' drafts are rarely touched). */
  const creates = [];
  const patches = new Map(); // doc id -> { set, setIfMissing }
  const patchFor = (id) => patches.get(id) || patches.set(id, { set: {}, setIfMissing: {} }).get(id);
  const nowIso = now.toISOString();
  for (const story of stories) {
    if (!story.added.length) continue;
    if (story.doc) {
      const attached = story.added.map((a) => otherSourceEntry(a, now));
      patchFor(story.doc._id).set.otherSources = [...(story.doc.otherSources || []), ...attached];
      patchFor(story.doc._id).set.lastSeenAt = nowIso;
      stats.attached += attached.length;
      for (const a of story.added) stats.sources[a.sourceId].added++;
      continue;
    }
    const members = [...story.added].sort((a, b) =>
      Number(!cleared.has(a.sourceId)) - Number(!cleared.has(b.sourceId)) ||
      (sourcePriority.get(a.sourceId) ?? 9) - (sourcePriority.get(b.sourceId) ?? 9) ||
      timeOf(a.publishedAt) - timeOf(b.publishedAt)
    );
    const [lead, ...others] = members;
    const isUae = members.some((m) => m.category === 'uae');
    const cls = { ...lead.taxonomy, geography: isUae && !lead.taxonomy.geography.includes('uae') ? ['uae', ...lead.taxonomy.geography] : lead.taxonomy.geography };
    const doc = newReviewDoc({ ...lead, category: isUae ? 'uae' : lead.category, storyId: storyIdFor(lead.articleId) }, cls, { now });
    doc.otherSources = others.map((o) => otherSourceEntry(o, now));
    creates.push(doc);
    for (const m of members) stats.sources[m.sourceId].added++;
  }
  const throttleMs = queueCfg.lastSeenThrottleHours * 3_600_000;
  for (const { doc, backfill } of seen.values()) {
    const patch = patches.get(doc._id);
    if (patch || now.getTime() - timeOf(doc.lastSeenAt || 0) >= throttleMs) patchFor(doc._id).set.lastSeenAt = nowIso;
    // A missing excerpt or feed image is filled in only while nobody has decided on the story,
    // so nothing appears on an approved story that the approver did not see.
    if (doc.status === 'pending_review') {
      for (const [field, value] of Object.entries(backfill)) {
        if (value !== undefined && !doc[field]) patchFor(doc._id).setIfMissing[field] = value;
      }
    }
  }

  /* 6. Respect the document budget (Sanity Free plan: 10,000 documents). */
  const documents = await review.count();
  const { warnAt, stopCreatesAt } = queueCfg.documentBudget;
  if (documents >= warnAt) log.warn('news.queue.budget', { documents, warnAt, stopCreatesAt });
  const room = Math.max(0, stopCreatesAt - documents);
  if (creates.length > room) {
    log.error('news.queue.full', {
      documents, stopCreatesAt, skipped: creates.length - room,
      detail: 'The review queue is at its document budget. Reject or archive stories, or lower news.review TTLs; the most relevant new stories were kept.'
    });
    creates.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    creates.length = room;
  }

  /* 7. Write: creates, patches (also on open drafts), then prune. */
  const patchIds = [...patches.keys()].filter((id) => {
    const p = patches.get(id);
    return Object.keys(p.set).length || Object.keys(p.setIfMissing).length;
  });
  const drafts = patchIds.length ? await review.existingDraftIds(patchIds) : new Set();
  const mutations = [
    ...creates.map(createMutation),
    ...patchIds.flatMap((id) => ingestPatchMutations(id, patches.get(id), { hasDraft: drafts.has(id) })),
    pruneMutation({ now, pendingTtlDays: queueCfg.pendingTtlDays, rejectedTtlDays: queueCfg.rejectedTtlDays })
  ];
  const written = await review.commit(mutations);
  await newsHealth.save(feedState);

  stats.added = written.created;
  stats.newStories = written.created;
  stats.pruned = written.deleted;
  stats.queue = { ...written, documents: documents + written.created - written.deleted, drafts: drafts.size };
  const failed = results.filter((r) => r.failed).length;
  const skipped = results.filter((r) => r.skipped).length;
  log.info('news.done', {
    fetched: stats.fetched, queued: written.created, attached: stats.attached, duplicates: stats.duplicates,
    grouped: stats.grouped, pruned: written.deleted, filtered: stats.filtered, failedSources: failed
  });
  return { stats, failedSources: failed, skippedSources: skipped, totalSources: newsSources.length, feedState };
}
