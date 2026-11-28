// Content pipeline: config/content.json -> validate -> api/v1/content.json.
//
// content.json holds the editorial content managed in Sanity (studio/):
//   socialHighlights  the home page "Top Tweets" box
//   advertiseTiers    the package cards on the Advertise page
//   pages             About, Privacy and Terms body copy
//   hero              the home page hero banner (one, or none: the page keeps its built-in banner)
//   grants            Grants & Funding: the funding types (tiles) and programmes (cards); none keeps the built-in page
//   banners           reusable banners (Finance Careers banner, Grants & Funding card); none keeps the built-in ones
//   settings          site settings: the pinned Top UAE Story and the footer tagline; none keeps today's behaviour
// `npm run cms:pull` writes it from Sanity; it can also be edited by hand.
//
// Invalid content fails the step with a plain-language message and the
// previous api/v1/content.json stays live (same behaviour as sponsors).
// The limits mirror studio/schemaTypes/rules.js (test/cms.test.js checks they match).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, readJson } from '../config.js';
import { log } from '../lib/logger.js';
import { ADVERTISE_PLACEMENTS, BANNER_PLACEMENTS, BANNER_TARGETS, FUNDING_KINDS, FUNDING_PLACES, FUNDING_TYPE_IDS, HERO_BUTTON_TARGETS, HERO_STYLES, PAGE_BLOCK_TYPES, PAGE_LIST_TYPES, PAGE_SLUGS, RETIRED_ADVERTISING_TIERS } from '../contracts/models.js';
import { toAdvertiseTierDto, toBannerDto, toSiteSettingsDto, toFundingProgrammeDto, toFundingTypeDto, toHeroDto, toPageDto, toSocialHighlightDto } from '../contracts/serializers.js';
import { EMAIL_RE, cleanInline, cleanText, rules, validate } from '../validation/validate.js';
import { isSafePublicUrl } from '../lib/http.js';

const { id, text, httpsUrl, enumOf, isoDate, bool, wholeNumber } = rules;

export const CONTENT_LIMITS = {
  highlights: { maxItems: 5, accountName: [2, 40], handle: [2, 16], text: [10, 140], initials: [1, 3] },
  tiers: { maxItems: 4, name: [2, 40], badge: [2, 20], price: [2, 30], priceNote: [2, 40], duration: [2, 40], features: 8, feature: [2, 120], ctaLabel: [2, 30], placementDetail: [2, 120] },
  pages: { title: [2, 80], intro: [0, 400], blocks: 120, blockText: 2000 },
  hero: { eyebrow: [2, 60], title: [8, 80], highlight: [0, 30], subtitle: [0, 240], imageAlt: [0, 140], buttonLabel: [2, 30], button2Label: [2, 30], imageMaxBytes: 1572864 },
  grants: { typeTitle: [2, 40], typeDescription: [2, 80], maxProgrammes: 100, provider: [2, 70], description: [20, 200], types: [1, 3] },
  banners: { eyebrow: [2, 40], title: [8, 80], text: [0, 160], buttonLabel: [2, 30], imageAlt: [0, 140], credit: [2, 160], imageMaxBytes: 1572864 },
  settings: { footerTagline: [2, 60] }
};

const HEX = /^#[0-9a-f]{6}$/i;
const POST_URL = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,25}(?:[/?#].*)?$/;
const L = CONTENT_LIMITS;

/* --------------------------------- rules ---------------------------------- */

const pattern = (rule, re, message) => (raw, ctx) => {
  const out = rule(raw, ctx);
  return out.error || out.value === null || re.test(out.value) ? out : { error: message };
};

/** Like sponsors.json: an item without "enabled" is shown. */
const enabledFlag = () => (raw) => {
  if (raw === undefined || raw === null) return { value: true };
  return typeof raw === 'boolean' ? { value: raw } : { error: 'Use true or false.' };
};

const hexColor = () => (raw) => {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  return typeof raw === 'string' && HEX.test(raw) ? { value: raw.toUpperCase() } : { error: 'Use a colour like #137A72.' };
};

const stringList = ({ min, max, itemMin, itemMax }) => (raw) => {
  if (!Array.isArray(raw)) return { error: 'Give a list of lines.' };
  const value = raw.map((s) => (typeof s === 'string' ? cleanText(s) : ''));
  if (value.length < min || value.length > max) return { error: `Give ${min} to ${max} lines.` };
  const bad = value.findIndex((s) => s.length < itemMin || s.length > itemMax);
  if (bad !== -1) return { error: `Line ${bad + 1} must be ${itemMin} to ${itemMax} characters.` };
  return { value };
};

/** Optional list of lines (missing = none). */
const optionalStringList = (opts) => {
  const rule = stringList(opts);
  return (raw) => (raw === undefined || raw === null ? { value: [] } : rule(raw));
};

/** A package's home page placements: [{ placement, enabled, detail }], each placement type at most once. */
const placementList = () => (raw) => {
  if (raw === undefined || raw === null) return { value: [] };
  if (!Array.isArray(raw)) return { error: 'Give a list of placements.' };
  const seen = new Set();
  const value = [];
  for (const [i, p] of raw.entries()) {
    const where = `Placement ${i + 1}`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { error: `${where}: must be an object.` };
    const unknown = Object.keys(p).filter((k) => !['placement', 'enabled', 'detail'].includes(k));
    if (unknown.length) return { error: `${where}: unknown field "${unknown[0]}".` };
    if (!ADVERTISE_PLACEMENTS.includes(p.placement)) return { error: `${where}: choose one of ${ADVERTISE_PLACEMENTS.join(', ')}.` };
    if (seen.has(p.placement)) return { error: `${where}: ${p.placement} is listed twice.` };
    seen.add(p.placement);
    if (p.enabled !== undefined && p.enabled !== null && typeof p.enabled !== 'boolean') return { error: `${where}: "enabled" must be true or false.` };
    const detail = typeof p.detail === 'string' ? cleanText(p.detail) : '';
    const [min, max] = L.tiers.placementDetail;
    if (detail.length < min || detail.length > max) return { error: `${where}: the description must be ${min} to ${max} characters.` };
    value.push({ placement: p.placement, enabled: p.enabled !== false, detail });
  }
  return { value };
};

/** A link inside page copy: public https, or mailto with one valid address. */
export function safeHref(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (/^mailto:/i.test(value)) {
    const address = decodeURIComponentSafe(value.slice(7).split('?')[0]);
    return address && EMAIL_RE.test(address) ? `mailto:${address}` : null;
  }
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && isSafePublicUrl(u.toString()) ? u.toString() : null;
  } catch {
    return null;
  }
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return null; }
}

/** Validates the safe Portable Text subset produced by src/cms/mapping.js (or written by hand). */
const pageBlocks = () => (raw) => {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Add at least one paragraph.' };
  if (raw.length > L.pages.blocks) return { error: `Use ${L.pages.blocks} blocks or fewer.` };
  const blocks = [];
  for (const [i, b] of raw.entries()) {
    const where = `Block ${i + 1}`;
    if (!b || typeof b !== 'object' || !PAGE_BLOCK_TYPES.includes(b.type)) return { error: `${where}: type must be one of ${PAGE_BLOCK_TYPES.join(', ')}.` };
    const list = b.type === 'li' ? b.list : null;
    if (b.type === 'li' && !PAGE_LIST_TYPES.includes(list)) return { error: `${where}: list items need list "bullet" or "number".` };
    if (!Array.isArray(b.spans) || b.spans.length === 0) return { error: `${where}: has no text.` };
    let spans = [];
    for (const s of b.spans) {
      if (!s || typeof s.text !== 'string') return { error: `${where}: every span needs text.` };
      const href = s.href === null || s.href === undefined ? null : safeHref(s.href);
      if (s.href && !href) return { error: `${where}: links must start with https:// or mailto:.` };
      spans.push({ text: cleanInline(s.text), bold: s.bold === true, italic: s.italic === true, href });
    }
    spans[0].text = spans[0].text.trimStart();
    spans[spans.length - 1].text = spans[spans.length - 1].text.trimEnd();
    spans = spans.filter((s) => s.text);
    const total = spans.map((s) => s.text).join('');
    if (!total) return { error: `${where}: has no text.` };
    if (total.length > L.pages.blockText) return { error: `${where}: is ${total.length} characters; split it (limit ${L.pages.blockText}).` };
    blocks.push({ type: b.type, list, spans });
  }
  return { value: blocks };
};

const HIGHLIGHT_SCHEMA = {
  fields: {
    id: id(),
    enabled: enabledFlag(),
    accountName: text({ min: L.highlights.accountName[0], max: L.highlights.accountName[1] }),
    handle: pattern(text({ min: L.highlights.handle[0], max: L.highlights.handle[1] }), /^[A-Za-z0-9_]+$/, 'Use letters, numbers and _ only, without the @.'),
    text: text({ min: L.highlights.text[0], max: L.highlights.text[1] }),
    url: pattern(httpsUrl(), POST_URL, 'Use the https link to one post on x.com.'),
    initials: pattern(text({ min: L.highlights.initials[0], max: L.highlights.initials[1] }), /^[A-Z0-9]+$/, 'Use capital letters or numbers.'),
    color: hexColor()
  }
};

const TIER_SCHEMA = {
  fields: {
    id: id(),
    enabled: enabledFlag(),
    name: text({ min: L.tiers.name[0], max: L.tiers.name[1] }),
    badge: text({ min: L.tiers.badge[0], max: L.tiers.badge[1], required: false }),
    price: text({ min: L.tiers.price[0], max: L.tiers.price[1] }),
    priceNote: text({ min: L.tiers.priceNote[0], max: L.tiers.priceNote[1], required: false }),
    showPrice: enabledFlag(),
    duration: text({ min: L.tiers.duration[0], max: L.tiers.duration[1], required: false }),
    placements: placementList(),
    features: optionalStringList({ min: 0, max: L.tiers.features, itemMin: L.tiers.feature[0], itemMax: L.tiers.feature[1] }),
    ctaLabel: text({ min: L.tiers.ctaLabel[0], max: L.tiers.ctaLabel[1], required: false }),
    ctaUrl: httpsUrl({ required: false }),
    featured: bool()
  },
  check: (v) => (v.features.length || v.placements.some((p) => p.enabled)
    ? null
    : { features: 'Add at least one line, or switch on at least one placement.' })
};

const PAGE_SCHEMA = {
  fields: {
    slug: enumOf(PAGE_SLUGS),
    title: text({ min: L.pages.title[0], max: L.pages.title[1] }),
    intro: text({ min: 1, max: L.pages.intro[1], required: false }),
    updatedAt: isoDate({ required: false, minDays: -3650, maxDays: 1 }),
    blocks: pageBlocks()
  }
};

// The hero banner. The highlighted word must appear in the headline; an image needs a description; the button
// (Minimal style) needs both its text and the site page it opens, chosen from HERO_BUTTON_TARGETS.
const HERO_SCHEMA = {
  fields: {
    eyebrow: text({ min: L.hero.eyebrow[0], max: L.hero.eyebrow[1] }),
    title: text({ min: L.hero.title[0], max: L.hero.title[1] }),
    highlight: text({ min: 1, max: L.hero.highlight[1], required: false }),
    subtitle: text({ min: 1, max: L.hero.subtitle[1], required: false }),
    image: httpsUrl({ required: false }),
    imageAlt: text({ min: 1, max: L.hero.imageAlt[1], required: false }),
    style: enumOf(HERO_STYLES, { required: false }),
    buttonLabel: text({ min: L.hero.buttonLabel[0], max: L.hero.buttonLabel[1], required: false }),
    buttonTarget: enumOf(Object.keys(HERO_BUTTON_TARGETS), { required: false }),
    button2Label: text({ min: L.hero.button2Label[0], max: L.hero.button2Label[1], required: false }),
    button2Target: enumOf(Object.keys(HERO_BUTTON_TARGETS), { required: false })
  },
  check: (v) => {
    if (v.highlight && !v.title.includes(v.highlight)) return { highlight: 'must be a word or phrase from the headline.' };
    if (v.image && !v.imageAlt) return { imageAlt: 'is required with an image (describe it for people who cannot see it).' };
    if (Boolean(v.buttonLabel) !== Boolean(v.buttonTarget)) return { buttonLabel: 'and the page the button opens go together (set both, or neither).' };
    if (Boolean(v.button2Label) !== Boolean(v.button2Target)) return { button2Label: 'and the page the second button opens go together (set both, or neither).' };
    return null;
  }
};

// Grants & Funding. A type keeps its fixed id (its icon); a programme names one to three of those types.
const FUNDING_TYPE_SCHEMA = {
  fields: {
    id: enumOf(FUNDING_TYPE_IDS),
    enabled: enabledFlag(),
    title: text({ min: L.grants.typeTitle[0], max: L.grants.typeTitle[1] }),
    description: text({ min: L.grants.typeDescription[0], max: L.grants.typeDescription[1] }),
    position: wholeNumber({ min: 0, max: 999, required: false })
  }
};

const fundingTypeList = () => (raw) => {
  if (!Array.isArray(raw)) return { error: `Choose ${L.grants.types[0]} to ${L.grants.types[1]} types of funding.` };
  if (raw.length < L.grants.types[0] || raw.length > L.grants.types[1]) return { error: `Choose ${L.grants.types[0]} to ${L.grants.types[1]} types of funding.` };
  if (raw.some((t) => !FUNDING_TYPE_IDS.includes(t))) return { error: `Use the types of funding: ${FUNDING_TYPE_IDS.join(', ')}.` };
  if (new Set(raw).size !== raw.length) return { error: 'Choose each type of funding once.' };
  return { value: [...raw] };
};

const FUNDING_PROGRAMME_SCHEMA = {
  fields: {
    id: id(),
    enabled: enabledFlag(),
    provider: text({ min: L.grants.provider[0], max: L.grants.provider[1] }),
    kind: enumOf(FUNDING_KINDS),
    place: enumOf(FUNDING_PLACES),
    types: fundingTypeList(),
    description: text({ min: L.grants.description[0], max: L.grants.description[1] }),
    url: httpsUrl({ required: false }),
    featured: bool(),
    position: wholeNumber({ min: 0, max: 999, required: false })
  }
};

/** content.json grants -> the published types (with their programme counts) and programmes, or null when absent. */
function validateGrants(grants, { now }) {
  if (grants === undefined || grants === null) return { errors: [], grants: null };
  if (typeof grants !== 'object' || Array.isArray(grants)) return { errors: ['grants: must have "types" and "programmes" lists.'], grants: null };
  const errors = [];
  for (const key of Object.keys(grants)) if (!['types', 'programmes'].includes(key)) errors.push(`grants: unknown part "${key}". Use types or programmes.`);
  const types = validateList(grants.types, FUNDING_TYPE_SCHEMA, 'grants.types', { now });
  const programmes = validateList(grants.programmes, FUNDING_PROGRAMME_SCHEMA, 'grants.programmes', { now, maxItems: L.grants.maxProgrammes });
  errors.push(...types.errors, ...programmes.errors);
  const order = (a, b) => (a.position ?? 999) - (b.position ?? 999);
  const shownTypes = [...types.items].sort(order);
  const shown = new Set(shownTypes.map((t) => t.id));
  // A programme only counts towards, and is only labelled with, the types shown on the site.
  const items = [...programmes.items].sort(order).map((p) => ({ ...p, types: p.types.filter((t) => shown.has(t)) }));
  const count = (typeId) => items.filter((p) => p.types.includes(typeId)).length;
  return {
    errors,
    grants: { types: shownTypes.map((t) => toFundingTypeDto(t, count(t.id))), programmes: items.map(toFundingProgrammeDto) }
  };
}

// Reusable banners. A photo needs its description and its credit and licence; button text and page go together.
const BANNER_SCHEMA = {
  fields: {
    placement: enumOf(BANNER_PLACEMENTS),
    enabled: enabledFlag(),
    eyebrow: text({ min: L.banners.eyebrow[0], max: L.banners.eyebrow[1] }),
    title: text({ min: L.banners.title[0], max: L.banners.title[1] }),
    text: text({ min: 1, max: L.banners.text[1], required: false }),
    buttonLabel: text({ min: L.banners.buttonLabel[0], max: L.banners.buttonLabel[1], required: false }),
    buttonTarget: enumOf(Object.keys(BANNER_TARGETS), { required: false }),
    image: httpsUrl({ required: false }),
    imageAlt: text({ min: 1, max: L.banners.imageAlt[1], required: false }),
    credit: text({ min: L.banners.credit[0], max: L.banners.credit[1], required: false }),
    startDate: isoDate({ required: false, minDays: -3650, maxDays: 3650 }),
    endDate: isoDate({ required: false, minDays: -3650, maxDays: 3650 })
  },
  check: (v) => {
    if (v.image && !v.imageAlt) return { imageAlt: 'is required with a photo (describe it for people who cannot see it).' };
    if (v.image && !v.credit) return { credit: 'is required with a photo (who took it, and its licence).' };
    if (Boolean(v.buttonLabel) !== Boolean(v.buttonTarget)) return { buttonLabel: 'and the page the button opens go together (set both, or neither).' };
    if (v.startDate && v.endDate && v.endDate < v.startDate) return { endDate: 'is before the start date.' };
    return null;
  }
};

// Site settings: a story id (as in news.json) and a short footer line; both optional.
const SETTINGS_SCHEMA = {
  fields: {
    topUaeStoryId: pattern(text({ min: 4, max: 80, required: false }), /^[A-Za-z0-9_-]{4,80}$/, 'Use the story id from news.json.'),
    footerTagline: text({ min: L.settings.footerTagline[0], max: L.settings.footerTagline[1], required: false })
  }
};

/** content.json banners -> { careers, grants } (null for a placement with no shown banner), or null when absent. */
function validateBanners(list, { now }) {
  if (list === undefined || list === null) return { errors: [], banners: null };
  const result = validateList(list, BANNER_SCHEMA, 'banners', { now, key: 'placement' });
  const banners = Object.fromEntries(BANNER_PLACEMENTS.map((p) => [p, null]));
  for (const b of result.items) banners[b.placement] = toBannerDto(b);
  return { errors: result.errors, banners };
}

/* ------------------------------- validation ------------------------------- */

function validateList(list, schema, label, { now, maxItems, key = 'id' }) {
  const errors = [];
  const items = [];
  const seen = new Set();
  if (list !== undefined && !Array.isArray(list)) return { errors: [`${label}: must be a list.`], items };
  (list || []).forEach((raw, i) => {
    const where = `${label} #${i + 1} (${raw?.[key] || `no ${key}`})`;
    const result = validate(schema, raw, { now });
    if (!result.ok) {
      for (const [field, message] of Object.entries(result.fields)) errors.push(`${where}: "${field}" ${message}`);
      return;
    }
    if (seen.has(result.value[key])) errors.push(`${where}: duplicate ${key}.`);
    seen.add(result.value[key]);
    if (result.value.enabled === false) return;
    items.push(result.value);
  });
  if (maxItems && items.length > maxItems) errors.push(`${label}: ${items.length} items are enabled but the page has room for ${maxItems}. Disable some.`);
  return { errors, items };
}

/**
 * @param {object} config  config/content.json without its _help keys
 * @returns {{ errors: string[], content: { slots: object, pages: object } }}
 */
export function validateContent(config, { now = new Date() } = {}) {
  const errors = [];
  for (const key of Object.keys(config || {})) {
    if (!['socialHighlights', 'advertiseTiers', 'pages', 'hero', 'grants', 'banners', 'settings'].includes(key)) errors.push(`Unknown group "${key}". Use socialHighlights, advertiseTiers, pages, hero, grants, banners or settings.`);
  }
  const highlights = validateList(config?.socialHighlights, HIGHLIGHT_SCHEMA, 'socialHighlights', { now, maxItems: L.highlights.maxItems });
  // A retired package still enabled in Sanity is skipped rather than rejected, so it never blocks publishing.
  const tierList = Array.isArray(config?.advertiseTiers)
    ? config.advertiseTiers.filter((t) => {
      const retired = RETIRED_ADVERTISING_TIERS.includes(t?.id);
      if (retired) log.warn('content.tier.retired', { tier: t.id });
      return !retired;
    })
    : config?.advertiseTiers;
  const tiers = validateList(tierList, TIER_SCHEMA, 'advertiseTiers', { now, maxItems: L.tiers.maxItems });
  const pages = validateList(config?.pages, PAGE_SCHEMA, 'pages', { now, key: 'slug' });
  const grants = validateGrants(config?.grants, { now });
  const banners = validateBanners(config?.banners, { now });
  let settings = null;
  if (config?.settings !== undefined && config?.settings !== null) {
    const result = validate(SETTINGS_SCHEMA, config.settings, { now });
    if (result.ok) settings = toSiteSettingsDto(result.value);
    else for (const [field, message] of Object.entries(result.fields)) errors.push(`settings: "${field}" ${message}`);
  }
  errors.push(...highlights.errors, ...tiers.errors, ...pages.errors, ...grants.errors, ...banners.errors);
  let hero = null;
  if (config?.hero !== undefined && config?.hero !== null) {
    const result = validate(HERO_SCHEMA, config.hero, { now });
    if (result.ok) hero = toHeroDto(result.value);
    else for (const [field, message] of Object.entries(result.fields)) errors.push(`hero: "${field}" ${message}`);
  }
  return {
    errors,
    content: {
      slots: {
        socialHighlights: highlights.items.map(toSocialHighlightDto),
        advertiseTiers: tiers.items.map(toAdvertiseTierDto)
      },
      pages: Object.fromEntries(pages.items.map((p) => [p.slug, toPageDto(p)])),
      hero,
      grants: grants.grants,
      banners: banners.banners,
      settings
    }
  };
}

/** config/content.json, or an empty one if the file does not exist yet. */
export function loadContentConfig(dir = CONFIG_DIR) {
  const file = path.join(dir, 'content.json');
  if (!existsSync(file)) return {};
  const raw = readJson(file);
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
}

export function runContent(ctx, config = loadContentConfig()) {
  const { errors, content } = validateContent(config, { now: ctx.now });
  if (errors.length) {
    for (const e of errors) log.error('content.invalid', { detail: e });
    return { ok: false, errors };
  }
  log.info('content.ready', {
    socialHighlights: content.slots.socialHighlights.length,
    advertiseTiers: content.slots.advertiseTiers.length,
    pages: Object.keys(content.pages).length,
    fundingProgrammes: content.grants ? content.grants.programmes.length : 0
  });
  return { ok: true, content };
}
