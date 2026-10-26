// Builds review-queue documents from pipeline articles. A review document has the
// shape of the Sanity "newsArticle" document (studio/schemaTypes/newsArticle.js), so the
// file queue (demo mode, tests) and the Sanity queue (live) hold identical records; the
// field groups and who owns them are in src/news/rules.js.

import { NEWS_ID_PATH } from './rules.js';
import { suggestSlug } from './workflow.js';

export const NEWS_DOC_TYPE = 'newsArticle';
export const SOURCE_REF_PREFIX = 'newsSource-';
export const CAPITAL_REF_PREFIX = 'capitalType-';
export const ASSET_REF_PREFIX = 'assetClass-';

const REVIEW_ID = new RegExp(`^${NEWS_ID_PATH}\\.a_[0-9a-f]{16}$`);

export const reviewIdFor = (articleId) => `${NEWS_ID_PATH}.${articleId}`;
export const draftIdFor = (id) => `drafts.${id}`;
/** A published queue id ("queue.a_<16 hex>"), never a draft. */
export const isReviewId = (id) => typeof id === 'string' && REVIEW_ID.test(id);

/**
 * References are weak: the source and category documents exist in the Studio once the
 * registry is imported (news.registry.source "sanity"), but a story must never fail to
 * import because one is missing.
 */
export const weakRef = (refId) => ({ _type: 'reference', _ref: refId, _weak: true });
export const keyedRefs = (prefix, ids = []) => ids.map((id) => ({ ...weakRef(prefix + id), _key: id }));
export const idFromRef = (ref, prefix) => (typeof ref?._ref === 'string' && ref._ref.startsWith(prefix) ? ref._ref.slice(prefix.length) : null);
export const idsFromRefs = (refs, prefix) => (Array.isArray(refs) ? refs.map((r) => idFromRef(r, prefix)).filter(Boolean) : []);

/** Drops null, undefined and empty-string values: in Sanity an absent field means "not set". */
function compact(doc) {
  return Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== null && v !== undefined && v !== ''));
}

/** One extra outlet reporting the same story (attached by the importer, never shown until approved). */
export function otherSourceEntry(article, now) {
  return compact({
    _key: article.articleId,
    articleId: article.articleId,
    sourceId: article.sourceId,
    sourceName: article.sourceName,
    title: article.title,
    url: article.originalUrl,
    canonicalUrl: article.canonicalUrl,
    guid: article.guid,
    publishedAt: article.publishedAt,
    attachedAt: now.toISOString()
  });
}

/**
 * A new pending story. Editorial fields are pre-filled once from the publisher's data and the
 * classifier's suggestions; after this the importer never touches them again.
 * @param article  pipeline article (pipeline/news.js): title, link fields, excerpt in `summary`, keyword topics
 * @param cls      classifyTaxonomy() result
 */
export function newReviewDoc(article, cls, { now }) {
  const at = now.toISOString();
  const excerpt = article.summary || '';
  return compact({
    _id: reviewIdFor(article.articleId),
    _type: NEWS_DOC_TYPE,
    articleId: article.articleId,
    storyId: article.storyId,
    originalHeadline: article.title,
    originalUrl: article.originalUrl,
    canonicalUrl: article.canonicalUrl,
    guid: article.guid,
    source: weakRef(SOURCE_REF_PREFIX + article.sourceId),
    sourceId: article.sourceId,
    sourceName: article.sourceName,
    sourcePublishedAt: article.publishedAt,
    dateEstimated: article.dateEstimated === true,
    importedAt: at,
    lastSeenAt: at,
    excerpt,
    sourceImageUrl: article.imageUrl,
    topic: article.topic,
    topics: article.topics,
    category: article.category,
    uaeScore: article.uaeScore,
    relevanceScore: article.relevanceScore,
    isPressRelease: article.isPressRelease === true,
    classification: compact({
      method: cls.method,
      confidence: cls.confidence,
      needsReview: cls.needsReview,
      reasons: cls.reasons,
      explanation: cls.explanation,
      suggestedCapitalTypes: cls.capitalTypes,
      suggestedAssetClasses: cls.assetClasses,
      suggestedGeography: cls.geography,
      suggestedTransactionType: cls.transactionType
    }),
    priority: cls.priority,
    dedupeKey: article.canonicalUrl,
    otherSources: [],
    headline: article.title,
    slug: { _type: 'slug', current: suggestSlug({ headline: article.title, articleId: article.articleId }) },
    summary: excerpt,
    summarySource: excerpt ? 'excerpt' : null,
    capitalTypes: keyedRefs(CAPITAL_REF_PREFIX, cls.capitalTypes),
    assetClasses: keyedRefs(ASSET_REF_PREFIX, cls.assetClasses),
    geography: cls.geography,
    transactionType: cls.transactionType,
    status: 'pending_review',
    statusChangedAt: at
  });
}
