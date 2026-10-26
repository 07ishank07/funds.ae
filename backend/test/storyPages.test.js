// Static story pages: everything escaped, only safe links, pages rewritten only when they
// change, and only generated pages ever removed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { renderStoryPage, writeStoryPages, escapeHtml, STORY_TEMPLATE, GENERATED_MARKER } = await import('../src/pipeline/storyPages.js');
const template = readFileSync(STORY_TEMPLATE, 'utf8');
const tmp = mkdtempSync(path.join(tmpdir(), 'fundsae-pages-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const story = (extra = {}) => ({
  id: 's_0123456789abcd',
  headline: 'ADIA and CPPIB buy Abu Dhabi logistics park',
  summary: 'Two institutional investors have bought a logistics park in Abu Dhabi.',
  url: 'https://example.com/adia-cppib',
  source: 'Example Wire',
  sourceId: 'example-wire',
  publishedAt: '2026-10-25T06:00:00.000Z',
  imageUrl: null,
  imageCredit: null,
  sources: [{ articleId: 'a_1', source: 'Example Wire', sourceId: 'example-wire', title: 'ADIA and CPPIB buy Abu Dhabi logistics park', url: 'https://example.com/adia-cppib', publishedAt: '2026-10-25T06:00:00.000Z' }],
  slug: 'adia-and-cppib-buy-abu-dhabi-logistics-park-3f2a',
  capitalTypes: [{ id: 'sovereign-wealth', label: 'Sovereign Wealth Funds' }, { id: 'pension-funds', label: 'Pension Funds' }],
  assetClasses: [{ id: 'industrial-logistics', label: 'Industrial & Logistics' }],
  geography: [{ id: 'uae', label: 'UAE' }],
  transactionType: { id: 'acquisition', label: 'Acquisition' },
  featured: false,
  liveAt: '2026-10-26T08:00:00.000Z',
  ...extra
});

test('a story page shows the headline, our summary, the source and a link to the original', () => {
  const html = renderStoryPage(story(), { template });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes(GENERATED_MARKER));
  assert.ok(!/\{\{\w+\}\}/.test(html), 'every placeholder is filled');
  assert.match(html, /<h1>ADIA and CPPIB buy Abu Dhabi logistics park<\/h1>/);
  assert.match(html, /Source: <strong>Example Wire<\/strong>/);
  assert.match(html, /<time datetime="2026-10-25T06:00:00.000Z">25 October 2026<\/time>/);
  assert.match(html, /<a class="read" href="https:\/\/example.com\/adia-cppib" target="_blank" rel="noopener noreferrer">Read the full story at Example Wire/);
  assert.match(html, /<a href="..\/News.dc.html\?capital=sovereign-wealth">Sovereign Wealth Funds<\/a>/);
  assert.match(html, /\?asset=industrial-logistics">Industrial &amp; Logistics<\/a>/);
  assert.match(html, /<span class="deal">Acquisition<\/span>/);
  assert.match(html, /<title>ADIA and CPPIB buy Abu Dhabi logistics park · Funds.ae<\/title>/);
  assert.ok(!html.includes('rel="canonical"'), 'no canonical link without a public address');
  assert.ok(!html.includes('<figure>'), 'no image unless the story carries one');
  assert.ok(html.includes('href="../News.dc.html">Real Estate Capital News</a>'));
});

test('everything from the story is escaped', () => {
  const evil = '<script>alert(1)</script>"\'&';
  const html = renderStoryPage(story({
    headline: `Headline ${evil}`, summary: `Summary ${evil}`, source: `Source ${evil}`,
    sources: [story().sources[0], { source: `Other ${evil}`, title: `Title ${evil}`, url: 'https://other.example/x?a=1&b=2', publishedAt: '2026-10-25T07:00:00Z' }],
    capitalTypes: [{ id: 'reits', label: `REITs ${evil}` }, { id: 'bad id"><script>', label: 'x' }]
  }), { template, seo: { title: `SEO ${evil}`, description: `Desc ${evil}` } });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'no injected script');
  assert.ok((html.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/g) || []).length >= 8, 'every value appears escaped');
  for (const field of ['Headline', 'Summary', 'Source', 'Other', 'Title', 'REITs', 'SEO', 'Desc']) assert.ok(html.includes(`${field} &lt;script&gt;`), field);
  assert.ok(html.includes('href="https://other.example/x?a=1&amp;b=2"'), 'link attributes are escaped');
  const quoted = renderStoryPage(story({ sources: [story().sources[0], { source: 'X', title: 'Quoted', url: 'https://other.example/x?b="2"', publishedAt: '2026-10-25T07:00:00Z' }] }), { template });
  assert.ok(!quoted.includes('Quoted'), 'a link with quotes in it is dropped rather than published');
  assert.ok(!html.includes('bad id'), 'a malformed category id is left out');
  assert.equal(escapeHtml(`<a href='x'>&"`), '&lt;a href=&#39;x&#39;&gt;&amp;&quot;');
});

test('unsafe links and missing slugs are refused; images must be https', () => {
  assert.throws(() => renderStoryPage(story({ url: 'javascript:alert(1)' }), { template }), /no link to the original/);
  assert.throws(() => renderStoryPage(story({ slug: '../../etc/passwd' }), { template }), /no valid slug/);
  const others = renderStoryPage(story({ sources: [story().sources[0], { source: 'X', title: 'Bad', url: 'javascript:alert(1)', publishedAt: '2026-10-25T07:00:00Z' }] }), { template });
  assert.ok(!others.includes('javascript:'), 'an unsafe outlet link is dropped');
  assert.ok(!renderStoryPage(story({ imageUrl: 'http://img.example.com/a.jpg' }), { template }).includes('<figure>'));
  const withImage = renderStoryPage(story({ imageUrl: 'https://cdn.sanity.io/images/p/d/a-1x1.jpg', imageCredit: 'Photo: Example Ltd' }), { template });
  assert.match(withImage, /<img src="https:\/\/cdn.sanity.io\/images\/p\/d\/a-1x1.jpg" alt="" loading="lazy" referrerpolicy="no-referrer"><figcaption>Photo: Example Ltd<\/figcaption>/);
  const feedImage = renderStoryPage(story({ imageUrl: 'https://img.example.com/a.jpg' }), { template });
  assert.match(feedImage, /<figcaption>Image: Example Wire<\/figcaption>/, 'a feed image credits its publisher');
});

test('canonical links and SEO fields when a public address is set', () => {
  const html = renderStoryPage(story(), { template, publicBaseUrl: 'https://funds.ae/', seo: { title: 'ADIA buys logistics park', description: 'A short description.' } });
  assert.match(html, /<link rel="canonical" href="https:\/\/funds.ae\/frontend_demo\/news\/adia-and-cppib-buy-abu-dhabi-logistics-park-3f2a.html">/);
  assert.match(html, /<title>ADIA buys logistics park · Funds.ae<\/title>/);
  assert.match(html, /<meta name="description" content="A short description.">/);
});

test('a story without an Asset Class links back to the home page', () => {
  const html = renderStoryPage(story({ assetClasses: [] }), { template });
  assert.ok(html.includes('href="../this.html">Funds.ae news</a>'));
});

test('pages are written once, rewritten only on change, and only generated pages are removed', () => {
  const dir = path.join(tmp, 'pages');
  const first = writeStoryPages([story(), story({ id: 's_1', slug: 'second-story-1111', headline: 'Second story headline here' })], { dir });
  assert.deepEqual(first, { pages: 2, written: 2, removed: 0 });
  assert.deepEqual(writeStoryPages([story(), story({ id: 's_1', slug: 'second-story-1111', headline: 'Second story headline here' })], { dir }), { pages: 2, written: 0, removed: 0 });
  writeFileSync(path.join(dir, 'hand-made.html'), '<!DOCTYPE html><p>not generated</p>');
  const after = writeStoryPages([story({ headline: 'ADIA and CPPIB buy a large Abu Dhabi logistics park' })], { dir });
  assert.deepEqual(after, { pages: 1, written: 1, removed: 1 });
  assert.deepEqual(readdirSync(dir).sort(), ['adia-and-cppib-buy-abu-dhabi-logistics-park-3f2a.html', 'hand-made.html']);
  assert.ok(existsSync(path.join(dir, 'hand-made.html')), 'a page we did not generate is never deleted');
});
