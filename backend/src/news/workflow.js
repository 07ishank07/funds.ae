// The backend's copy of the parts of studio/schemaTypes/newsWorkflow.js that the
// publisher needs: the approval hash and the publish checks. backend/test/cms.test.js
// runs both copies over the same stories and fails if they ever disagree, so change
// them together. The workflow actions themselves (planAction) live only in the Studio.

import { NEWS_APPROVAL_HASH_FIELDS, NEWS_LIMITS, NEWS_SLUG_PATTERN, PUBLISHABLE_LICENSE_STATUSES } from './rules.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const refIds = (list) => (Array.isArray(list) ? list.map((r) => r?._ref).filter(Boolean).sort() : []);
const isoOrNull = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

/** 64-bit FNV-1a over UTF-16 code units, as 16 hex characters. A change detector, not a signature. */
export function fnv1a64(input) {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/** The approved content in a fixed shape, so equal content always gives an equal hash. */
export function approvalFingerprint(doc = {}) {
  const normalise = {
    headline: () => text(doc.headline),
    slug: () => text(doc.slug?.current),
    summary: () => text(doc.summary),
    // Who wrote the summary: the site holds AI-written summaries from sources that do not allow them.
    summarySource: () => text(doc.summarySource) || null,
    capitalTypes: () => refIds(doc.capitalTypes),
    assetClasses: () => refIds(doc.assetClasses),
    geography: () => (Array.isArray(doc.geography) ? [...doc.geography].map(String).sort() : []),
    transactionType: () => text(doc.transactionType) || null,
    featured: () => doc.featured === true,
    image: () =>
      doc.image?.asset?._ref
        ? { asset: doc.image.asset._ref, credit: text(doc.image.credit), rightsConfirmed: doc.image.rightsConfirmed === true }
        : null,
    seo: () => ({ title: text(doc.seo?.title), description: text(doc.seo?.description) }),
    duplicateOf: () => doc.duplicateOf?._ref || null,
    publishedAt: () => isoOrNull(doc.publishedAt)
  };
  return Object.fromEntries(NEWS_APPROVAL_HASH_FIELDS.map((field) => [field, normalise[field]()]));
}

export function approvalHash(doc) {
  return fnv1a64(JSON.stringify(approvalFingerprint(doc)));
}

const between = (value, [min, max]) => value.length >= min && value.length <= max;

/**
 * Why a story cannot go on the site, in plain language (empty = it can).
 * sourceLicenseStatus is the licenseStatus of the story's source in config/sources.news.json.
 */
export function publishBlockers(doc = {}, { sourceLicenseStatus } = {}) {
  const reasons = [];
  const [hMin, hMax] = NEWS_LIMITS.headline;
  const [sMin, sMax] = NEWS_LIMITS.summary;
  if (!between(text(doc.headline), NEWS_LIMITS.headline)) reasons.push(`The headline must be ${hMin}-${hMax} characters.`);
  if (!between(text(doc.summary), NEWS_LIMITS.summary)) reasons.push(`Write a summary of ${sMin}-${sMax} characters.`);
  if (text(doc.excerpt).length > NEWS_LIMITS.excerpt[1]) reasons.push('The publisher excerpt is longer than 280 characters.');
  const slug = text(doc.slug?.current);
  if (!slug || !NEWS_SLUG_PATTERN.test(slug) || !between(slug, NEWS_LIMITS.slug)) {
    reasons.push('The web address (slug) must be 3-96 lowercase letters, numbers and single dashes.');
  }
  if (!/^https?:\/\//i.test(text(doc.originalUrl))) reasons.push('The link to the original article is missing.');
  if (!text(doc.sourceName)) reasons.push('The source name is missing.');
  if (!PUBLISHABLE_LICENSE_STATUSES.includes(sourceLicenseStatus)) {
    reasons.push(
      `The source's licence status is "${sourceLicenseStatus || 'unknown'}". Stories can only be published from sources ` +
        `whose terms are cleared (${PUBLISHABLE_LICENSE_STATUSES.join(', ')}).`
    );
  }
  if (doc.image?.asset?._ref) {
    if (doc.image.rightsConfirmed !== true) reasons.push('Confirm that you have the rights to the image, or remove it.');
    if (!between(text(doc.image.credit), NEWS_LIMITS.imageCredit)) reasons.push('Add an image credit (who owns the picture).');
  }
  if (doc.duplicateOf?._ref) reasons.push('This story is marked as a duplicate of another one. Clear "Duplicate of" or reject it.');
  return reasons;
}

/** A web address for the story: the headline in lowercase words plus 4 characters of its id, e.g. "adia-buys-...-3f2a". */
export function suggestSlug(doc = {}) {
  const words = text(doc.headline)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let base = words.slice(0, 80);
  if (words.length > 80 && base.includes('-')) base = base.slice(0, base.lastIndexOf('-'));
  const suffix = /^a_[0-9a-f]{4}/.test(doc.articleId || '') ? doc.articleId.slice(2, 6) : fnv1a64(text(doc.headline)).slice(0, 4);
  return `${base || 'story'}-${suffix}`;
}
