// Validates backend/config/sponsors.json and builds api/v1/sponsors.json.
//
// Slots map one-to-one onto the website's sponsor areas (see the table in
// backend/README.md). Every item uses the same field names; each slot lists
// which of them it uses. Anything unsafe (non-https links, images outside
// assets/sponsors/, SVG, bad colours) or unknown is rejected with a
// plain-language message and nothing is published, so the previous file stays live.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../config.js';
import { log } from '../lib/logger.js';
import { SPONSOR_SLOTS } from '../contracts/models.js';
import { toSponsorItemDto } from '../contracts/serializers.js';
import { cleanText } from '../validation/validate.js';

const HEX = /^#[0-9a-f]{6}$/i;
const IMAGE_PATH = /^assets\/sponsors\/[a-z0-9][a-z0-9._-]{0,120}\.(png|jpe?g|webp)$/i;
const WEBSITE = /^(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

// text: allowed text fields and their maximum length (sized to the UI tiles).
export const SLOT_RULES = {
  platinum: { maxItems: 5, sponsored: true, text: { title: 60 }, required: ['title'], images: ['image'], colors: ['colorFrom', 'colorTo'] },
  gold: { maxItems: 10, sponsored: true, text: { title: 70, label: 20 }, required: ['title'], images: ['image'], colors: ['colorFrom', 'colorTo'] },
  sponsoredPosts: { maxItems: 20, sponsored: true, text: { title: 90, blurb: 160, logoText: 4 }, required: ['title'], images: ['image'], colors: ['colorFrom', 'colorTo'] },
  sponsoredMedia: { maxItems: 15, sponsored: true, text: { label: 20, title: 90, blurb: 160 }, required: ['title'], images: ['image'], colors: [] },
  professionalServices: { maxItems: 20, sponsored: true, text: { title: 70, website: 80, logoText: 4 }, required: ['title'], images: ['image'], colors: ['colorFrom', 'colorTo'] },
  careerResources: { maxItems: 12, sponsored: false, text: { title: 70, logoText: 5 }, required: ['title'], images: [], colors: ['colorFrom', 'colorTo'] }
};

// Old field and group names, so a hand-edited file gets a helpful message.
const RENAMED_FIELDS = { headline: 'title', name: 'title', tag: 'label', logo: 'image', thumbnail: 'image', logoBackground: 'colorFrom' };
const RENAMED_GROUPS = { banners: 'gold' };

function checkUrl(value) {
  if (value === '#' || value === '' || value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? { ok: true, value: u.toString() } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function checkImage(value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  if (IMAGE_PATH.test(value) && !value.includes('..')) {
    return { ok: true, value, missing: !existsSync(path.join(REPO_ROOT, value)) };
  }
  if (/^https:\/\/[^\s"'<>()\\]+$/i.test(value) && !/\.svg(\?|#|$)/i.test(value)) return { ok: true, value };
  return { ok: false };
}

export function validateSponsors(config) {
  const errors = [];
  const warnings = [];
  const slots = {};

  for (const key of Object.keys(config)) {
    if (SPONSOR_SLOTS.includes(key)) continue;
    errors.push(RENAMED_GROUPS[key]
      ? `"${key}" is now called "${RENAMED_GROUPS[key]}". Rename the group.`
      : `Unknown group "${key}". Use one of: ${SPONSOR_SLOTS.join(', ')}.`);
  }

  for (const slot of SPONSOR_SLOTS) {
    const rule = SLOT_RULES[slot];
    const items = Array.isArray(config[slot]) ? config[slot] : [];
    const allowed = new Set(['id', 'enabled', 'url', ...Object.keys(rule.text), ...rule.images, ...rule.colors]);
    const ids = new Set();
    slots[slot] = [];

    items.forEach((item, i) => {
      const where = `${slot} #${i + 1} (${item?.id || 'no id'})`;
      if (!item || typeof item !== 'object') { errors.push(`${where}: must be an object.`); return; }
      if (!item.id || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(item.id)) errors.push(`${where}: id must be lowercase letters, numbers and dashes.`);
      if (ids.has(item.id)) errors.push(`${where}: duplicate id.`);
      ids.add(item.id);
      for (const field of Object.keys(item)) {
        if (allowed.has(field)) continue;
        errors.push(RENAMED_FIELDS[field] && allowed.has(RENAMED_FIELDS[field])
          ? `${where}: "${field}" is now called "${RENAMED_FIELDS[field]}".`
          : `${where}: "${field}" is not used in this slot.`);
      }
      if (item.enabled === false) return;

      const clean = { id: item.id };
      for (const [field, max] of Object.entries(rule.text)) {
        const v = item[field] === undefined || item[field] === null ? '' : cleanText(String(item[field]));
        if (v.length > max) errors.push(`${where}: "${field}" is ${v.length} characters; the limit is ${max}.`);
        if (field === 'website' && v && !WEBSITE.test(v)) errors.push(`${where}: "website" must look like www.example.ae (it is shown as text, not a link).`);
        clean[field] = v || null;
      }
      for (const field of rule.required) if (!clean[field]) errors.push(`${where}: "${field}" is required.`);

      const url = checkUrl(item.url);
      if (!url.ok) errors.push(`${where}: link must start with https:// (or be # as a placeholder).`);
      clean.url = url.ok ? url.value : null;

      for (const field of rule.images) {
        const img = checkImage(item[field]);
        if (!img.ok) errors.push(`${where}: "${field}" must be a PNG, JPG or WebP in assets/sponsors/, or an https:// image link.`);
        else if (img.missing) warnings.push(`${where}: image ${img.value} is listed but the file is not in the repository yet.`);
        clean[field] = img.ok ? img.value : null;
      }
      for (const field of rule.colors) {
        const c = item[field];
        if (c && !HEX.test(c)) errors.push(`${where}: "${field}" must be a colour like #137A72.`);
        clean[field] = c && HEX.test(c) ? c.toUpperCase() : null;
      }
      slots[slot].push(toSponsorItemDto(clean, rule));
    });

    if (slots[slot].length > rule.maxItems) {
      errors.push(`${slot}: ${slots[slot].length} items are enabled but the page has room for ${rule.maxItems}. Disable some.`);
    }
  }
  return { errors, warnings, slots };
}

export function publishableSponsors(config) {
  const { errors, warnings, slots } = validateSponsors(config);
  for (const w of warnings) log.warn('sponsors.warning', { detail: w });
  if (errors.length) {
    for (const e of errors) log.error('sponsors.invalid', { detail: e });
    return { ok: false, errors };
  }
  return { ok: true, slots };
}
