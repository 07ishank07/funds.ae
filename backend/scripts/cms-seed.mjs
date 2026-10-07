#!/usr/bin/env node
// One-off: turns the content the site uses today into a Sanity import file, so
// the Studio starts with what is live instead of empty forms.
//
//   npm run cms:seed [-- --site-url https://funds.ae/frontend_demo/]
//   cd ../studio && npx sanity datasets import seed/fundsae-seed.ndjson development --replace
//
// Reads:  backend/config/sponsors.json (+ images in assets/sponsors/), backend/config/events.json,
//         the package cards in frontend_demo/Advertise.dc.html and the body copy of
//         About/Privacy/Terms (sections marked data-fundsae-keep are skipped).
// Writes: studio/seed/fundsae-seed.ndjson (git-ignored). Nothing is sent anywhere.
//
// The Top Tweets box is not seeded: its dummy rows have no real post links.
// Today's sponsors and copy are placeholders ("demo", "dummy"): import into the
// `development` dataset to try the Studio, and put only real content in `production`.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');
const SLOTS = ['founding', 'platinum', 'gold', 'sponsoredPosts', 'sponsoredMedia', 'professionalServices', 'careerResources'];
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', larr: '←', rarr: '→', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };

let keySeq = 0;
const key = () => `k${(++keySeq).toString(36).padStart(4, '0')}`;

const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
const plain = (html) => decode(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const stripDocs = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_')));
/** Drops null and undefined so Sanity gets no empty fields. */
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

/* ----------------------------- inline HTML -> spans ----------------------------- */

/** Inline HTML (text, <a href>, <strong>/<b>, <em>/<i>) -> Portable Text children + markDefs. */
function inline(html, siteUrl) {
  const children = [];
  const markDefs = [];
  const marks = [];
  for (const token of html.match(/<[^>]+>|[^<]+/g) || []) {
    const tag = token.match(/^<\s*(\/?)([a-z0-9]+)([^>]*)>$/i);
    if (!tag) {
      const text = decode(token).replace(/\s+/g, ' ');
      if (text) children.push({ _type: 'span', _key: key(), text, marks: [...marks] });
      continue;
    }
    const [, closing, name] = tag;
    const lower = name.toLowerCase();
    const mark = { strong: 'strong', b: 'strong', em: 'em', i: 'em' }[lower];
    if (mark) {
      if (closing) marks.splice(marks.lastIndexOf(mark), 1);
      else marks.push(mark);
    } else if (lower === 'a') {
      if (closing) {
        const i = marks.findIndex((m) => m.startsWith('link'));
        if (i !== -1) marks.splice(i, 1);
      } else {
        const href = (tag[3].match(/href="([^"]*)"/) || [])[1];
        const absolute = href ? toHttps(decode(href), siteUrl) : null;
        if (absolute) {
          const k = `link${key()}`;
          markDefs.push({ _type: 'link', _key: k, href: absolute });
          marks.push(k);
        }
      }
    }
  }
  if (children.length) {
    children[0].text = children[0].text.trimStart();
    children[children.length - 1].text = children[children.length - 1].text.trimEnd();
  }
  return { children: children.filter((c) => c.text), markDefs };
}

/** Page links like "Contact.dc.html" become absolute https links on the site; "#" and others are dropped. */
function toHttps(href, siteUrl) {
  if (/^mailto:/i.test(href)) return href;
  try {
    const u = new URL(href, siteUrl);
    return u.protocol === 'https:' && !href.startsWith('#') ? u.toString() : null;
  } catch {
    return null;
  }
}

const block = (style, html, siteUrl, listItem) => {
  const { children, markDefs } = inline(html, siteUrl);
  if (!children.length) return null;
  return { _type: 'block', _key: key(), style, markDefs, children, ...(listItem ? { listItem, level: 1 } : {}) };
};

/* ------------------------------------ pages ------------------------------------ */

/** About/Privacy/Terms: title, lead and the body sections of <main data-fundsae-slot="page-body">. */
export function pageFromHtml(html, slug, siteUrl) {
  const main = (html.match(/<main[^>]*data-fundsae-page="[a-z]+"[^>]*>([\s\S]*?)<\/main>/) || [])[1];
  if (!main) throw new Error(`${slug}: no <main data-fundsae-page> found`);
  const title = plain((main.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || slug);
  const lead = (main.match(/<p class="lead">([\s\S]*?)<\/p>/) || [])[1];
  const body = [];
  for (const [, attrs, inner] of main.matchAll(/<section([^>]*)>([\s\S]*?)<\/section>/g)) {
    if (/data-fundsae-keep/.test(attrs)) continue;
    for (const [, tagName, content] of inner.matchAll(/<(h2|h3|p|ul|ol)[^>]*>([\s\S]*?)<\/\1>/g)) {
      if (tagName === 'ul' || tagName === 'ol') {
        for (const [, li] of content.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
          const b = block('normal', li, siteUrl, tagName === 'ol' ? 'number' : 'bullet');
          if (b) body.push(b);
        }
      } else {
        const b = block(tagName === 'p' ? 'normal' : tagName, content, siteUrl);
        if (b) body.push(b);
      }
    }
  }
  return { _id: `page-${slug}`, _type: 'page', slug, title, ...(lead ? { intro: plain(lead) } : {}), body };
}

/* ---------------------------------- packages ----------------------------------- */

const TIER_POSITIONS = { silver: 10, gold: 20, platinum: 30, exclusive: 40 };

/** The package cards and the Elite Exclusive hero on the Advertise page. */
export function tiersFromHtml(html) {
  const tiers = [];
  for (const [, classes, card] of html.matchAll(/<div class="(tier(?: featured)?)">([\s\S]*?)<\/div>\s*(?=<div class="tier|<\/div>)/g)) {
    const id = (card.match(/data-fundsae-tier="([a-z]+)"/) || [])[1];
    const price = card.match(/<div class="price">([\s\S]*?)(?:<small>([\s\S]*?)<\/small>)?<\/div>/) || [];
    tiers.push({
      _id: `tier-${id}`,
      _type: 'advertiseTier',
      tier: id,
      name: plain((card.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || id),
      badge: plain((card.match(/<span class="badge">([\s\S]*?)<\/span>/) || [])[1] || '') || undefined,
      price: plain(price[1] || ''),
      priceNote: plain(price[2] || '') || undefined,
      features: [...card.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => plain(m[1])),
      featured: classes.includes('featured'),
      position: TIER_POSITIONS[id],
      enabled: true
    });
  }
  const hero = (html.match(/<section class="elite-hero"[\s\S]*?<\/section>/) || [])[0];
  if (hero) {
    const eyebrow = [...hero.matchAll(/<p class="elite-hero-eyebrow">[\s\S]*?<\/p>/g)][0]?.[0] || '';
    const spans = [...eyebrow.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((m) => plain(m[1]));
    const price = hero.match(/<span class="elite-hero-price">([\s\S]*?)(?:<small>([\s\S]*?)<\/small>)?<\/span>/) || [];
    tiers.push({
      _id: 'tier-exclusive',
      _type: 'advertiseTier',
      tier: 'exclusive',
      name: spans[0] || 'Elite Exclusive Partner',
      badge: spans[1] || undefined,
      price: plain(price[1] || 'On request'),
      priceNote: plain(price[2] || '') || undefined,
      features: [...(hero.match(/<ul class="elite-hero-perks">([\s\S]*?)<\/ul>/) || ['', ''])[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => plain(m[1])),
      featured: false,
      position: TIER_POSITIONS.exclusive,
      enabled: true
    });
  }
  return tiers.map(compact);
}

/* ------------------------------- sponsors, events ------------------------------ */

function imageField(value) {
  if (!value) return undefined;
  if (/^assets\/sponsors\//.test(value)) {
    const file = path.join(REPO_ROOT, value);
    return existsSync(file) ? { _type: 'image', _sanityAsset: `image@${pathToFileURL(file).href}` } : undefined;
  }
  return /^https:\/\//.test(value) ? { _type: 'image', _sanityAsset: `image@${value}` } : undefined;
}

export function sponsorDocs(config) {
  const docs = [];
  for (const slot of SLOTS) {
    (config[slot] || []).forEach((item, i) => {
      const { id, enabled, url, image, ...fields } = item;
      docs.push(compact({
        _id: `sponsor-${slot}-${id}`,
        _type: 'sponsorItem',
        slot,
        enabled: enabled !== false,
        id: { _type: 'slug', current: id },
        position: (i + 1) * 10,
        ...fields,
        url: url && url !== '#' ? url : undefined,
        image: imageField(image)
      }));
    });
  }
  return docs;
}

export function eventDocs(list) {
  return (list || []).filter((e) => !e.demoOnly).map((e) => {
    const { id, demoOnly, url, ...fields } = e;
    return compact({ _id: `event-${id}`, _type: 'event', id: { _type: 'slug', current: id }, ...fields, url: url && url !== '#' ? url : undefined });
  });
}

export function buildSeed({ root = REPO_ROOT, siteUrl = 'https://funds.ae/frontend_demo/' } = {}) {
  keySeq = 0;
  const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
  const sponsors = stripDocs(JSON.parse(read('backend/config/sponsors.json')));
  const events = JSON.parse(read('backend/config/events.json')).events;
  return [
    ...sponsorDocs(sponsors),
    ...eventDocs(events),
    ...tiersFromHtml(read('frontend_demo/Advertise.dc.html')),
    ...[['about', 'About'], ['privacy', 'Privacy'], ['terms', 'Terms']].map(([slug, file]) => pageFromHtml(read(`frontend_demo/${file}.dc.html`), slug, siteUrl))
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--site-url');
  const siteUrl = i !== -1 ? process.argv[i + 1] : undefined;
  if (siteUrl && !/^https:\/\/[^\s]+\/$/.test(siteUrl)) {
    console.error('--site-url must be an https:// address ending in /, e.g. https://funds.ae/frontend_demo/');
    process.exit(1);
  }
  const docs = buildSeed({ siteUrl });
  const out = path.join(REPO_ROOT, 'studio', 'seed', 'fundsae-seed.ndjson');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, docs.map((d) => JSON.stringify(d)).join('\n') + '\n', 'utf8');
  const count = (type) => docs.filter((d) => d._type === type).length;
  console.log(`Wrote ${path.relative(REPO_ROOT, out)}: ${count('sponsorItem')} sponsors, ${count('event')} events, ${count('advertiseTier')} packages, ${count('page')} pages.`);
  console.log('Import it into a test dataset first:  cd studio && npx sanity datasets import seed/fundsae-seed.ndjson development --replace');
}
