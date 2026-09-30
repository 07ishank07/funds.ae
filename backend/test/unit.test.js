// Unit tests for the building blocks. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUrl, articleIdFor } from '../src/lib/url.js';
import { htmlToText, truncate, extractAmounts, cleanExcerpt } from '../src/lib/text.js';
import { parseFeed, FeedParseError } from '../src/lib/feedParser.js';
import { buildClassifier, classifyArticle } from '../src/lib/classify.js';
import { buildQualityRules, assessQuality } from '../src/lib/quality.js';
import { fingerprint, similarity } from '../src/lib/grouping.js';
import { validateSponsors } from '../src/pipeline/sponsors.js';
import { buildJobRules, isUaeLocation, isRelevantJob } from '../src/pipeline/jobs.js';
import { isSafePublicUrl } from '../src/lib/http.js';
import { readJson, CONFIG_DIR } from '../src/config.js';
import path from 'node:path';

const taxonomy = readJson(path.join(CONFIG_DIR, 'taxonomy.json'));
const settings = readJson(path.join(CONFIG_DIR, 'settings.json'));

test('canonical URLs collapse tracking parameters, www, protocol, trailing slash and fragments', () => {
  const a = canonicalizeUrl('http://www.Example.com/news/story-1/?utm_source=rss&utm_medium=x&id=5#top');
  const b = canonicalizeUrl('https://example.com/news/story-1?id=5');
  assert.equal(a, b);
  assert.equal(articleIdFor(a), articleIdFor(b));
  assert.notEqual(canonicalizeUrl('https://example.com/a?id=5'), canonicalizeUrl('https://example.com/a?id=6'));
  assert.equal(canonicalizeUrl('javascript:alert(1)'), null);
  assert.equal(canonicalizeUrl('https://example.com/story/amp/'), canonicalizeUrl('https://example.com/story'));
});

test('HTML is reduced to plain text with no markup or scripts', () => {
  const out = htmlToText('<p>Deal &amp; <b>close</b></p><script>alert(1)</script>&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(out.includes('<'), false);
  assert.equal(out.includes('alert'), false);
  assert.match(out, /Deal & close/);
  assert.equal(cleanExcerpt('Text here. The post Foo appeared first on Bar.'), 'Text here.');
});

test('excerpts are truncated at a word boundary', () => {
  const t = truncate('word '.repeat(100), 50);
  assert.ok(t.length <= 50);
  assert.ok(t.endsWith('…'));
});

test('money amounts normalise across formats', () => {
  assert.deepEqual(extractAmounts('raises $45 million'), ['usd45m']);
  assert.deepEqual(extractAmounts('raises $45m'), ['usd45m']);
  assert.deepEqual(extractAmounts('AED 1.2bn deal'), ['aed1.2b']);
});

test('feed parser handles RSS 2.0, Atom and RSS 1.0', () => {
  const rss = parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
    <item><title>A &amp; B</title><link>https://e.com/a</link><guid>g1</guid><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate>
    <description>Hi</description><enclosure url="https://e.com/i.jpg" type="image/jpeg"/></item></channel></rss>`);
  assert.equal(rss.items.length, 1);
  assert.equal(rss.items[0].title, 'A & B');
  assert.equal(rss.items[0].images[0], 'https://e.com/i.jpg');
  assert.ok(rss.items[0].publishedAt instanceof Date);

  const atom = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title>
    <entry><title>X</title><id>i1</id><link rel="alternate" href="https://e.com/x"/><updated>2026-09-28T10:00:00Z</updated></entry></feed>`);
  assert.equal(atom.items[0].link, 'https://e.com/x');

  const rdf = parseFeed(`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
    <item><title>R</title><link>https://e.com/r</link></item></rdf:RDF>`);
  assert.equal(rdf.items[0].title, 'R');
});

test('feed parser rejects web pages and neutralises entity-expansion attacks', () => {
  assert.throws(() => parseFeed('<html><body>Not a feed</body></html>'), FeedParseError);
  const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]>
    <rss version="2.0"><channel><item><title>&lol2; headline here</title><link>https://e.com/b</link></item></channel></rss>`;
  const out = parseFeed(bomb);
  assert.equal(out.items.length, 1);
  assert.ok(!out.items[0].title.includes('lollol'));
});

test('classifier separates UAE from Rest of the World and picks a topic', () => {
  const c = buildClassifier(taxonomy);
  const uae = classifyArticle(c, { title: 'Abu Dhabi fund closes $500m private credit fund', summary: '' }, { region: 'global' }, settings);
  assert.equal(uae.category, 'uae');
  assert.equal(uae.topic, 'private-credit');

  const world = classifyArticle(c, { title: 'Berlin start-up raises $60m Series B', summary: 'Investors from Abu Dhabi took part.' }, { region: 'global' }, settings);
  assert.equal(world.category, 'world');
  assert.equal(world.topic, 'venture-capital');

  const offTopic = classifyArticle(c, { title: 'UAE football league announces new season', summary: '' }, { region: 'uae' }, settings);
  assert.ok(offTopic.relevance < settings.news.relevanceThreshold);
});

test('quality rules drop opinion, advertorials, podcasts and stale items but keep ordinary news', () => {
  const rules = buildQualityRules(taxonomy);
  const now = new Date();
  const base = { link: 'https://e.com/news/x', publishedAt: now, categories: [] };
  assert.equal(assessQuality(rules, { ...base, title: 'Opinion: Why LPs are wrong about fees' }, settings, now).reason, 'opinion');
  assert.equal(assessQuality(rules, { ...base, title: 'Sponsored: The best fund admin platform' }, settings, now).reason, 'advertorial');
  assert.equal(assessQuality(rules, { ...base, title: 'Podcast: Private credit in 2026 explained' }, settings, now).reason, 'not-an-article');
  assert.equal(assessQuality(rules, { ...base, title: 'Fund manager raises money', link: 'https://e.com/opinion/x' }, settings, now).reason, 'opinion');
  assert.equal(assessQuality(rules, { ...base, title: 'Manager promoted to chief investment officer at fund' }, settings, now).ok, true);
  assert.equal(assessQuality(rules, { ...base, title: 'Old news about a fund close', publishedAt: new Date(now - 90 * 864e5) }, settings, now).reason, 'too-old');
});

test('story grouping matches rewrites of the same event and not unrelated news', () => {
  const cfg = settings.news.grouping;
  const fp = (title) => fingerprint({ title });
  const a = fp('Dubai-based fintech Qirsh raises $45 million Series B led by Sandline Ventures');
  const b = fp('Qirsh lands $45 million to take buy-now-pay-later across the Gulf');
  const c = fp('Qirsh secures $45m in Series B round as Dubai payments start-up expands to Riyadh');
  const d = fp('Dubai-based fintech Tabby raises $200 million Series E');
  const e = fp('Dubai property prices climb as buyers return');
  assert.equal(similarity(a, b, cfg).match, true);
  assert.equal(similarity(a, c, cfg).match, true);
  assert.equal(similarity(a, d, cfg).match, false);
  assert.equal(similarity(a, e, cfg).match, false);
});

test('sponsor validation blocks unsafe links and images', () => {
  const ok = validateSponsors({ sponsoredPosts: [{ id: 'a', title: 'T', url: 'https://x.com', image: 'assets/sponsors/a.png', colorFrom: '#137A72' }] });
  assert.equal(ok.errors.length, 0);
  const bad = validateSponsors({
    sponsoredPosts: [
      { id: 'b', title: 'T', url: 'javascript:alert(1)' },
      { id: 'c', title: 'T', url: '#', image: '../../secrets.png' },
      { id: 'd', title: 'T', url: '#', image: 'assets/sponsors/x.svg' },
      { id: 'e', title: 'T', url: '#', colorFrom: 'red;background:url(x)' }
    ]
  });
  assert.equal(bad.errors.length, 4);
});

test('job filters keep UAE finance roles only', () => {
  const rules = buildJobRules(taxonomy);
  assert.equal(isUaeLocation(rules, 'DIFC, Dubai'), true);
  assert.equal(isUaeLocation(rules, 'Remote - UAE'), true);
  assert.equal(isUaeLocation(rules, 'London, UK'), false);
  assert.equal(isRelevantJob(rules, { title: 'Private Equity Associate' }), true);
  assert.equal(isRelevantJob(rules, { title: 'Head Chef' }), false);
});

test('outbound requests refuse private and loopback addresses', () => {
  assert.equal(isSafePublicUrl('https://gulfbusiness.com/feed/'), true);
  for (const bad of ['http://localhost/x', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest', 'http://[::1]/', 'file:///etc/passwd']) {
    assert.equal(isSafePublicUrl(bad), false, bad);
  }
});
