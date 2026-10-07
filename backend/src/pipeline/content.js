// Content pipeline: config/content.json -> validate -> api/v1/content.json.
//
// content.json holds the editorial content managed in Sanity (studio/):
//   socialHighlights  the home page "Top Tweets" box
//   advertiseTiers    the package cards on the Advertise page
//   pages             About, Privacy and Terms body copy
// `npm run cms:pull` writes it from Sanity; it can also be edited by hand.
//
// Invalid content fails the step with a plain-language message and the
// previous api/v1/content.json stays live (same behaviour as sponsors).
// The limits mirror studio/schemaTypes/rules.js (test/cms.test.js checks they match).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, readJson } from '../config.js';
import { log } from '../lib/logger.js';
import { ADVERTISING_TIERS, PAGE_BLOCK_TYPES, PAGE_LIST_TYPES, PAGE_SLUGS } from '../contracts/models.js';
import { toAdvertiseTierDto, toPageDto, toSocialHighlightDto } from '../contracts/serializers.js';
import { EMAIL_RE, cleanInline, cleanText, rules, validate } from '../validation/validate.js';
import { isSafePublicUrl } from '../lib/http.js';

const { id, text, httpsUrl, enumOf, isoDate, bool } = rules;

export const CONTENT_LIMITS = {
  highlights: { maxItems: 5, accountName: [2, 40], handle: [2, 16], text: [10, 140], initials: [1, 3] },
  tiers: { maxItems: 4, name: [2, 40], badge: [2, 20], price: [2, 30], priceNote: [2, 40], features: 8, feature: [2, 120] },
  pages: { title: [2, 80], intro: [0, 400], blocks: 120, blockText: 2000 }
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
    id: enumOf(ADVERTISING_TIERS),
    enabled: enabledFlag(),
    name: text({ min: L.tiers.name[0], max: L.tiers.name[1] }),
    badge: text({ min: L.tiers.badge[0], max: L.tiers.badge[1], required: false }),
    price: text({ min: L.tiers.price[0], max: L.tiers.price[1] }),
    priceNote: text({ min: L.tiers.priceNote[0], max: L.tiers.priceNote[1], required: false }),
    features: stringList({ min: 1, max: L.tiers.features, itemMin: L.tiers.feature[0], itemMax: L.tiers.feature[1] }),
    featured: bool()
  }
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
    if (!['socialHighlights', 'advertiseTiers', 'pages'].includes(key)) errors.push(`Unknown group "${key}". Use socialHighlights, advertiseTiers or pages.`);
  }
  const highlights = validateList(config?.socialHighlights, HIGHLIGHT_SCHEMA, 'socialHighlights', { now, maxItems: L.highlights.maxItems });
  const tiers = validateList(config?.advertiseTiers, TIER_SCHEMA, 'advertiseTiers', { now, maxItems: L.tiers.maxItems });
  const pages = validateList(config?.pages, PAGE_SCHEMA, 'pages', { now, key: 'slug' });
  errors.push(...highlights.errors, ...tiers.errors, ...pages.errors);
  return {
    errors,
    content: {
      slots: {
        socialHighlights: highlights.items.map(toSocialHighlightDto),
        advertiseTiers: tiers.items.map(toAdvertiseTierDto)
      },
      pages: Object.fromEntries(pages.items.map((p) => [p.slug, toPageDto(p)]))
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
    pages: Object.keys(content.pages).length
  });
  return { ok: true, content };
}
