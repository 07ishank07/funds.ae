// Parses RSS 2.0, Atom 1.0 and RSS 1.0 (RDF) into one simple shape.
// Security: DOCTYPE declarations are removed before parsing, which blocks
// entity-expansion attacks; the parser never loads external resources.

import { XMLParser } from 'fast-xml-parser';
import { isHttpUrl } from './url.js';

const ARRAY_PATHS = new Set([
  'rss.channel.item', 'feed.entry', 'rdf:RDF.item', 'RDF.item',
  'rss.channel.item.category', 'feed.entry.category', 'feed.entry.link',
  'rss.channel.item.media:content', 'rss.channel.item.media:thumbnail', 'rss.channel.item.enclosure',
  'rss.channel.item.media:group.media:content'
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Entity-expansion attacks need entity *definitions* in a DOCTYPE, which parseFeed strips
  // before parsing. What remains are ordinary references (&amp;, &#8217;), whose count grows
  // only linearly with the (5 MB-capped) input. The library's default cap of 1,000 references
  // rejected real feeds such as Business Insider, Axios and the Guardian.
  processEntities: {
    enabled: true,
    maxTotalExpansions: 500000,
    maxExpansionDepth: 10,
    maxEntitySize: 10000,
    maxExpandedLength: 100000,
    maxEntityCount: 100
  },
  htmlEntities: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (_name, jpath) => ARRAY_PATHS.has(jpath)
});

export class FeedParseError extends Error {}

function text(node) {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object') return text(node['#text'] ?? '');
  return '';
}

// Named zones seen in real feeds. Ambiguous abbreviations (AST, BST, IST) are left out.
const ZONES = { UT: '+0000', GST: '+0400', EET: '+0200', EEST: '+0300', CET: '+0100', CEST: '+0200' };
// JavaScript itself understands GMT/UTC and the US zones (EST, EDT, CST, CDT, MST, MDT, PST, PDT).
const hasZone = (s) => /(Z|[+-]\d{2}:?\d{2}|\bGMT|\bUTC|\b[ECMP][SD]T)\s*$/i.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s);
const plausible = (d) => !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 1990 && d.getUTCFullYear() <= 2100;

export function toDate(value) {
  const s = text(value).trim();
  if (!s || !/\d{4}/.test(s)) return null;
  const direct = new Date(s);
  if (plausible(direct) && hasZone(s)) return direct;
  // Normalise what JavaScript can't read: named zones ("EEST") become offsets, and
  // "Monday, September 28, 2026 - 14:29" loses its dash. A date with no zone at all is read
  // as UTC, so the result never depends on the server's own time zone.
  let fixed = s.replace(/\b(UT|GST|EEST|EET|CEST|CET)\b/, (zone) => ZONES[zone]).replace(/\s+-\s+(?=\d{1,2}:\d{2})/, ' ');
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(fixed)) fixed += 'Z';
  else if (!hasZone(fixed)) fixed += ' +0000';
  const normalised = new Date(fixed);
  if (plausible(normalised)) return normalised;
  return plausible(direct) ? direct : null;
}

function isImageish(url, type, medium) {
  if (!isHttpUrl(url)) return false;
  if (medium && medium !== 'image') return false;
  if (type && !String(type).startsWith('image/')) return false;
  return /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url) || String(type).startsWith('image/') || medium === 'image';
}

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function collectImages(item) {
  const found = [];
  const push = (url, w, h) => {
    if (!url || !isHttpUrl(url)) return;
    const width = Number(w) || 0;
    const height = Number(h) || 0;
    if ((width && width < 80) || (height && height < 60)) return; // tracking pixels, icons
    found.push(url.trim());
  };
  for (const m of asArray(item['media:content'])) {
    if (isImageish(m['@_url'], m['@_type'], m['@_medium'])) push(m['@_url'], m['@_width'], m['@_height']);
  }
  for (const m of asArray(item['media:group']?.['media:content'])) {
    if (isImageish(m['@_url'], m['@_type'], m['@_medium'])) push(m['@_url'], m['@_width'], m['@_height']);
  }
  for (const m of asArray(item['media:thumbnail'])) push(m['@_url'], m['@_width'], m['@_height']);
  for (const e of asArray(item.enclosure)) {
    if (isImageish(e['@_url'], e['@_type'])) push(e['@_url']);
  }
  if (item.image?.url) push(text(item.image.url));
  return found;
}

function firstImgInHtml(html) {
  const m = /<img[^>]+src=["']([^"']+)["'][^>]*>/i.exec(String(html || ''));
  if (!m) return null;
  const tag = m[0];
  const w = /width=["']?(\d+)/i.exec(tag)?.[1];
  const h = /height=["']?(\d+)/i.exec(tag)?.[1];
  if ((w && Number(w) < 80) || (h && Number(h) < 60)) return null;
  return isHttpUrl(m[1]) ? m[1] : null;
}

function categories(list) {
  return asArray(list)
    .map((c) => (typeof c === 'object' ? c['@_term'] || c['@_label'] || text(c) : text(c)))
    .map((c) => String(c).trim())
    .filter(Boolean);
}

function atomLink(links) {
  const list = asArray(links).filter((l) => l && l['@_href']);
  const alt = list.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate');
  return (alt || list[0])?.['@_href'] || '';
}

function mapRssItem(item) {
  const guidNode = item.guid;
  const guid = text(guidNode);
  const isPermaLink = typeof guidNode === 'object' ? guidNode['@_isPermaLink'] !== 'false' : false;
  let link = text(item.link) || text(item['feedburner:origLink']);
  if (!link && isPermaLink && isHttpUrl(guid)) link = guid;
  const description = text(item.description);
  const content = text(item['content:encoded']);
  return {
    title: text(item.title),
    link: link.trim(),
    guid: guid || link,
    publishedAt: toDate(item.pubDate) || toDate(item['dc:date']) || toDate(item.published) || null,
    summaryHtml: description,
    contentHtml: content,
    categories: categories(item.category).concat(categories(item['dc:subject'] ? [item['dc:subject']] : [])),
    images: collectImages(item),
    htmlImage: firstImgInHtml(description) || firstImgInHtml(content),
    author: text(item['dc:creator']) || text(item.author)
  };
}

function mapAtomEntry(entry) {
  const summary = text(entry.summary);
  const content = text(entry.content);
  const images = collectImages(entry);
  for (const l of asArray(entry.link)) {
    if (l['@_rel'] === 'enclosure' && isImageish(l['@_href'], l['@_type'])) images.push(l['@_href']);
  }
  return {
    title: text(entry.title),
    link: String(atomLink(entry.link)).trim(),
    guid: text(entry.id) || atomLink(entry.link),
    publishedAt: toDate(entry.published) || toDate(entry.updated) || null,
    summaryHtml: summary,
    contentHtml: content,
    categories: categories(entry.category),
    images,
    htmlImage: firstImgInHtml(summary) || firstImgInHtml(content),
    author: text(entry.author?.name ?? entry.author)
  };
}

export function parseFeed(xml) {
  if (typeof xml !== 'string' || !xml.trim()) throw new FeedParseError('Empty response');
  const cleaned = xml
    .replace(/^\uFEFF/, '')
    .replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, '');
  if (!/<(rss|feed|rdf:RDF|RDF)[\s>]/i.test(cleaned)) {
    throw new FeedParseError('Not an RSS or Atom feed (the URL may point to a web page)');
  }
  let doc;
  try {
    doc = parser.parse(cleaned);
  } catch (err) {
    throw new FeedParseError(`Invalid XML: ${err.message}`);
  }
  if (doc.rss?.channel) {
    const ch = doc.rss.channel;
    return { format: 'rss', title: text(ch.title), items: asArray(ch.item).map(mapRssItem) };
  }
  if (doc.feed) {
    return { format: 'atom', title: text(doc.feed.title), items: asArray(doc.feed.entry).map(mapAtomEntry) };
  }
  const rdf = doc['rdf:RDF'] || doc.RDF;
  if (rdf) {
    const items = asArray(rdf.item);
    return { format: 'rdf', title: text(rdf.channel?.title), items: items.map(mapRssItem) };
  }
  throw new FeedParseError('Unrecognised feed structure');
}
