// Cross-source story grouping.
//
// Two articles are treated as the same underlying event when, within a time
// window (default 72 hours), EITHER:
//   1. their headlines share at least half of their meaningful words
//      (Jaccard similarity >= titleSimilarity), OR
//   2. they share at least two distinctive entities (for example a company
//      name AND the same money amount), at least one of which is a name,
//      those shared entities make up at least half of the smaller headline's
//      entities, and the headlines still overlap a little (>= entitySimilarity).
//
// Rule 2 catches rewrites such as
//   "Dubai fintech Qirsh raises $45 million Series B"  vs
//   "Qirsh lands $45m to take buy-now-pay-later across the Gulf".

import { tokens, extractEntities, jaccard, isAmountToken } from './text.js';
import { shortHash } from './url.js';

export function fingerprint(article) {
  return {
    titleTokens: tokens(article.title),
    entities: extractEntities(article.title)
  };
}

export function similarity(fa, fb, cfg) {
  const titleJ = jaccard(fa.titleTokens, fb.titleTokens);
  const shared = [...fa.entities].filter((e) => fb.entities.has(e));
  const sharedNames = shared.filter((e) => !isAmountToken(e)).length;
  const minEntities = Math.min(fa.entities.size, fb.entities.size) || 1;
  const entityOverlap = shared.length / minEntities;

  const byTitle = titleJ >= cfg.titleSimilarity;
  const byEntities =
    shared.length >= cfg.minSharedEntities &&
    sharedNames >= 1 &&
    entityOverlap >= 0.5 &&
    titleJ >= cfg.entitySimilarity;

  return { match: byTitle || byEntities, score: titleJ + 0.5 * entityOverlap, titleJ, shared };
}

export const storyIdFor = (firstArticleId) => `s_${shortHash(firstArticleId, 14)}`;

/**
 * Builds the displayable story fields from its member articles.
 * Lead article = most authoritative source (lowest priority number), then earliest.
 */
export function recomputeStory(story, articlesById, sourcePriority, settings) {
  const members = story.articleIds.map((id) => articlesById.get(id)).filter(Boolean);
  if (!members.length) return null;
  members.sort((a, b) =>
    (sourcePriority.get(a.sourceId) ?? 9) - (sourcePriority.get(b.sourceId) ?? 9) ||
    new Date(a.publishedAt) - new Date(b.publishedAt)
  );
  const lead = members[0];

  const topicTotals = {};
  for (const m of members) {
    for (const [topic, score] of Object.entries(m.topicScores || {})) topicTotals[topic] = (topicTotals[topic] || 0) + score;
  }
  const rankedTopics = Object.entries(topicTotals).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const times = members.map((m) => new Date(m.publishedAt).getTime());
  const isUae = members.some((m) => (m.uaeScore || 0) >= settings.news.uaeThreshold);

  return {
    ...story,
    leadArticleId: lead.articleId,
    articleIds: members.map((m) => m.articleId),
    headline: lead.title,
    summary: lead.summary || members.find((m) => m.summary)?.summary || '',
    imageUrl: lead.imageUrl || members.find((m) => m.imageUrl)?.imageUrl || null,
    category: isUae ? 'uae' : 'world',
    topic: rankedTopics[0] || lead.topic,
    topics: rankedTopics.slice(0, 3),
    sourceIds: [...new Set(members.map((m) => m.sourceId))],
    firstPublishedAt: new Date(Math.min(...times)).toISOString(),
    lastPublishedAt: new Date(Math.max(...times)).toISOString()
  };
}

/**
 * Finds the best existing story for a new article, or null.
 * @param {object} article     the new article (with .fp fingerprint and .publishedAt)
 * @param {object[]} stories   candidate stories
 * @param {Map} articlesById   all known articles (each with .fp)
 */
export function findStory(article, stories, articlesById, cfg) {
  const windowMs = cfg.windowHours * 3_600_000;
  const t = new Date(article.publishedAt).getTime();
  let best = null;
  let bestScore = 0;
  for (const story of stories) {
    const first = new Date(story.firstPublishedAt).getTime();
    const last = new Date(story.lastPublishedAt).getTime();
    if (t < first - windowMs || t > last + windowMs) continue;
    for (const id of story.articleIds) {
      const member = articlesById.get(id);
      if (!member?.fp) continue;
      const sim = similarity(article.fp, member.fp, cfg);
      if (sim.match && sim.score > bestScore) {
        best = story;
        bestScore = sim.score;
      }
    }
  }
  return best;
}


