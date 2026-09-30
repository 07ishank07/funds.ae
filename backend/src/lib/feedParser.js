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
  processEntities: true,
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

function toDate(value) {
  const s = text(value).trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  // Some feeds use "+0400" style offsets V8 misreads, or named zones like "GST".
  const fixed = s.replace(/\b(GST)\b/, '+0400').replace(/\b(UT)\b/, 'GMT');
  const d2 = new Date(fixed);
  return Number.isNaN(d2.getTime()) ? null : d2;
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
