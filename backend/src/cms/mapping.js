// Sanity documents -> the config file shapes the existing pipelines already
// validate and publish:
//   sponsors   -> config/sponsors.json   (validated by pipeline/sponsors.js)
//   events     -> config/events.json     (validated by pipeline/events.js)
//   highlights, tiers, pages -> config/content.json (validated by pipeline/content.js)
//
// This is the ONLY place that knows Sanity's field names. Each slot keeps only
// the fields it uses (a field hidden in the Studio can still hold an old value).
// Pure functions: no I/O, so tests can feed them fixtures.

import { SPONSOR_SLOTS, PAGE_LIST_TYPES } from '../contracts/models.js';
import { SLOT_RULES } from '../pipeline/sponsors.js';
import { safeHref } from '../pipeline/content.js';
import { cleanInline } from '../validation/validate.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const IMAGE_MAX_BYTES = 500 * 1024;
const STYLE_TO_TYPE = { normal: 'p', h2: 'h2', h3: 'h3' };

/** Drops null, undefined and '' so the config files stay as tidy as hand-written ones. */
function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''));
}

const name = (doc, fallback) => doc?.id || doc?.title || doc?.accountName || fallback;

/** @returns {{ config: Record<string, object[]>, errors: string[] }} */
export function toSponsorsConfig(docs) {
  const config = Object.fromEntries(SPONSOR_SLOTS.map((s) => [s, []]));
  const errors = [];
  for (const [i, doc] of (docs || []).entries()) {
    const where = `Sanity sponsor "${name(doc, `#${i + 1}`)}"`;
    const rule = SLOT_RULES[doc?.slot];
    if (!rule) { errors.push(`${where}: choose where it appears (slot).`); continue; }
    const item = { id: doc.id, enabled: true, url: doc.url };
    for (const field of Object.keys(rule.text)) item[field] = doc[field];
    for (const field of rule.colors) item[field] = doc[field];
    for (const field of rule.images) {
      const img = doc[field];
      if (!img?.url) continue;
      if (!IMAGE_TYPES.includes(img.mimeType)) errors.push(`${where}: the image must be PNG, JPG or WebP (it is ${img.mimeType || 'unknown'}).`);
      else if (img.size > IMAGE_MAX_BYTES) errors.push(`${where}: the image is ${Math.round(img.size / 1024)} KB; the limit is 500 KB.`);
      else item[field] = img.url;
    }
    config[doc.slot].push(compact(item));
  }
  return { config, errors };
}

export function toEventsList(docs) {
  return (docs || []).map((doc) => compact({
    id: doc.id,
    title: doc.title,
    eventType: doc.eventType,
    startDate: doc.startDate,
    endDate: doc.endDate,
    city: doc.city,
    venue: doc.venue,
    url: doc.url,
    organiser: doc.organiser,
    featured: doc.featured === true
  }));
}

export function toHighlights(docs) {
  return (docs || []).map((doc) => compact({
    id: doc.id,
    accountName: doc.accountName,
    handle: doc.handle,
    text: doc.text,
    url: doc.url,
    initials: doc.initials,
    color: doc.color
  }));
}

export function toTiers(docs) {
  return (docs || []).map((doc) => compact({
    id: doc.tier,
    name: doc.name,
    badge: doc.badge,
    price: doc.price,
    priceNote: doc.priceNote,
    features: Array.isArray(doc.features) ? doc.features : [],
    featured: doc.featured === true
  }));
}

/**
 * Portable Text -> the safe block list the website renders with textContent.
 * Keeps: paragraphs, h2, h3, bullet/number list items, bold, italic, https/mailto links.
 * Drops everything else (images, custom blocks, unknown marks, unsafe links keep their text).
 */
export function portableTextToBlocks(body) {
  const blocks = [];
  for (const block of Array.isArray(body) ? body : []) {
    if (block?._type !== 'block' || !Array.isArray(block.children)) continue;
    const links = new Map((block.markDefs || []).filter((d) => d?._type === 'link').map((d) => [d._key, safeHref(d.href)]));
    const type = block.listItem ? 'li' : STYLE_TO_TYPE[block.style] || 'p';
    const list = type === 'li' ? (PAGE_LIST_TYPES.includes(block.listItem) ? block.listItem : 'bullet') : null;
    let spans = [];
    for (const child of block.children) {
      if (child?._type !== 'span' || typeof child.text !== 'string') continue;
      const marks = Array.isArray(child.marks) ? child.marks : [];
      const span = {
        text: cleanInline(child.text),
        bold: marks.includes('strong'),
        italic: marks.includes('em'),
        href: marks.map((m) => links.get(m)).find(Boolean) || null
      };
      const prev = spans[spans.length - 1];
      if (prev && prev.bold === span.bold && prev.italic === span.italic && prev.href === span.href) prev.text += span.text;
      else spans.push(span);
    }
    if (!spans.length) continue;
    spans[0].text = spans[0].text.trimStart();
    spans[spans.length - 1].text = spans[spans.length - 1].text.trimEnd();
    spans = spans.filter((s) => s.text);
    if (spans.length) blocks.push({ type, list, spans });
  }
  return blocks;
}

export function toPages(docs) {
  return (docs || []).map((doc) => compact({
    slug: doc.slug,
    title: doc.title,
    intro: doc.intro,
    updatedAt: doc.updatedAt,
    blocks: portableTextToBlocks(doc.body)
  }));
}

/**
 * The whole CONTENT_QUERY result -> the three config documents.
 * @returns {{ sponsors: object, events: object[], content: object, errors: string[] }}
 */
export function mapSanityContent(result) {
  const r = result || {};
  const sponsors = toSponsorsConfig(r.sponsors);
  return {
    sponsors: sponsors.config,
    events: toEventsList(r.events),
    content: { socialHighlights: toHighlights(r.highlights), advertiseTiers: toTiers(r.tiers), pages: toPages(r.pages) },
    errors: sponsors.errors
  };
}
