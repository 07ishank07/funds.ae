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

const TIER_POSITIONS = { silver: 10, gold: 20, exclusive: 40 };

/** Advertise packages, with all their fields, from config/content.json (the mirror of what Sanity publishes). */
export function tierDocs(tiers) {
  return (tiers || []).filter((t) => t.id !== 'platinum').map((t, i) => compact({
    _id: `tier-${t.id}`,
    _type: 'advertiseTier',
    tier: t.id,
    name: t.name,
    badge: t.badge || undefined,
    price: t.price,
    priceNote: t.priceNote || undefined,
    showPrice: t.showPrice !== false,
    duration: t.duration || undefined,
    placements: (t.placements || []).map((p) => ({ _type: 'placement', _key: key(), placement: p.placement, enabled: p.enabled !== false, detail: p.detail })),
    features: t.features || [],
    ctaLabel: t.ctaLabel || undefined,
    ctaUrl: t.ctaUrl || undefined,
    featured: t.featured === true,
    position: TIER_POSITIONS[t.id] ?? (i + 1) * 10,
    enabled: t.enabled !== false
  }));
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
    ...tierDocs(JSON.parse(read('backend/config/content.json')).advertiseTiers),
    ...[['about', 'About'], ['privacy', 'Privacy'], ['terms', 'Terms']].map(([slug, file]) => pageFromHtml(read(`frontend_demo/${file}.dc.html`), slug, siteUrl))
  ];
}

/* --------------------------- news queue: registry + taxonomy -------------------------- */

const keywordList = (keywords = {}) =>
  Object.entries(keywords).map(([term, weight], i) => ({ _type: 'keyword', _key: `kw${i}`, term, weight }));

/** Capital Types and Asset Classes from config/news-taxonomy.json, with the ids stories reference. */
export function taxonomyDocs(newsTaxonomy) {
  const capital = (newsTaxonomy.capitalTypes || []).map((c) => compact({
    _id: `capitalType-${c.id}`,
    _type: 'capitalType',
    name: c.name,
    id: { _type: 'slug', current: c.id },
    description: c.description || undefined,
    displayOrder: c.displayOrder,
    showInNav: c.showInNav === true,
    navLabel: c.showInNav ? c.navLabel : undefined,
    keywords: keywordList(c.keywords)
  }));
  const asset = (newsTaxonomy.assetClasses || []).map((a) => compact({
    _id: `assetClass-${a.id}`,
    _type: 'assetClass',
    name: a.name,
    id: { _type: 'slug', current: a.id },
    description: a.description || undefined,
    displayOrder: a.displayOrder,
    homeSection: a.homeSection || 'none',
    keywords: keywordList(a.keywords)
  }));
  return [...capital, ...asset];
}

const SOURCE_FIELDS = [
  'name', 'homepage', 'type', 'url', 'enabled', 'verified', 'region', 'focus', 'priority', 'tier', 'licenseStatus', 'termsUrl',
  'termsReviewedAt', 'allowImages', 'allowExcerpt', 'allowAiSummary', 'language', 'pollEveryHours', 'notes'
];

/** The live news sources from config/sources.news.json (demo sources stay in the file). */
export function sourceDocs(sourcesConfig) {
  return (sourcesConfig.sources || []).map((s) => compact({
    _id: `newsSource-${s.id}`,
    _type: 'newsSource',
    id: { _type: 'slug', current: s.id },
    ...Object.fromEntries(SOURCE_FIELDS.map((f) => [f, s[f]])),
    section: s._section || undefined
  }));
}

/**
 * Everything the News Review Queue and Careers need to start in the Studio: the source registry, both category
 * systems, the aggregator's three fixed documents and the (empty) Top Employers / Top Jobs document. Import it with --missing, which adds these
 * documents and never replaces anything already there.
 */
export function buildNewsSeed({ root = REPO_ROOT } = {}) {
  const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
  return [
    ...sourceDocs(read('backend/config/sources.news.json')),
    ...taxonomyDocs(read('backend/config/news-taxonomy.json')),
    { _id: 'newsAggregator', _type: 'newsAggregator', help: 'Sources are fetched once a day at 9:00 am Sydney time. Press "Fetch News Now" (bottom right) to fetch them now; new stories arrive in Pending review within a few minutes.' },
    { _id: 'newsAggregatorState', _type: 'newsAggregatorState', sources: [] },
    { _id: 'newsPublishSignal', _type: 'newsPublishSignal' },
    { _id: 'careersPage', _type: 'careersPage', topEmployers: [], topJobs: [] }
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

  const news = buildNewsSeed();
  const newsOut = path.join(REPO_ROOT, 'studio', 'seed', 'fundsae-news-seed.ndjson');
  writeFileSync(newsOut, news.map((d) => JSON.stringify(d)).join('\n') + '\n', 'utf8');
  const n = (type) => news.filter((d) => d._type === type).length;
  console.log(`Wrote ${path.relative(REPO_ROOT, newsOut)}: ${n('newsSource')} news sources, ${n('capitalType')} Capital Types, ${n('assetClass')} Asset Classes, 3 aggregator documents, the Careers Top lists.`);
  console.log('Add it without replacing anything:  cd studio && npx sanity datasets import seed/fundsae-news-seed.ndjson production --missing');
}
