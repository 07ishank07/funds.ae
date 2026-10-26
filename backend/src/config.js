// Loads and validates everything in backend/config/. Keys that start with "_"
// are documentation for humans and are ignored by the code.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EMAIL_RE } from './validation/validate.js';
import { NEWS_GEOGRAPHIES, NEWS_HOME_SECTIONS, NEWS_LIMITS, NEWS_TRANSACTION_TYPES } from './news/rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(BACKEND_DIR, '..');
export const CONFIG_DIR = path.join(BACKEND_DIR, 'config');
export const DATA_DIR = process.env.FUNDSAE_DATA_DIR || path.join(BACKEND_DIR, 'data');
export const FIXTURES_DIR = path.join(BACKEND_DIR, 'fixtures');
export const API_DIR = process.env.FUNDSAE_API_DIR || path.join(REPO_ROOT, 'api', 'v1');
export const ASSETS_DIR = path.join(REPO_ROOT, 'assets');

export class ConfigError extends Error {}

function stripDocs(value) {
  if (Array.isArray(value)) return value.map(stripDocs);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!k.startsWith('_')) out[k] = stripDocs(v);
    return out;
  }
  return value;
}

export function readJson(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new ConfigError(`Cannot read ${path.relative(REPO_ROOT, file)}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `${path.relative(REPO_ROOT, file)} is not valid JSON (${err.message}). ` +
      'Check for a missing comma, a trailing comma, or an unclosed quote.'
    );
  }
}

const loadConfig = (name) => stripDocs(readJson(path.join(CONFIG_DIR, name)));

const ID_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

// Licensing and scheduling fields for news sources (build guide Part C1 and C5).
export const SOURCE_TIERS = ['L1', 'L2', 'L3', 'L4', 'L5'];
export const LICENSE_STATUSES = ['public_sector', 'wire', 'terms_reviewed', 'permission_granted', 'pending_review', 'blocked'];
const NEWS_FIELDS = new Set([
  'id', 'name', 'homepage', 'type', 'url', 'fixture', 'enabled', 'verified', 'region', 'focus', 'priority',
  'allowImages', 'allowExcerpt', 'tier', 'licenseStatus', 'termsUrl', 'termsReviewedAt', 'language',
  'pollEveryHours', 'notes'
]);
// Likely typos, so a misspelt field gets a pointer instead of being silently ignored.
const FIELD_HINTS = {
  licenceStatus: 'licenseStatus', license: 'licenseStatus', licence: 'licenseStatus', status: 'licenseStatus',
  allowImage: 'allowImages', images: 'allowImages', allowExcerpts: 'allowExcerpt', excerpt: 'allowExcerpt',
  termsURL: 'termsUrl', terms: 'termsUrl', termsReviewed: 'termsReviewedAt', reviewedAt: 'termsReviewedAt',
  lang: 'language', pollHours: 'pollEveryHours', pollEvery: 'pollEveryHours', feed: 'url', link: 'url'
};
// Values used when a (demo) source leaves a field out. Images are opt-in: a publisher's
// feed images are shown only after its terms have been checked.
export const NEWS_SOURCE_DEFAULTS = {
  allowImages: false,
  allowExcerpt: true,
  language: 'en',
  pollEveryHours: 24,
  tier: 'L3',
  licenseStatus: 'pending_review'
};

function isRealPastDate(value, today = new Date()) {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(t).toISOString().slice(0, 10) !== value) return false;
  return t <= Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
}

function validateNewsSourceFields(s, where, { live }) {
  const errors = [];
  for (const key of Object.keys(s)) {
    if (NEWS_FIELDS.has(key)) continue;
    errors.push(FIELD_HINTS[key]
      ? `${where}: unknown field "${key}". Did you mean "${FIELD_HINTS[key]}"?`
      : `${where}: unknown field "${key}". Remove it, or prefix it with "_" if it is a note for people.`);
  }
  if (s.tier === undefined) {
    if (live) errors.push(`${where}: "tier" is required. Use L1 (official), L2 (press-release wire), L3 (publisher RSS), L4 (licensed API) or L5 (paid syndication).`);
  } else if (!SOURCE_TIERS.includes(s.tier)) {
    errors.push(`${where}: "tier" must be one of ${SOURCE_TIERS.join(', ')}.`);
  }
  if (s.licenseStatus === undefined) {
    if (live) errors.push(`${where}: "licenseStatus" is required. Use "pending_review" until you have read the publisher's terms.`);
  } else if (!LICENSE_STATUSES.includes(s.licenseStatus)) {
    errors.push(`${where}: "licenseStatus" must be one of ${LICENSE_STATUSES.join(', ')}.`);
  }
  if (s.licenseStatus === 'terms_reviewed' && !s.termsUrl) {
    errors.push(`${where}: "termsUrl" is required when licenseStatus is "terms_reviewed" (link to the terms you read).`);
  }
  if (['terms_reviewed', 'permission_granted'].includes(s.licenseStatus) && !s.termsReviewedAt) {
    errors.push(`${where}: "termsReviewedAt" (YYYY-MM-DD) is required when licenseStatus is "${s.licenseStatus}".`);
  }
  if (s.licenseStatus === 'blocked' && s.enabled !== false) {
    errors.push(`${where}: a source with licenseStatus "blocked" must have "enabled": false.`);
  }
  if (s.termsUrl !== undefined && !/^https:\/\/[^\s"'<>]+$/.test(String(s.termsUrl))) {
    errors.push(`${where}: "termsUrl" must be a link starting with https://`);
  }
  if (s.termsReviewedAt !== undefined && !isRealPastDate(s.termsReviewedAt)) {
    errors.push(`${where}: "termsReviewedAt" must be a real date written as YYYY-MM-DD, and not in the future.`);
  }
  for (const field of ['enabled', 'verified', 'allowImages', 'allowExcerpt']) {
    if (s[field] !== undefined && typeof s[field] !== 'boolean') {
      errors.push(`${where}: "${field}" must be true or false, without quotes.`);
    }
  }
  if (s.language !== undefined && !/^[a-z]{2}$/.test(String(s.language))) {
    errors.push(`${where}: "language" must be a two-letter code such as "en" or "ar".`);
  }
  if (s.pollEveryHours !== undefined && !(Number.isInteger(s.pollEveryHours) && s.pollEveryHours >= 1 && s.pollEveryHours <= 168)) {
    errors.push(`${where}: "pollEveryHours" must be a whole number from 1 to 168 (one week).`);
  }
  if (s.priority !== undefined && !(Number.isInteger(s.priority) && s.priority >= 1 && s.priority <= 9)) {
    errors.push(`${where}: "priority" must be a whole number from 1 (most authoritative) to 9.`);
  }
  if (s.notes !== undefined && typeof s.notes !== 'string') errors.push(`${where}: "notes" must be text.`);
  if (s.type === 'api' && s.enabled !== false) {
    errors.push(`${where}: "type" "api" has no adapter yet; set "enabled": false until one is added.`);
  }
  return errors;
}

/** Fills in defaults for optional news-source fields (see NEWS_SOURCE_DEFAULTS). */
export function withNewsDefaults(source) {
  return { ...NEWS_SOURCE_DEFAULTS, ...source };
}

export function validateSources(list, kind, { demo }) {
  const errors = [];
  const seen = new Set();
  const newsTypes = ['rss', 'api'];
  const jobTypes = ['rss', 'greenhouse', 'lever', 'ashby'];
  list.forEach((s, i) => {
    const where = `${kind} source #${i + 1} (${s.id || 'no id'})`;
    if (!s.id || !ID_RE.test(s.id)) errors.push(`${where}: "id" must be lowercase letters, numbers and dashes.`);
    if (seen.has(s.id)) errors.push(`${where}: duplicate id.`);
    seen.add(s.id);
    if (!s.name) errors.push(`${where}: missing "name".`);
    const types = kind === 'news' ? newsTypes : jobTypes;
    if (!types.includes(s.type)) errors.push(`${where}: "type" must be one of ${types.join(', ')}.`);
    // Licensing fields are checked on every news source, enabled or not. Live sources must
    // state them; demo sources may leave them out and get NEWS_SOURCE_DEFAULTS.
    if (kind === 'news') errors.push(...validateNewsSourceFields(s, where, { live: !demo }));
    if (s.enabled === false) return;
    if (demo) {
      if (!s.fixture) errors.push(`${where}: demo sources need a "fixture" file.`);
    } else if (s.type === 'rss') {
      if (!/^https:\/\//.test(s.url || '')) errors.push(`${where}: "url" must start with https://`);
    } else if (kind === 'jobs' && (!s.board || /REPLACE/.test(s.board))) {
      errors.push(`${where}: set "board" to the employer's board token, or set enabled to false.`);
    }
    if (kind === 'news') {
      if (!['uae', 'global'].includes(s.region)) errors.push(`${where}: "region" must be "uae" or "global".`);
      if (!['private-markets', 'general-business'].includes(s.focus)) {
        errors.push(`${where}: "focus" must be "private-markets" or "general-business".`);
      }
    }
    if (s.titlePattern) {
      try { new RegExp(s.titlePattern); } catch { errors.push(`${where}: "titlePattern" is not a valid pattern.`); }
    }
  });
  return errors;
}

function validateTaxonomy(taxonomy) {
  const errors = [];
  if (!taxonomy.categories?.length || !taxonomy.topics?.length) {
    errors.push('taxonomy.json: needs "categories" and "topics".');
    return errors;
  }
  const topicIds = new Set(taxonomy.topics.map((t) => t.id));
  const categoryIds = new Set(taxonomy.categories.map((c) => c.id));
  const seen = new Set();
  (taxonomy.sections || []).forEach((s, i) => {
    const where = `taxonomy.json section #${i + 1} (${s.id || 'no id'})`;
    if (!s.id || !ID_RE.test(s.id)) errors.push(`${where}: "id" must be lowercase letters, numbers and dashes.`);
    if (seen.has(s.id)) errors.push(`${where}: duplicate id.`);
    seen.add(s.id);
    if (!s.label) errors.push(`${where}: missing "label".`);
    if (!Array.isArray(s.topics) || !s.topics.length) errors.push(`${where}: "topics" must list at least one topic id.`);
    for (const t of s.topics || []) if (!topicIds.has(t)) errors.push(`${where}: unknown topic "${t}".`);
    if (s.category && !categoryIds.has(s.category)) errors.push(`${where}: unknown category "${s.category}".`);
  });
  return errors;
}

const lengthOk = (value, [min, max]) => typeof value === 'string' && value.trim() === value && value.length >= min && value.length <= max;

function validateKeywords(keywords, where, errors) {
  if (!keywords || typeof keywords !== 'object' || Array.isArray(keywords)) {
    errors.push(`${where}: "keywords" must map each term to a weight, e.g. { "logistics park": 3 }.`);
    return;
  }
  const entries = Object.entries(keywords);
  if (entries.length > NEWS_LIMITS.keywords) errors.push(`${where}: at most ${NEWS_LIMITS.keywords} keywords.`);
  const [minW, maxW] = NEWS_LIMITS.keywordWeight;
  for (const [term, weight] of entries) {
    if (!lengthOk(term, NEWS_LIMITS.keyword) || term !== term.toLowerCase()) {
      errors.push(`${where}: keyword "${term}" must be ${NEWS_LIMITS.keyword[0]}-${NEWS_LIMITS.keyword[1]} lowercase characters.`);
    }
    if (!Number.isInteger(weight) || weight < minW || weight > maxW) errors.push(`${where}: keyword "${term}" needs a weight from ${minW} to ${maxW}.`);
  }
}

/** config/news-taxonomy.json (Capital Types, Asset Classes) plus the geography and transaction keywords in taxonomy.json. */
export function validateNewsTaxonomy(newsTaxonomy, taxonomy = {}) {
  const errors = [];
  const lists = { capitalTypes: 'Capital Type', assetClasses: 'Asset Class' };
  for (const [key, label] of Object.entries(lists)) {
    const list = newsTaxonomy?.[key];
    if (!Array.isArray(list) || !list.length) {
      errors.push(`news-taxonomy.json: "${key}" must list at least one ${label}.`);
      continue;
    }
    const seen = new Set();
    list.forEach((c, i) => {
      const where = `news-taxonomy.json ${label} #${i + 1} (${c.id || 'no id'})`;
      if (!c.id || !ID_RE.test(c.id)) errors.push(`${where}: "id" must be lowercase letters, numbers and dashes.`);
      if (seen.has(c.id)) errors.push(`${where}: duplicate id.`);
      seen.add(c.id);
      if (!lengthOk(c.name, NEWS_LIMITS.categoryName)) errors.push(`${where}: "name" must be ${NEWS_LIMITS.categoryName.join('-')} characters.`);
      if (c.description != null && !lengthOk(c.description, NEWS_LIMITS.categoryDescription)) {
        errors.push(`${where}: "description" must be at most ${NEWS_LIMITS.categoryDescription[1]} characters.`);
      }
      const [minOrder, maxOrder] = NEWS_LIMITS.displayOrder;
      if (!Number.isInteger(c.displayOrder) || c.displayOrder < minOrder || c.displayOrder > maxOrder) {
        errors.push(`${where}: "displayOrder" must be a whole number from ${minOrder} to ${maxOrder}.`);
      }
      validateKeywords(c.keywords, where, errors);
      if (key === 'capitalTypes') {
        if (typeof c.showInNav !== 'boolean') errors.push(`${where}: "showInNav" must be true or false.`);
        if (c.showInNav && !lengthOk(c.navLabel, NEWS_LIMITS.navLabel)) errors.push(`${where}: "navLabel" must be ${NEWS_LIMITS.navLabel.join('-')} characters.`);
      } else if (c.homeSection != null && !NEWS_HOME_SECTIONS.includes(c.homeSection)) {
        errors.push(`${where}: "homeSection" must be one of ${NEWS_HOME_SECTIONS.join(', ')}, or null.`);
      }
    });
  }
  const navItems = (newsTaxonomy?.capitalTypes || []).filter((c) => c.showInNav).length;
  if (navItems > NEWS_LIMITS.navItems) errors.push(`news-taxonomy.json: at most ${NEWS_LIMITS.navItems} Capital Types can show in the category bar (${navItems} do).`);

  const fixed = { geographies: NEWS_GEOGRAPHIES, transactionTypes: NEWS_TRANSACTION_TYPES };
  for (const [key, allowed] of Object.entries(fixed)) {
    const seen = new Set();
    (taxonomy[key] || []).forEach((g, i) => {
      const where = `taxonomy.json ${key} #${i + 1} (${g.id || 'no id'})`;
      if (!allowed.includes(g.id) || g.id === 'uae') errors.push(`${where}: "id" must be one of ${allowed.filter((id) => id !== 'uae').join(', ')}.`);
      if (seen.has(g.id)) errors.push(`${where}: duplicate id.`);
      seen.add(g.id);
      validateKeywords(g.keywords, where, errors);
    });
  }
  return errors;
}

// Safe defaults so an older settings.json keeps working.
const SETTINGS_DEFAULTS = {
  // "file": config/sponsors.json, events.json and content.json are edited by hand.
  // "sanity": they are written by `npm run cms:pull` from the Sanity Studio (studio/).
  content: { source: 'file' },
  events: { maxPublished: 50, keepPastDays: 30 },
  employers: { maxPublished: 20 },
  submissions: {
    enabled: true,
    retentionDays: 180,
    demoMaxPerKind: 500,
    maxBodyBytes: 16384,
    writeRatePerMinute: 5,
    writeRatePerHour: 30
  }
};

// The news review queue (docs/NEWS-REVIEW-GUIDE.md). Merged one level deep into settings.news.
const NEWS_SETTINGS_DEFAULTS = {
  // store: "file" keeps the queue in backend/data (demo mode and tests); "sanity" keeps it in the Sanity Studio.
  // approverIds: Sanity user ids allowed to approve and publish (equals studio NEWS_APPROVER_IDS); empty = nobody.
  review: {
    store: 'file',
    approverIds: [],
    pendingTtlDays: 30,
    rejectedTtlDays: 45,
    lastSeenThrottleHours: 12,
    documentBudget: { warnAt: 8000, stopCreatesAt: 9500 }
  },
  // Where sources.news.json and news-taxonomy.json come from: "file" (edited by hand) or "sanity" (cms:pull).
  registry: { source: 'file' },
  publish: { maxStories: 200, maxPerCategory: 100, maxArchive: 2000, maxDropPercent: 50 }
};
const SANITY_USER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
const isWhole = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

export function applyNewsSettings(settings) {
  const news = (settings.news = settings.news || {});
  for (const [key, defaults] of Object.entries(NEWS_SETTINGS_DEFAULTS)) news[key] = { ...defaults, ...(news[key] || {}) };
  news.review.documentBudget = { ...NEWS_SETTINGS_DEFAULTS.review.documentBudget, ...(news.review.documentBudget || {}) };
  if (process.env.FUNDSAE_NEWS_STORE) news.review.store = process.env.FUNDSAE_NEWS_STORE;
  if (process.env.FUNDSAE_NEWS_REGISTRY) news.registry.source = process.env.FUNDSAE_NEWS_REGISTRY;

  const errors = [];
  const { review, registry, publish } = news;
  if (!['file', 'sanity'].includes(review.store)) errors.push('"news.review.store" must be "file" or "sanity".');
  if (!['file', 'sanity'].includes(registry.source)) errors.push('"news.registry.source" must be "file" or "sanity".');
  if (!Array.isArray(review.approverIds) || review.approverIds.some((id) => typeof id !== 'string' || !SANITY_USER_ID_RE.test(id))) {
    errors.push('"news.review.approverIds" must be a list of Sanity user ids (letters, numbers, dots, dashes, underscores).');
  }
  if (!isWhole(review.pendingTtlDays, settings.news.maxAgeDays + 1, 365)) {
    errors.push(`"news.review.pendingTtlDays" must be a whole number from ${settings.news.maxAgeDays + 1} (more than news.maxAgeDays, so a pruned story is never imported again) to 365.`);
  }
  if (!isWhole(review.rejectedTtlDays, settings.news.maxAgeDays + 1, 365)) {
    errors.push(`"news.review.rejectedTtlDays" must be a whole number from ${settings.news.maxAgeDays + 1} to 365.`);
  }
  if (!isWhole(review.lastSeenThrottleHours, 1, 168)) errors.push('"news.review.lastSeenThrottleHours" must be a whole number from 1 to 168.');
  const { warnAt, stopCreatesAt } = review.documentBudget;
  if (!isWhole(warnAt, 1, 1_000_000) || !isWhole(stopCreatesAt, 1, 1_000_000) || warnAt > stopCreatesAt) {
    errors.push('"news.review.documentBudget" needs whole numbers with warnAt <= stopCreatesAt.');
  }
  if (!isWhole(publish.maxArchive, 1, 20_000)) errors.push('"news.publish.maxArchive" must be a whole number from 1 to 20000.');
  if (!isWhole(publish.maxDropPercent, 1, 100)) errors.push('"news.publish.maxDropPercent" must be a whole number from 1 to 100.');
  if (errors.length) throw new ConfigError('settings.json: ' + errors.join(' '));
}

/**
 * Adds a contact address to the user-agent, inside the bracketed comment when there is one:
 * "Mozilla/5.0 (compatible; FundsAeNewsBot/1.0; +https://funds.ae/about; news@funds.ae)".
 * The SEC asks automated clients to name a contact and may block requests that don't.
 */
export function withContact(userAgent, email) {
  if (!email || userAgent.includes(email)) return userAgent;
  return userAgent.endsWith(')') ? `${userAgent.slice(0, -1)}; ${email})` : `${userAgent} ${email}`;
}

export function loadSettings() {
  const settings = loadConfig('settings.json');
  for (const [key, defaults] of Object.entries(SETTINGS_DEFAULTS)) settings[key] = { ...defaults, ...(settings[key] || {}) };
  const envMode = process.env.FUNDSAE_MODE;
  if (envMode) settings.mode = envMode;
  if (process.env.FUNDSAE_CONTENT_SOURCE) settings.content.source = process.env.FUNDSAE_CONTENT_SOURCE;
  if (!['file', 'sanity'].includes(settings.content.source)) {
    throw new ConfigError('settings.json: "content.source" must be "file" or "sanity".');
  }
  if (!['demo', 'live'].includes(settings.mode)) {
    throw new ConfigError('settings.json: "mode" must be "demo" or "live".');
  }
  applyNewsSettings(settings);
  // The environment wins so a deployment can set the address without editing the file.
  const contactEmail = String(process.env.FUNDSAE_CONTACT_EMAIL ?? settings.contactEmail ?? '').trim();
  if (contactEmail && !EMAIL_RE.test(contactEmail)) {
    throw new ConfigError('settings.json: "contactEmail" (or FUNDSAE_CONTACT_EMAIL) must be an email address, or empty.');
  }
  settings.contactEmail = contactEmail;
  settings.userAgent = withContact(String(settings.userAgent || ''), contactEmail);
  return settings;
}

const SEC_HOST = /(^|\.)sec\.gov$/i;

/** Problems that don't stop a run but will cost sources. Returned by loadAll as `warnings`. */
function configWarnings({ settings, demo, newsSources }) {
  const warnings = [];
  const sec = newsSources.filter((s) => s.enabled !== false && s.url && SEC_HOST.test(new URL(s.url).hostname));
  if (!demo && sec.length && !settings.contactEmail) {
    warnings.push(
      `${sec.length} enabled SEC source(s) (${sec.map((s) => s.id).join(', ')}) but no contact email: ` +
      'the SEC may block requests. Set "contactEmail" in settings.json or FUNDSAE_CONTACT_EMAIL.'
    );
  }
  return warnings;
}

export function loadAll() {
  const settings = loadSettings();
  const demo = settings.mode === 'demo';

  const newsCfg = loadConfig('sources.news.json');
  const jobsCfg = loadConfig('sources.jobs.json');
  const taxonomy = loadConfig('taxonomy.json');
  const newsTaxonomy = loadConfig('news-taxonomy.json');
  const manualJobs = loadConfig('jobs.manual.json');
  const eventsConfig = loadConfig('events.json');

  const rawNewsSources = (demo ? newsCfg.demoSources : newsCfg.sources) || [];
  const jobSources = (demo ? jobsCfg.demoSources : jobsCfg.sources) || [];

  // Validate what the file says, then fill defaults: a live source that omits a required
  // licensing field must fail here, not silently inherit a default.
  const errors = [
    ...validateSources(rawNewsSources, 'news', { demo }),
    ...validateSources(jobSources, 'jobs', { demo }),
    ...validateTaxonomy(taxonomy),
    ...validateNewsTaxonomy(newsTaxonomy, taxonomy)
  ];
  if (errors.length) throw new ConfigError('Configuration problems:\n  - ' + errors.join('\n  - '));
  const newsSources = rawNewsSources.map(withNewsDefaults);

  return {
    settings,
    demo,
    warnings: configWarnings({ settings, demo, newsSources }),
    newsSources: newsSources.filter((s) => s.enabled !== false),
    allNewsSources: newsSources,
    jobSources: jobSources.filter((s) => s.enabled !== false),
    allJobSources: jobSources,
    taxonomy,
    newsTaxonomy,
    eventsConfig,
    // Listings marked demoOnly are examples and never appear in live mode.
    manualJobs: (manualJobs.jobs || []).filter((j) => demo || !j.demoOnly)
  };
}

export function loadSponsorsConfig() {
  return stripDocs(readJson(path.join(CONFIG_DIR, 'sponsors.json')));
}
