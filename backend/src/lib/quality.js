// Quality controls applied before an article is stored.
// Relevance (is it about private markets?) is scored in classify.js; this file
// handles everything that can be decided from the item's shape and labels.

import { escapeRegExp } from './text.js';
import { isHttpUrl } from './url.js';

function compileFilter(f = {}) {
  const prefix = (f.titlePrefix || []).map(escapeRegExp).join('|');
  const contains = (f.titleContains || []).map(escapeRegExp).join('|');
  return {
    prefixRe: prefix ? new RegExp(`^\\s*(${prefix})\\s*[:|–—-]`, 'i') : null,
    containsRe: contains ? new RegExp(`(^|[^a-z])(${contains})([^a-z]|$)`, 'i') : null,
    urlSegments: new Set((f.urlSegments || []).map((s) => s.toLowerCase())),
    categories: new Set((f.categories || []).map((s) => s.toLowerCase()))
  };
}

export function buildQualityRules(taxonomy) {
  const f = taxonomy.filters || {};
  return {
    opinion: compileFilter(f.opinion),
    nonArticle: compileFilter(f.nonArticle),
    advertorial: compileFilter(f.advertorial),
    pressRelease: compileFilter(f.pressRelease)
  };
}

function matches(rule, { title, url, categories }) {
  if (rule.prefixRe?.test(title)) return true;
  if (rule.containsRe?.test(title)) return true;
  if (rule.urlSegments.size && url) {
    try {
      const segments = new URL(url).pathname.toLowerCase().split('/').filter(Boolean);
      if (segments.some((s) => rule.urlSegments.has(s))) return true;
    } catch { /* invalid URLs are rejected elsewhere */ }
  }
  if (rule.categories.size && categories?.some((c) => rule.categories.has(c.toLowerCase()))) return true;
  return false;
}

/**
 * @returns {{ok:true} | {ok:false, reason:string}}
 */
export function assessQuality(rules, item, settings, now = new Date()) {
  if (!item.title || item.title.length < 12) return { ok: false, reason: 'missing-title' };
  if (!item.link) return { ok: false, reason: 'missing-link' };
  if (!isHttpUrl(item.link)) return { ok: false, reason: 'invalid-link' };

  const maxAgeMs = settings.news.maxAgeDays * 86_400_000;
  if (item.publishedAt && now - item.publishedAt > maxAgeMs) return { ok: false, reason: 'too-old' };

  const probe = { title: item.title, url: item.link, categories: item.categories };
  if (matches(rules.advertorial, probe)) return { ok: false, reason: 'advertorial' };
  if (matches(rules.nonArticle, probe)) return { ok: false, reason: 'not-an-article' };
  if (settings.news.excludeOpinion && matches(rules.opinion, probe)) return { ok: false, reason: 'opinion' };
  if (settings.news.excludePressReleases && matches(rules.pressRelease, probe)) return { ok: false, reason: 'press-release' };
  return { ok: true };
}

export function isPressRelease(rules, item) {
  return matches(rules.pressRelease, { title: item.title, url: item.link, categories: item.categories });
}
