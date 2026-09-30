// News pipeline: fetch -> normalise -> quality filter -> deduplicate ->
// classify -> relevance filter -> link check -> group into stories -> prune.

import { NEWS_ADAPTERS } from '../adapters/index.js';
import { log } from '../lib/logger.js';
import { mapLimit, checkLink } from '../lib/http.js';
import { htmlToText, cleanExcerpt, truncate, normaliseTitle, escapeRegExp } from '../lib/text.js';
import { canonicalizeUrl, articleIdFor, isHttpUrl } from '../lib/url.js';
import { buildClassifier, classifyArticle } from '../lib/classify.js';
import { buildQualityRules, assessQuality, isPressRelease } from '../lib/quality.js';
import { fingerprint, findStory, recomputeStory, storyIdFor } from '../lib/grouping.js';
import { stateFor, isPaused, recordSuccess, recordFailure } from '../lib/sourceHealth.js';

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

  let imageUrl = null;
  if (source.allowImages !== false) {
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

export async function runNews(ctx) {
  const { settings, newsSources, allNewsSources, taxonomy, repos, now, demo } = ctx;
  const cfg = settings.news;
  const classifier = buildClassifier(taxonomy);
  const rules = buildQualityRules(taxonomy);
  const sourcePriority = new Map(allNewsSources.map((s) => [s.id, s.priority ?? 5]));

  const db = repos.news.load();
  const feedState = repos.feedState.load();

  // In-memory indexes over existing data.
  const articlesById = new Map();
  const byGuid = new Map();
  const byTitleKey = new Map();
  for (const a of db.articles) {
    a.fp = fingerprint(a);
    articlesById.set(a.articleId, a);
    if (a.guid) byGuid.set(`${a.sourceId}::${a.guid}`, a);
    byTitleKey.set(`${a.sourceId}::${normaliseTitle(a.title)}`, a);
  }
  const storiesById = new Map(db.stories.map((s) => [s.storyId, s]));

  const stats = { sources: {}, fetched: 0, added: 0, duplicates: 0, filtered: {}, grouped: 0, newStories: 0, pruned: 0 };
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
  const pending = new Map(); // articleId -> article (dedupes across feeds within this run)
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

      const existing = articlesById.get(articleId) || pending.get(articleId) || byGuid.get(guidKey);
      const sameTitle = byTitleKey.get(titleKey);
      const titleDuplicate = sameTitle && Math.abs(new Date(sameTitle.publishedAt) - item.publishedAt) < TITLE_DEDUPE_WINDOW;
      if (existing || titleDuplicate) {
        const target = existing || sameTitle;
        target.lastSeenAt = now.toISOString();
        if (!target.imageUrl && item.imageUrl) target.imageUrl = item.imageUrl;
        if (!target.summary && item.summary) target.summary = item.summary;
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
        topicScores: cls.topicScores,
        uaeScore: cls.uaeScore,
        relevanceScore: cls.relevance,
        summary: item.summary,
        imageUrl: item.imageUrl,
        isPressRelease: isPressRelease(rules, item) || undefined,
        storyId: null,
        ingestedAt: now.toISOString(),
        lastSeenAt: now.toISOString()
      };
      pending.set(articleId, article);
      byGuid.set(guidKey, article);
      byTitleKey.set(titleKey, article);
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

  /* 4. Group into stories, oldest first so the earliest report founds the story. */
  candidates.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  const recentWindow = now.getTime() - (cfg.maxAgeDays + 3) * DAY;
  const recentStories = db.stories.filter((s) => new Date(s.lastPublishedAt).getTime() >= recentWindow);
  const touched = new Set();

  for (const article of candidates) {
    article.fp = fingerprint(article);
    articlesById.set(article.articleId, article);
    const story = findStory(article, recentStories, articlesById, cfg.grouping);
    if (story) {
      story.articleIds.push(article.articleId);
      article.storyId = story.storyId;
      stats.grouped++;
      touched.add(story.storyId);
    } else {
      const created = {
        storyId: storyIdFor(article.articleId),
        articleIds: [article.articleId],
        createdAt: now.toISOString(),
        firstPublishedAt: article.publishedAt,
        lastPublishedAt: article.publishedAt
      };
      article.storyId = created.storyId;
      storiesById.set(created.storyId, created);
      recentStories.push(created);
      stats.newStories++;
      touched.add(created.storyId);
    }
    Object.assign(storiesById.get(article.storyId), recomputeStory(storiesById.get(article.storyId), articlesById, sourcePriority, settings));
    stats.added++;
    stats.sources[article.sourceId].added++;
  }

  /* 5. Retention: drop articles older than retentionDays and clean up stories. */
  const cutoff = now.getTime() - cfg.retentionDays * DAY;
  for (const [id, a] of articlesById) {
    if (new Date(a.publishedAt).getTime() < cutoff) {
      articlesById.delete(id);
      stats.pruned++;
      if (a.storyId) touched.add(a.storyId);
    }
  }
  for (const storyId of touched) {
    const story = storiesById.get(storyId);
    if (!story) continue;
    const recomputed = recomputeStory(
      { ...story, articleIds: story.articleIds.filter((id) => articlesById.has(id)), updatedAt: now.toISOString() },
      articlesById, sourcePriority, settings
    );
    if (recomputed) storiesById.set(storyId, recomputed);
    else storiesById.delete(storyId);
  }

  /* 6. Persist (without in-memory fingerprints). */
  const articles = [...articlesById.values()]
    .map(({ fp, ...rest }) => rest)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const stories = [...storiesById.values()].sort((a, b) => new Date(b.firstPublishedAt) - new Date(a.firstPublishedAt));
  repos.news.save({ updatedAt: now.toISOString(), articles, stories });
  repos.feedState.save(feedState);

  const failed = results.filter((r) => r.failed).length;
  const skipped = results.filter((r) => r.skipped).length;
  log.info('news.done', {
    fetched: stats.fetched, added: stats.added, duplicates: stats.duplicates, grouped: stats.grouped,
    stories: stories.length, filtered: stats.filtered, failedSources: failed
  });
  return { stats, failedSources: failed, skippedSources: skipped, totalSources: newsSources.length, articles, stories, feedState };
}
