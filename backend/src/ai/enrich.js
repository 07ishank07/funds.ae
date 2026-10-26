// Optional AI suggestions for the review queue (settings.json news.ai, off by default).
//
// For each new story it asks Claude, through the official SDK, for a short factual summary written
// from the headline and the publisher's excerpt only, plus Capital Type, Asset Class, geography and
// transaction-type suggestions with a confidence score. It runs only when:
//   - news.ai.enabled is true and ANTHROPIC_API_KEY is set;
//   - the story's source allows it (allowAiSummary: many publishers' terms forbid AI summaries);
//   - fewer than news.ai.maxPerRun stories have been enriched in this run.
// The result is a suggestion stored on the pending story. An editor approves, edits or rejects it
// before anything is published. A summary longer than 280 characters, one that copies 8 or more
// consecutive words of the publisher's text, or one that repeats the headline is discarded. Any
// failure leaves the rule-based suggestions in place. Each request has a time limit and the whole
// run a time budget, so a slow API never costs the hour's ingest.

import { log } from '../lib/logger.js';
import { NEWS_GEOGRAPHIES, NEWS_LIMITS, NEWS_TRANSACTION_TYPES } from '../news/rules.js';

export const AI_DEFAULTS = { enabled: false, model: 'claude-opus-5-5', effort: 'low', maxPerRun: 40 };
export const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const COPY_LIMIT = 8;
const REQUEST_TIMEOUT_MS = 60_000;
const RUN_BUDGET_MS = 5 * 60_000; // News ingest has 15 minutes in all
// Models that accept server-side refusal fallbacks in their "default" form.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

const SYSTEM = [
  'You help the editors of funds.ae, a news site about private capital and real estate investment in the UAE and worldwide.',
  'You receive one news item: its headline, the publisher\'s short excerpt and the publisher\'s name. That is all you know about it.',
  'Write a factual summary of at most 240 characters in your own words, using only facts stated in the headline or excerpt.',
  'Do not add facts, figures, opinions or context that are not there, and do not copy phrases of eight or more words.',
  'Then choose the categories that clearly apply, from the allowed ids only. Choose none when the item does not say;',
  'never guess. Capital Types are who provides the capital; Asset Classes are the real estate or infrastructure assets',
  'invested in. Set confidence from 0 to 1 for how clearly the item supports your categories.'
].join(' ');

function schemaFor(newsTaxonomy) {
  const ids = (list) => (list || []).map((c) => c.id);
  return {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      capitalTypes: { type: 'array', items: { type: 'string', enum: ids(newsTaxonomy.capitalTypes) } },
      assetClasses: { type: 'array', items: { type: 'string', enum: ids(newsTaxonomy.assetClasses) } },
      geography: { type: 'array', items: { type: 'string', enum: NEWS_GEOGRAPHIES } },
      transactionType: { type: 'string', enum: [...NEWS_TRANSACTION_TYPES, 'none'] },
      confidence: { type: 'number' }
    },
    required: ['summary', 'capitalTypes', 'assetClasses', 'geography', 'transactionType', 'confidence'],
    additionalProperties: false
  };
}

const wordsOf = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/** The longest run of consecutive words the summary shares with the source text. */
export function longestCopiedRun(summary, source) {
  const s = wordsOf(summary);
  const t = wordsOf(source);
  let best = 0;
  const prev = new Array(t.length + 1).fill(0);
  for (let i = 1; i <= s.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= t.length; j++) {
      const above = prev[j];
      prev[j] = s[i - 1] === t[j - 1] ? diagonal + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diagonal = above;
    }
  }
  return best;
}

/** Whether AI suggestions are switched on for this run. */
export function aiEnabled(settings, env = process.env) {
  return settings.news.ai?.enabled === true && Boolean(String(env.ANTHROPIC_API_KEY || '').trim());
}

/**
 * Validates Claude's answer against the taxonomy and the legal limits. Returns null when nothing usable came back.
 * @returns {{summary:string|null, capitalTypes:string[], assetClasses:string[], geography:string[], transactionType:string|null, confidence:number}|null}
 */
export function cleanSuggestion(raw, { newsTaxonomy, headline, excerpt }) {
  if (!raw || typeof raw !== 'object') return null;
  const known = (list, allowed) => [...new Set((Array.isArray(list) ? list : []).filter((id) => allowed.includes(id)))];
  let summary = typeof raw.summary === 'string' ? raw.summary.replace(/\s+/g, ' ').trim() : '';
  const [minLength, maxLength] = NEWS_LIMITS.summary;
  if (summary.length < minLength || summary.length > maxLength) summary = '';
  if (summary && longestCopiedRun(summary, `${headline} ${excerpt}`) >= COPY_LIMIT) summary = '';
  if (summary && wordsOf(summary).join(' ') === wordsOf(headline).join(' ')) summary = '';
  const confidence = Number(raw.confidence);
  return {
    summary: summary || null,
    capitalTypes: known(raw.capitalTypes, (newsTaxonomy.capitalTypes || []).map((c) => c.id)),
    assetClasses: known(raw.assetClasses, (newsTaxonomy.assetClasses || []).map((a) => a.id)),
    geography: known(raw.geography, NEWS_GEOGRAPHIES),
    transactionType: NEWS_TRANSACTION_TYPES.includes(raw.transactionType) ? raw.transactionType : null,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, Math.round(confidence * 100) / 100)) : 0
  };
}

/**
 * @param {{settings:object, newsTaxonomy:object, client?:object, env?:object, clock?:()=>number}} o
 *   client: an Anthropic client (tests pass a stand-in); created from the SDK when omitted.
 * @returns {Promise<{enrich:(article:object)=>Promise<object|null>, stats:object}>}
 */
export async function createEnricher({ settings, newsTaxonomy, client, env = process.env, clock = Date.now }) {
  const cfg = { ...AI_DEFAULTS, ...(settings.news.ai || {}) };
  if (!client) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: REQUEST_TIMEOUT_MS });
  }
  const startedAt = clock();
  const schema = schemaFor(newsTaxonomy);
  const stats = { requested: 0, used: 0, refused: 0, failed: 0, summariesDropped: 0, outOfTime: false };
  let stopped = false;

  function failed(article, detail) {
    stats.failed++;
    log.warn('news.ai.failed', { article: article.articleId, status: null, detail });
    return null;
  }

  async function enrich(article) {
    if (stopped || stats.requested >= cfg.maxPerRun) return null;
    if (clock() - startedAt > RUN_BUDGET_MS) {
      if (!stats.outOfTime) log.warn('news.ai.out-of-time', { budgetMinutes: RUN_BUDGET_MS / 60_000, requested: stats.requested });
      stats.outOfTime = true;
      return null;
    }
    stats.requested++;
    const fallback = FALLBACK_MODELS.has(cfg.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
    try {
      const response = await client.beta.messages.create({
        model: cfg.model,
        max_tokens: 16000,
        ...fallback,
        output_config: { effort: cfg.effort, format: { type: 'json_schema', schema } },
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: `Publisher: ${article.sourceName}\nHeadline: ${article.title}\nExcerpt: ${article.summary || '(none)'}`
        }]
      });
      if (response.stop_reason === 'refusal') {
        stats.refused++;
        log.warn('news.ai.refused', { article: article.articleId, category: response.stop_details?.category || null });
        return null;
      }
      // Model output never goes into the logs (run history is public): only fixed messages.
      if (response.stop_reason === 'max_tokens') return failed(article, 'the answer was cut off (max_tokens)');
      const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      let raw;
      try { raw = JSON.parse(text); } catch { return failed(article, 'the answer was not valid JSON'); }
      const suggestion = cleanSuggestion(raw, { newsTaxonomy, headline: article.title, excerpt: article.summary });
      if (!suggestion) return failed(article, 'the answer had an unexpected shape');
      if (!suggestion.summary) stats.summariesDropped++;
      stats.used++;
      return suggestion;
    } catch (err) {
      stats.failed++;
      // Status and message only: nothing of the article or the key goes into the log.
      log.warn('news.ai.failed', { article: article.articleId, status: err?.status || null, detail: String(err?.message || err).slice(0, 200) });
      if (err?.status === 401 || err?.status === 403) stopped = true; // a bad key fails every request: stop for this run
      return null;
    }
  }

  return { enrich, stats };
}
