// Suggests Capital Types, Asset Classes, geography and a transaction type for a story,
// with a confidence score. Rule-based and transparent like classify.js: every suggestion
// traces back to keywords in config/news-taxonomy.json (editable in the Studio) and
// config/taxonomy.json (geographies, transactionTypes).
//
// These are suggestions. An editor confirms or changes every tag before a story is
// published. A story the rules cannot place is left unclassified and flagged for review,
// never forced into a category.

import { termRegex } from './text.js';
import { scoreTerms } from './classify.js';

const ASSIGN_AT = 3; // a strong keyword anywhere, or a weaker one in the headline
const CONFIDENT_AT = 6; // a strong keyword in the headline, or two in the summary
const MAX_PER_DIMENSION = 4;
const REVIEW_BELOW = 0.4;
const EXPLANATION_MAX = 500;

const compile = (map = {}) =>
  Object.entries(map).map(([term, weight]) => ({ term, weight: Number(weight) || 0, re: termRegex(term) }));

export function buildTaxonomyClassifier(newsTaxonomy, taxonomy = {}) {
  const group = (list = []) => list.map((c) => ({ id: c.id, terms: compile(c.keywords) }));
  // Capital Type phrases are blanked out before Asset Classes are scored, so a "family office"
  // never reads as an office building and a "REIT" name never as its property type.
  const capitalPhrases = (newsTaxonomy.capitalTypes || [])
    .flatMap((c) => Object.keys(c.keywords || {}))
    .sort((a, b) => b.length - a.length)
    .map((term) => new RegExp(termRegex(term).source, 'gi'));
  return {
    capitalPhrases,
    capitalTypes: group(newsTaxonomy.capitalTypes),
    assetClasses: group(newsTaxonomy.assetClasses),
    geographies: group(taxonomy.geographies),
    transactionTypes: group(taxonomy.transactionTypes)
  };
}

/** Groups scoring at least ASSIGN_AT, best first; ties keep the configured order. */
function rank(groups, title, body) {
  return groups
    .map((g) => ({ id: g.id, ...scoreTerms(g.terms, title, body) }))
    .filter((g) => g.score >= ASSIGN_AT)
    .sort((a, b) => b.score - a.score);
}

const confidenceOf = (ranked) => (ranked.length ? Math.min(1, ranked[0].score / CONFIDENT_AT) : 0);
const round2 = (n) => Math.round(n * 100) / 100;
const explain = (label, ranked) => (ranked.length ? `${label}: ${ranked.map((r) => `${r.id} (${r.hits.join(', ')})`).join('; ')}` : '');

/**
 * @param {ReturnType<typeof buildTaxonomyClassifier>} tc
 * @param {{title:string, summary?:string, categories?:string[]}} item
 * @param {{uae?:boolean}} opts  uae: the story's UAE score reached news.uaeThreshold (classify.js)
 */
export function classifyTaxonomy(tc, item, { uae = false } = {}) {
  const title = item.title || '';
  const body = `${item.summary || ''} ${(item.categories || []).join(' ')}`;
  const capital = rank(tc.capitalTypes, title, body).slice(0, MAX_PER_DIMENSION);
  const withoutCapital = (text) => tc.capitalPhrases.reduce((t, re) => t.replace(re, '$1 '), text);
  const asset = rank(tc.assetClasses, withoutCapital(title), withoutCapital(body)).slice(0, MAX_PER_DIMENSION);
  const regions = rank(tc.geographies, title, body).map((g) => g.id);
  const specific = regions.filter((id) => id !== 'global');
  // "Global" only when nothing more specific matched.
  const geography = uae ? ['uae', ...specific] : specific.length ? specific : regions;
  const transaction = rank(tc.transactionTypes, title, body)[0] || null;

  const capitalConfidence = confidenceOf(capital);
  const assetConfidence = confidenceOf(asset);
  const confidence = capital.length && asset.length
    ? Math.min(capitalConfidence, assetConfidence)
    : Math.max(capitalConfidence, assetConfidence) * 0.6;

  const reasons = [];
  if (!capital.length) reasons.push('No Capital Type matched.');
  if (!asset.length) reasons.push('No Asset Class matched.');
  if (confidence < REVIEW_BELOW) reasons.push(`Low confidence (${round2(confidence)}).`);

  const explanation = [explain('Capital', capital), explain('Asset', asset), transaction ? explain('Deal', [transaction]) : '']
    .filter(Boolean)
    .join(' | ')
    .slice(0, EXPLANATION_MAX);

  return {
    capitalTypes: capital.map((c) => c.id),
    assetClasses: asset.map((a) => a.id),
    geography,
    transactionType: transaction?.id || null,
    confidence: round2(confidence),
    needsReview: (!capital.length && !asset.length) || confidence < REVIEW_BELOW,
    reasons,
    explanation,
    // Review-queue order: real estate deals first (a deal, an asset class, a capital type).
    priority: (transaction ? 2 : 0) + (asset.length ? 2 : 0) + (capital.length ? 1 : 0),
    method: 'rules'
  };
}
