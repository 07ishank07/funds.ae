// Phase 1: source registry rules, the live source list, excerpt/image behaviour, feed dates,
// and the check-sources script (against a local mock server).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { validateSources, withNewsDefaults, loadAll, readJson, CONFIG_DIR, NEWS_SOURCE_DEFAULTS } from '../src/config.js';
import { normaliseItem } from '../src/pipeline/news.js';
import { toDate, parseFeed } from '../src/lib/feedParser.js';
import { checkFeed, main, formatLine } from '../scripts/check-sources.mjs';

process.env.FUNDSAE_ALLOW_PRIVATE_URLS = '1'; // the mock feed server runs on localhost

const settings = readJson(path.join(CONFIG_DIR, 'settings.json'));
const now = new Date('2026-09-30T08:00:00Z');
const liveSource = {
  id: 'example-news', name: 'Example News', homepage: 'https://example.com', type: 'rss',
  url: 'https://example.com/feed/', enabled: true, region: 'global', focus: 'general-business',
  priority: 2, tier: 'L3', licenseStatus: 'pending_review'
};
const errorsFor = (overrides, { demo = false } = {}) =>
  validateSources([{ ...liveSource, ...overrides }], 'news', { demo });
const withoutKey = (obj, key) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

/* ------------------------------- config rules ------------------------------ */

test('a complete live news source passes', () => {
  assert.deepEqual(errorsFor({}), []);
});

test('live sources must state tier and licence status; demo sources get safe defaults', () => {
  const live = validateSources([withoutKey(withoutKey(liveSource, 'tier'), 'licenseStatus')], 'news', { demo: false });
  assert.ok(live.some((e) => /"tier" is required/.test(e)), live.join('\n'));
  assert.ok(live.some((e) => /"licenseStatus" is required/.test(e)), live.join('\n'));

  const demoSource = { id: 'demo-feed', name: 'Demo', type: 'rss', fixture: 'news/x.xml', region: 'uae', focus: 'general-business' };
  assert.deepEqual(validateSources([demoSource], 'news', { demo: true }), []);
  const filled = withNewsDefaults(demoSource);
  assert.equal(filled.allowImages, false, 'images are opt-in');
  assert.equal(filled.allowExcerpt, true);
  assert.equal(filled.language, 'en');
  assert.equal(filled.pollEveryHours, 24);
  assert.equal(filled.licenseStatus, 'pending_review');
  assert.equal(withNewsDefaults({ ...demoSource, allowImages: true }).allowImages, true, 'explicit values win');
  assert.deepEqual(Object.keys(NEWS_SOURCE_DEFAULTS).sort(), ['allowExcerpt', 'allowImages', 'language', 'licenseStatus', 'pollEveryHours', 'tier']);
});

test('each licensing and scheduling field is checked with a clear message', () => {
  const cases = [
    [{ tier: 'L9' }, /"tier" must be one of L1, L2, L3, L4, L5/],
    [{ licenseStatus: 'approved' }, /"licenseStatus" must be one of/],
    [{ termsUrl: 'http://example.com/terms' }, /"termsUrl" must be a link starting with https:\/\//],
    [{ termsReviewedAt: '2026-13-01' }, /"termsReviewedAt" must be a real date/],
    [{ termsReviewedAt: '2099-01-01' }, /not in the future/],
    [{ allowExcerpt: 'yes' }, /"allowExcerpt" must be true or false/],
    [{ allowImages: 'false' }, /"allowImages" must be true or false/],
    [{ enabled: 'true' }, /"enabled" must be true or false/],
    [{ language: 'english' }, /"language" must be a two-letter code/],
    [{ pollEveryHours: 0 }, /"pollEveryHours" must be a whole number from 1 to 168/],
    [{ pollEveryHours: 2.5 }, /"pollEveryHours" must be a whole number/],
    [{ priority: 0 }, /"priority" must be a whole number from 1/],
    [{ notes: 42 }, /"notes" must be text/]
  ];
  for (const [overrides, pattern] of cases) {
    const errors = errorsFor(overrides);
    assert.ok(errors.some((e) => pattern.test(e)), `${JSON.stringify(overrides)} -> ${errors.join(' | ') || 'no error'}`);
  }
});

test('reviewed terms must be recorded, and blocked sources must be disabled', () => {
  const reviewed = errorsFor({ licenseStatus: 'terms_reviewed' });
  assert.ok(reviewed.some((e) => /"termsUrl" is required/.test(e)));
  assert.ok(reviewed.some((e) => /"termsReviewedAt" \(YYYY-MM-DD\) is required/.test(e)));
  assert.deepEqual(errorsFor({ licenseStatus: 'terms_reviewed', termsUrl: 'https://example.com/terms', termsReviewedAt: '2026-09-01' }), []);
  assert.ok(errorsFor({ licenseStatus: 'permission_granted' }).some((e) => /"termsReviewedAt"/.test(e)));
  assert.ok(errorsFor({ licenseStatus: 'blocked' }).some((e) => /must have "enabled": false/.test(e)));
  assert.deepEqual(errorsFor({ licenseStatus: 'blocked', enabled: false }), []);
});

test('misspelt or unknown fields are reported, with a hint where one is likely', () => {
  const errors = errorsFor({ licenceStatus: 'wire', colour: 'red' });
  assert.ok(errors.some((e) => /unknown field "licenceStatus". Did you mean "licenseStatus"\?/.test(e)));
  assert.ok(errors.some((e) => /unknown field "colour". Remove it/.test(e)));
});

test('API entries are allowed only while disabled', () => {
  assert.ok(errorsFor({ type: 'api' }).some((e) => /no adapter yet/.test(e)));
  const disabled = errorsFor({ type: 'api', enabled: false });
  assert.deepEqual(disabled, [], 'no jobs-only "board" message for news APIs');
});

/* ------------------------------ live source list ------------------------------ */

test('the live list holds the 100 verified sources, configured by the Phase 1 rules', () => {
  const raw = readJson(path.join(CONFIG_DIR, 'sources.news.json'));
  const section = new Map(raw.sources.map((s) => [s.id, s._section[0]]));
  const previous = process.env.FUNDSAE_MODE;
  process.env.FUNDSAE_MODE = 'live';
  let cfg;
  try { cfg = loadAll(); } finally {
    if (previous === undefined) delete process.env.FUNDSAE_MODE; else process.env.FUNDSAE_MODE = previous;
  }
  const all = cfg.allNewsSources;
  assert.equal(all.length, 100);
  assert.equal(new Set(all.map((s) => s.id)).size, 100, 'ids are unique');

  const priority1 = ['ft-home', 'ft-companies', 'bloomberg-markets', 'bloomberg-business', 'the-national-business',
    'the-national-markets', 'the-national-property', 'pe-hub', 'private-equity-international', 'sec-press-releases',
    'sec-edgar-form-d', 'sec-edgar-api'];
  const priority3 = ['al-jazeera', 'prnewswire-all', 'businesswire-home'];
  for (const s of all) {
    const sec = section.get(s.id);
    assert.match(s.url, /^https:\/\//, s.id);
    assert.equal(s.allowImages, false, `${s.id}: images off until terms are checked`);
    const tier = sec === 'E' ? 'L1' : sec === 'F' ? 'L2' : sec === 'G' ? 'L4' : 'L3';
    assert.equal(s.tier, tier, s.id);
    assert.equal(s.licenseStatus, tier === 'L1' ? 'public_sector' : tier === 'L2' ? 'wire' : 'pending_review', s.id);
    assert.equal(s.region, sec === 'C' ? 'uae' : 'global', s.id);
    assert.equal(s.focus, sec === 'A' || sec === 'B' ? 'private-markets' : 'general-business', s.id);
    assert.equal(s.priority, priority1.includes(s.id) ? 1 : priority3.includes(s.id) ? 3 : 2, s.id);
    if (s.type === 'api') assert.equal(s.enabled, false, `${s.id}: APIs stay disabled`);
    if (s.enabled === false) assert.ok(s.notes, `${s.id}: a disabled source says why`);
  }
  const bySection = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((l) => [l, all.filter((s) => section.get(s.id) === l).length]));
  assert.deepEqual(bySection, { A: 12, B: 17, C: 17, D: 27, E: 15, F: 10, G: 2 });
  assert.equal(all.filter((s) => s.type === 'api').length, 4);
  assert.equal(cfg.newsSources.length, 92, 'enabled = 96 RSS minus the 4 disabled on 2026-09-30');
});

/* --------------------------- excerpts and images --------------------------- */

test('allowExcerpt and allowImages decide what is kept from a feed item', () => {
  const raw = {
    title: 'Fund closes at $500m',
    link: 'https://example.com/fund-closes',
    guid: 'g1',
    summaryHtml: '<p>The manager said the fund was oversubscribed.</p>',
    images: ['https://example.com/image.jpg'],
    publishedAt: now
  };
  const base = withNewsDefaults({ ...liveSource });
  assert.equal(normaliseItem(raw, base, settings, now).summary, 'The manager said the fund was oversubscribed.');
  assert.equal(normaliseItem(raw, base, settings, now).imageUrl, null, 'no images unless the source opts in');
  assert.equal(normaliseItem(raw, { ...base, allowExcerpt: false }, settings, now).summary, '', 'headline + link only');
  assert.equal(normaliseItem(raw, { ...base, allowImages: true }, settings, now).imageUrl, 'https://example.com/image.jpg');
  const httpImage = { ...raw, images: ['http://example.com/image.jpg'] };
  assert.equal(normaliseItem(httpImage, { ...base, allowImages: true }, settings, now).imageUrl, null, 'never mixed content');
});

/* ------------------------------ feed parsing ------------------------------ */

test('feed dates in the formats real sources use are read correctly, in UTC', () => {
  const iso = (s) => toDate(s)?.toISOString() ?? null;
  assert.equal(iso('Mon, 28 Sep 2026 16:45:59 EEST'), '2026-09-28T13:45:59.000Z'); // Wamda
  assert.equal(iso('Monday, September 28, 2026 - 14:29'), '2026-09-28T14:29:00.000Z'); // UK FCA
  assert.equal(iso('Wed, 30 Sep 2026 07:02:35 UT'), '2026-09-30T07:02:35.000Z'); // Business Wire
  assert.equal(iso('Wed, 30 Sep 2026 11:33:43 +0400'), '2026-09-30T07:33:43.000Z');
  assert.equal(iso('Thu, 01 Nov 2018 16:50:27 EDT'), '2018-11-01T20:50:27.000Z');
  assert.equal(iso('2026-09-30 07:28:45'), '2026-09-30T07:28:45.000Z', 'no zone means UTC');
  assert.equal(iso('2026-09-30T07:28:45'), '2026-09-30T07:28:45.000Z');
  assert.equal(iso('not a date'), null);
  assert.equal(iso(''), null);
});

test('large feeds with many ordinary entities parse, while DOCTYPE entity bombs stay neutralised', () => {
  const items = Array.from({ length: 300 }, (_, i) =>
    `<item><title>Deal &amp; fund news ${i} &#8217; &amp; more &amp; more</title><link>https://example.com/${i}</link></item>`).join('');
  const feed = parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items}</channel></rss>`);
  assert.equal(feed.items.length, 300);
  assert.match(feed.items[0].title, /Deal & fund news 0/);
  const bomb = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>
    <rss version="2.0"><channel><item><title>&b;&b;&b; headline</title><link>https://e.com/b</link></item></channel></rss>`;
  assert.ok(!parseFeed(bomb).items[0].title.includes('aaaaaaaaaa'));
});

/* --------------------------- check-sources script --------------------------- */

let server;
let base;
const rss = (dates) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${dates
  .map((d, i) => `<item><title>Item ${i}</title><link>https://example.com/${i}</link><pubDate>${d}</pubDate></item>`).join('')}</channel></rss>`;
before(async () => {
  const fresh = new Date(Date.now() - 2 * 86_400_000).toUTCString();
  const stale = new Date(Date.now() - 40 * 86_400_000).toUTCString();
  server = http.createServer((req, res) => {
    const send = (status, body, type = 'application/rss+xml') => { res.writeHead(status, { 'Content-Type': type }); res.end(body); };
    if (req.url === '/fresh') return send(200, rss([stale, fresh]));
    if (req.url === '/stale') return send(200, rss([stale]));
    if (req.url === '/empty') return send(200, rss([]));
    if (req.url === '/page') return send(200, '<html><body>Not a feed</body></html>', 'text/html');
    if (req.url === '/blocked') return send(403, 'Forbidden', 'text/plain');
    return send(404, 'Not found', 'text/plain');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('check-sources reports fresh, stale, empty, non-feed and blocked sources', async () => {
  const fresh = await checkFeed(`${base}/fresh`);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.format, 'rss');
  assert.equal(fresh.items, 2);
  assert.equal(fresh.newest, new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10), 'newest of all items, not the first');

  const stale = await checkFeed(`${base}/stale`);
  assert.equal(stale.ok, false);
  assert.match(stale.note, /stale: newest item is 40 days old/);

  const empty = await checkFeed(`${base}/empty`);
  assert.equal(empty.ok, false);
  assert.match(empty.note, /no items/);

  const page = await checkFeed(`${base}/page`);
  assert.equal(page.ok, false);
  assert.equal(page.format, 'not-a-feed');

  const blocked = await checkFeed(`${base}/blocked`);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 403);
  assert.match(blocked.note, /ask the publisher for access; do not bypass/);

  assert.match(formatLine('my-source', fresh), /^OK {3}200 rss {8}items=2 {4}newest=\d{4}-\d{2}-\d{2} my-source$/);
});

test('check-sources exits 0 when everything passes, 1 on any failure, 2 without targets', async () => {
  const quiet = () => {};
  assert.equal(await main([`${base}/fresh`], { log: quiet }), 0);
  assert.equal(await main([`${base}/fresh`, `${base}/stale`], { log: quiet }), 1);
  assert.equal(await main([], { log: quiet }), 2);
});
