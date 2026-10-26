// Builds review-queue documents from pipeline articles. A review document has the
// shape of the Sanity "newsArticle" document (studio/schemaTypes/newsArticle.js), so the
// file queue (demo mode, tests) and the Sanity queue (live) hold identical records; the
// field groups and who owns them are in src/news/rules.js.

import { NEWS_ID_PATH, NEWS_LIMITS } from './rules.js';
import { suggestSlug } from './workflow.js';
import { truncate } from '../lib/text.js';

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

/**
 * Capital Types and Asset Classes by id and by Sanity document id. Stories reference the
 * category document; categories seeded from config have ids like "capitalType-reits", ones an
 * editor creates in the Studio have random ids, which cms:pull records as "docId".
 */
export function buildTaxonomyIndex(newsTaxonomy = {}) {
  const make = (list = [], prefix) => {
    const entries = list.map((c) => ({ ...c, docId: c.docId || prefix + c.id }));
    return { list: entries, byId: new Map(entries.map((e) => [e.id, e])), byDocId: new Map(entries.map((e) => [e.docId, e])) };
  };
  return { capital: make(newsTaxonomy.capitalTypes, CAPITAL_REF_PREFIX), asset: make(newsTaxonomy.assetClasses, ASSET_REF_PREFIX) };
}

/** Weak, keyed references to the given category ids (unknown ids are dropped). */
export const refsFor = (dimension, ids = []) =>
  ids.map((id) => dimension.byId.get(id)).filter(Boolean).map((e) => ({ ...weakRef(e.docId), _key: e.id }));

/** The categories a story's references point at, in the configured order (unknown references are dropped). */
export const entriesFor = (dimension, refs) => {
  const wanted = new Set((Array.isArray(refs) ? refs : []).map((r) => r?._ref));
  return dimension.list.filter((e) => wanted.has(e.docId)).sort((a, b) => a.displayOrder - b.displayOrder);
};

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
 * @param opts     now; index: buildTaxonomyIndex() (without it, references use the seeded document ids)
 */
export function newReviewDoc(article, cls, { now, index }) {
  const at = now.toISOString();
  const excerpt = truncate(article.summary || '', NEWS_LIMITS.excerpt[1]);
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
    capitalTypes: index ? refsFor(index.capital, cls.capitalTypes) : keyedRefs(CAPITAL_REF_PREFIX, cls.capitalTypes),
    assetClasses: index ? refsFor(index.asset, cls.assetClasses) : keyedRefs(ASSET_REF_PREFIX, cls.assetClasses),
    geography: cls.geography,
    transactionType: cls.transactionType,
    status: 'pending_review',
    statusChangedAt: at
  });
}

/**
 * Puts an AI suggestion (src/ai/enrich.js) on a new story before it is created: the suggested tags and,
 * when one survived the checks, the summary. Where the AI suggests nothing for a category system, the
 * rule-based suggestion stays. Everything stays editable; the story is still pending.
 */
export function withAiSuggestion(doc, suggestion, index) {
  const rules = doc.classification || {};
  const capital = suggestion.capitalTypes.length ? suggestion.capitalTypes : rules.suggestedCapitalTypes || [];
  const asset = suggestion.assetClasses.length ? suggestion.assetClasses : rules.suggestedAssetClasses || [];
  const geography = suggestion.geography.length ? suggestion.geography : doc.geography;
  const transactionType = suggestion.transactionType || doc.transactionType || null;
  const reasons = [];
  if (!capital.length) reasons.push('No Capital Type suggested.');
  if (!asset.length) reasons.push('No Asset Class suggested.');
  if ((!suggestion.capitalTypes.length && capital.length) || (!suggestion.assetClasses.length && asset.length)) {
    reasons.push('Keyword-based categories kept where the AI suggested none.');
  }
  if (suggestion.confidence < 0.5) reasons.push(`Low AI confidence (${suggestion.confidence}).`);
  const next = {
    ...doc,
    classification: compact({
      ...rules,
      method: 'ai',
      confidence: suggestion.confidence,
      needsReview: (!capital.length && !asset.length) || suggestion.confidence < 0.5,
      reasons,
      suggestedCapitalTypes: capital,
      suggestedAssetClasses: asset,
      suggestedGeography: geography,
      suggestedTransactionType: transactionType,
      suggestedSummary: suggestion.summary
    }),
    capitalTypes: refsFor(index.capital, capital),
    assetClasses: refsFor(index.asset, asset),
    geography
  };
  if (transactionType) next.transactionType = transactionType;
  else delete next.transactionType;
  if (suggestion.summary) {
    next.summary = suggestion.summary;
    next.summarySource = 'ai';
  }
  return next;
}
