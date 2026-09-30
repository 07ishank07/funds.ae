// Rule-based classifier. Transparent on purpose: every decision can be traced
// to keywords in config/taxonomy.json, so an editor can tune it without code.
//
// Scoring: a keyword in the headline counts double its weight, a keyword only
// in the summary counts its weight once. Each keyword counts once per article.

import { termRegex } from './text.js';

export const FALLBACK_TOPIC = { id: 'general-investment', label: 'Investment' };

export function buildClassifier(taxonomy) {
  const compile = (map = {}) =>
    Object.entries(map).map(([term, weight]) => ({ term, weight: Number(weight) || 0, re: termRegex(term) }));
  return {
    categories: taxonomy.categories,
    topics: taxonomy.topics.map((t) => ({ id: t.id, label: t.label, terms: compile(t.keywords) })),
    generic: compile(taxonomy.genericInvestmentTerms),
    negative: compile(taxonomy.negativeTerms),
    uae: (taxonomy.uaeTerms || []).map((term) => ({ term, re: termRegex(term) })),
    topicLabels: Object.fromEntries([...taxonomy.topics.map((t) => [t.id, t.label]), [FALLBACK_TOPIC.id, FALLBACK_TOPIC.label]]),
    categoryLabels: Object.fromEntries(taxonomy.categories.map((c) => [c.id, c.label]))
  };
}

function scoreTerms(terms, title, body) {
  let score = 0;
  const hits = [];
  for (const t of terms) {
    if (t.re.test(title)) {
      score += t.weight * 2;
      hits.push(t.term);
    } else if (t.re.test(body)) {
      score += t.weight;
      hits.push(t.term);
    }
  }
  return { score, hits };
}

export function uaeScoreFor(classifier, { title, summary, categories = [] }, source) {
  const body = `${summary || ''} ${categories.join(' ')}`;
  let score = source?.region === 'uae' ? 1 : 0;
  const hits = [];
  for (const u of classifier.uae) {
    if (u.re.test(title)) {
      score += 3;
      hits.push(u.term);
    } else if (u.re.test(body)) {
      score += 1;
      hits.push(u.term);
    }
  }
  return { score, hits };
}

/**
 * @returns {{category:string, uaeScore:number, topic:string, topics:string[],
 *            topicScores:Record<string,number>, relevance:number, hits:string[]}}
 */
export function classifyArticle(classifier, article, source, settings) {
  const title = article.title || '';
  const body = `${article.summary || ''} ${(article.categories || []).join(' ')}`;

  const uae = uaeScoreFor(classifier, article, source);
  const category = uae.score >= settings.news.uaeThreshold ? 'uae' : 'world';

  const ranked = classifier.topics
    .map((t) => ({ id: t.id, ...scoreTerms(t.terms, title, body) }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score);

  const generic = scoreTerms(classifier.generic, title, body);
  const negative = scoreTerms(classifier.negative, title, body);
  const relevance = ranked.reduce((sum, t) => sum + t.score, 0) + generic.score + negative.score;

  return {
    category,
    uaeScore: uae.score,
    topic: ranked[0]?.id || FALLBACK_TOPIC.id,
    topics: ranked.slice(0, 3).map((t) => t.id),
    topicScores: Object.fromEntries(ranked.map((t) => [t.id, t.score])),
    relevance,
    hits: [...uae.hits, ...ranked.flatMap((t) => t.hits), ...generic.hits, ...negative.hits]
  };
}
