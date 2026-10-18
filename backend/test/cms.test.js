// Sanity CMS integration: mapping, Portable Text sanitising, validation, the
// all-or-nothing pull against a local mock Sanity API, and that the Studio's
// rules (studio/schemaTypes/rules.js) match the rules the backend enforces.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(tmpdir(), 'fundsae-cms-'));
process.env.FUNDSAE_ALLOW_PRIVATE_URLS = '1';
process.env.FUNDSAE_API_DIR = path.join(tmp, 'api');
process.env.LOG_LEVEL = 'debug'; // so a leaked token would show up even in debug lines

const { pullFromSanity, GENERATED_NOTE } = await import('../src/cms/pull.js');
const { mapSanityContent, portableTextToBlocks, toSponsorsConfig } = await import('../src/cms/mapping.js');
const { sanityConfigFromEnv, queryUrl, DEFAULT_API_VERSION } = await import('../src/cms/sanity.js');
const { CONTENT_LIMITS, safeHref, validateContent } = await import('../src/pipeline/content.js');
const { SLOT_RULES } = await import('../src/pipeline/sponsors.js');
const { validateEvents } = await import('../src/pipeline/events.js');
const { publishContent } = await import('../src/pipeline/publish.js');
const { ADVERTISING_TIERS, DTO_FIELDS, ENVELOPE_FIELDS, PAGE_SLUGS, SPONSOR_SLOTS } = await import('../src/contracts/models.js');
const studio = await import('../../studio/schemaTypes/rules.js');

const NOW = new Date('2026-10-07T06:00:00Z');
const TOKEN = 'skTESTtoken0123456789abcdefSECRET';
const settings = { userAgent: 'FundsAeNewsBot/1.0 (test)' };
const sameKeys = (obj, fields, where) => assert.deepEqual(Object.keys(obj).sort(), [...fields].sort(), where);

const privacyBody = () => [
  { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: '1. What we collect', marks: [] }] },
  {
    _type: 'block',
    style: 'normal',
    markDefs: [
      { _key: 'l1', _type: 'link', href: 'https://funds.ae/contact' },
      { _key: 'bad', _type: 'link', href: 'javascript:alert(1)' }
    ],
    children: [
      { _type: 'span', text: 'We collect your ', marks: [] },
      { _type: 'span', text: 'email', marks: ['strong'] },
      { _type: 'span', text: ' when you ', marks: [] },
      { _type: 'span', text: 'contact us', marks: ['l1'] },
      { _type: 'span', text: ' and ', marks: [] },
      { _type: 'span', text: 'click here', marks: ['bad'] },
      { _type: 'span', text: '.', marks: [] }
    ]
  },
  { _type: 'block', style: 'normal', listItem: 'bullet', markDefs: [], children: [{ _type: 'span', text: 'Morning brief', marks: ['em', 'underline'] }] },
  { _type: 'image', asset: { _ref: 'image-abc-200x200-png' } },
  { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: '  Quote‮ with bidi  ', marks: [] }] }
];

/** A CONTENT_QUERY result as Sanity returns it. */
const fixture = () => ({
  sponsors: [
    {
      id: 'gulf-horizon', slot: 'founding', title: 'Gulf Horizon Capital', blurb: 'Private credit across the GCC.',
      label: 'left over from another slot', logoText: null, website: null, url: 'https://gulfhorizon.example/', colorFrom: '#137A72', colorTo: null,
      image: { url: 'https://cdn.sanity.io/images/ab12cd34/production/abc123-200x200.png', mimeType: 'image/png', size: 20480 }
    },
    { id: 'sandhaven-capital', slot: 'platinum', title: 'Sandhaven Capital', blurb: 'not used by platinum', url: null, colorFrom: '#0E3A43', colorTo: '#4FB3B8', image: null },
    {
      id: 'cv-guide', slot: 'careerResources', title: 'Write a finance CV', logoText: 'CV', url: 'https://careers.example/cv', colorFrom: '#356A78', colorTo: '#1F6A6E',
      image: { url: 'https://cdn.sanity.io/images/ab12cd34/production/def456-100x100.png', mimeType: 'image/png', size: 900 }
    }
  ],
  events: [
    { id: 'fund-forum', title: 'Fund Managers Forum', eventType: 'Finance week', startDate: '2026-10-20', endDate: '2026-10-22', city: 'Dubai', venue: null, url: 'https://forum.example/', organiser: 'Forum Co', featured: true }
  ],
  highlights: [
    { id: 'abu-dhabi-finance', accountName: 'Abu Dhabi Finance', handle: 'adfinance', text: 'Fund managers keep moving into ADGM this quarter.', url: 'https://x.com/adfinance/status/1234567890', initials: 'AF', color: '#607A5A' }
  ],
  tiers: [
    { tier: 'gold', name: 'Gold Partner', badge: 'Most popular', price: 'AED 9,500', priceNote: '/ month', features: ['A Gold Sponsors tile', 'One Videos and Podcasts placement'], featured: true },
    { tier: 'exclusive', name: 'Elite Exclusive Partner', badge: null, price: 'On request', priceNote: null, features: ['The founding banner on every page'], featured: false }
  ],
  pages: [{ slug: 'privacy', title: 'Privacy Policy', intro: null, updatedAt: '2026-10-01', body: privacyBody() }]
});

/* ------------------------------ mock Sanity API ------------------------------ */

let server;
let baseUrl;
let respond = () => ({ status: 200, body: { result: fixture() } });
const requests = [];
before(async () => {
  server = http.createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized', message: 'Session not found' }));
    }
    const { status, body } = respond(req);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
});

const env = { SANITY_PROJECT_ID: 'ab12cd34', SANITY_DATASET: 'production', SANITY_READ_TOKEN: TOKEN };
const fast = { baseUrl: undefined, retries: 0, retryBaseDelayMs: 1, timeoutMs: 2000 };

function freshConfigDir(name) {
  const dir = path.join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'events.json'), JSON.stringify({ _help: ['keep me'], demoFixture: 'events/demo-events.json', events: [] }, null, 2));
  writeFileSync(path.join(dir, 'sponsors.json'), '{"founding": []}\n');
  return dir;
}

/** Runs fn while capturing everything written to stdout and stderr. */
async function captureOutput(fn) {
  const out = [];
  const original = { stdout: process.stdout.write, stderr: process.stderr.write };
  process.stdout.write = (chunk, ...rest) => { out.push(String(chunk)); return original.stdout.call(process.stdout, chunk, ...rest); };
  process.stderr.write = (chunk, ...rest) => { out.push(String(chunk)); return original.stderr.call(process.stderr, chunk, ...rest); };
  try {
    return { result: await fn(), output: out.join('') };
  } catch (err) {
    return { error: err, output: out.join('') };
  } finally {
    process.stdout.write = original.stdout;
    process.stderr.write = original.stderr;
  }
}

/* -------------------------------- configuration ------------------------------ */

test('Sanity settings come from the environment and are checked', () => {
  assert.deepEqual(sanityConfigFromEnv(env), { projectId: 'ab12cd34', dataset: 'production', apiVersion: DEFAULT_API_VERSION, token: TOKEN });
  assert.equal(sanityConfigFromEnv({ SANITY_PROJECT_ID: 'ab12cd34' }).token, null, 'a public dataset needs no token');
  assert.throws(() => sanityConfigFromEnv({}), /SANITY_PROJECT_ID is not set/);
  assert.throws(() => sanityConfigFromEnv({ SANITY_PROJECT_ID: 'AB/../x' }), /SANITY_PROJECT_ID/);
  assert.throws(() => sanityConfigFromEnv({ SANITY_PROJECT_ID: 'ab12cd34', SANITY_DATASET: 'prod?x=1' }), /SANITY_DATASET/);
  assert.throws(() => sanityConfigFromEnv({ SANITY_PROJECT_ID: 'ab12cd34', SANITY_API_VERSION: 'latest' }), /SANITY_API_VERSION/);
  const url = new URL(queryUrl(sanityConfigFromEnv(env), '*[_type == "event"]'));
  assert.equal(url.origin, 'https://ab12cd34.api.sanity.io');
  assert.equal(url.pathname, `/v${DEFAULT_API_VERSION}/data/query/production`);
  assert.equal(url.searchParams.get('perspective'), 'published', 'drafts are never fetched');
});

/* ----------------------------------- mapping --------------------------------- */

test('sponsors map onto the sponsors.json slots, keeping only the fields each slot uses', () => {
  const { config, errors } = toSponsorsConfig(fixture().sponsors);
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(config), SPONSOR_SLOTS);
  assert.deepEqual(config.founding, [{
    id: 'gulf-horizon', enabled: true, url: 'https://gulfhorizon.example/', title: 'Gulf Horizon Capital',
    blurb: 'Private credit across the GCC.', image: 'https://cdn.sanity.io/images/ab12cd34/production/abc123-200x200.png'
  }], 'label and colours are not founding fields, so they are dropped');
  assert.ok(!('blurb' in config.platinum[0]), 'a value left in a hidden field never reaches the site');
  assert.ok(!('image' in config.careerResources[0]), 'career resources take no image');
});

test('sponsor images must be PNG, JPG or WebP up to 500 KB', () => {
  const doc = (image) => [{ id: 'x-co', slot: 'gold', title: 'X Co', image }];
  assert.match(toSponsorsConfig(doc({ url: 'https://cdn.sanity.io/a.svg', mimeType: 'image/svg+xml', size: 10 })).errors[0], /PNG, JPG or WebP/);
  assert.match(toSponsorsConfig(doc({ url: 'https://cdn.sanity.io/a.png', mimeType: 'image/png', size: 600 * 1024 })).errors[0], /600 KB; the limit is 500 KB/);
  assert.match(toSponsorsConfig([{ id: 'y-co', title: 'Y Co' }]).errors[0], /choose where it appears/);
});

test('Portable Text becomes safe blocks: known styles only, unsafe links dropped, hidden characters removed', () => {
  assert.deepEqual(portableTextToBlocks(privacyBody()), [
    { type: 'h2', list: null, spans: [{ text: '1. What we collect', bold: false, italic: false, href: null }] },
    {
      type: 'p', list: null, spans: [
        { text: 'We collect your ', bold: false, italic: false, href: null },
        { text: 'email', bold: true, italic: false, href: null },
        { text: ' when you ', bold: false, italic: false, href: null },
        { text: 'contact us', bold: false, italic: false, href: 'https://funds.ae/contact' },
        { text: ' and click here.', bold: false, italic: false, href: null }
      ]
    },
    { type: 'li', list: 'bullet', spans: [{ text: 'Morning brief', bold: false, italic: true, href: null }] },
    { type: 'p', list: null, spans: [{ text: 'Quote with bidi', bold: false, italic: false, href: null }] }
  ]);
  assert.deepEqual(portableTextToBlocks('not an array'), []);
});

test('links in page copy are https or a single mailto address', () => {
  assert.equal(safeHref('https://funds.ae/about'), 'https://funds.ae/about');
  assert.equal(safeHref('mailto:news@funds.ae'), 'mailto:news@funds.ae');
  for (const bad of ['javascript:alert(1)', 'http://funds.ae', 'data:text/html,x', 'mailto:not an address', 'https://user:pw@funds.ae', '//funds.ae', 42]) {
    assert.equal(safeHref(bad), null, String(bad));
  }
});

/* --------------------------------- validation -------------------------------- */

test('published content has exactly the contract fields, with null (never "") for missing values', () => {
  const mapped = mapSanityContent(fixture());
  const { errors, content } = validateContent(mapped.content, { now: NOW });
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(content.slots).sort(), ['advertiseTiers', 'socialHighlights']);
  for (const item of content.slots.socialHighlights) sameKeys(item, DTO_FIELDS.socialHighlight, item.id);
  for (const tier of content.slots.advertiseTiers) sameKeys(tier, DTO_FIELDS.advertiseTier, tier.id);
  assert.equal(content.slots.advertiseTiers[1].badge, null);
  const page = content.pages.privacy;
  sameKeys(page, DTO_FIELDS.page, 'page');
  for (const block of page.blocks) {
    sameKeys(block, DTO_FIELDS.pageBlock, 'block');
    for (const span of block.spans) sameKeys(span, DTO_FIELDS.pageSpan, 'span');
  }
  assert.equal(page.intro, null);

  const written = publishContent({ settings: { mode: 'live' }, now: NOW }, content);
  const doc = JSON.parse(readFileSync(path.join(tmp, 'api', 'content.json'), 'utf8'));
  for (const key of ENVELOPE_FIELDS) assert.ok(key in doc, `content.json lacks ${key}`);
  assert.deepEqual(doc.pages.privacy, page);
  assert.match(written.version, /^[a-f0-9]{12}$/);
  assert.deepEqual(written.counts, { socialHighlights: 1, advertiseTiers: 2, pages: 1 });
});

test('invalid content is explained in plain language', () => {
  const highlight = fixture().highlights[0];
  const tier = { id: 'gold', name: 'Gold', price: 'AED 1', features: ['One line'] };
  const page = { slug: 'terms', title: 'Terms', blocks: [{ type: 'p', list: null, spans: [{ text: 'Hi' }] }] };
  const errorsFor = (config) => validateContent(config, { now: NOW }).errors.join('\n');

  assert.match(errorsFor({ socialHighlights: [{ ...highlight, url: 'https://evil.example/status/1' }] }), /one post on x\.com/);
  assert.match(errorsFor({ socialHighlights: [{ ...highlight, handle: '@adfinance' }] }), /without the @/);
  assert.match(errorsFor({ socialHighlights: Array.from({ length: 6 }, (_, i) => ({ ...highlight, id: `account-${i}` })) }), /room for 5/);
  assert.match(errorsFor({ advertiseTiers: [{ ...tier, id: 'diamond' }] }), /"id" Choose one of the listed options/);
  assert.match(errorsFor({ advertiseTiers: [tier, { ...tier }] }), /duplicate id/);
  assert.match(errorsFor({ advertiseTiers: [{ ...tier, features: Array(9).fill('A line') }] }), /Give 1 to 8 lines/);
  assert.match(errorsFor({ advertiseTiers: [{ ...tier, colour: 'red' }] }), /"colour" Unknown field/);
  assert.match(errorsFor({ pages: [{ ...page, blocks: [{ type: 'p', list: null, spans: [{ text: 'x', href: 'javascript:alert(1)' }] }] }] }), /https:\/\/ or mailto:/);
  assert.match(errorsFor({ pages: [{ ...page, blocks: [{ type: 'li', list: null, spans: [{ text: 'x' }] }] }] }), /list "bullet" or "number"/);
  assert.match(errorsFor({ pages: [{ ...page, blocks: [{ type: 'p', list: null, spans: [{ text: 'x'.repeat(2001) }] }] }] }), /split it/);
  assert.match(errorsFor({ pages: [{ ...page, slug: 'careers' }] }), /"slug"/);
  assert.match(errorsFor({ banners: [] }), /Unknown group "banners"/);
  assert.deepEqual(validateContent({}, { now: NOW }).errors, [], 'an empty file is valid');
  assert.deepEqual(validateContent({ advertiseTiers: [{ ...tier, enabled: false, id: 'diamond' }] }, { now: NOW }).errors.length, 1, 'disabled items are still checked');
});

/* ------------------------------------ pull ----------------------------------- */

test('cms:pull writes all three config files from published Sanity content', async () => {
  const dir = freshConfigDir('pull-ok');
  requests.length = 0;
  const { result, output, error } = await captureOutput(() => pullFromSanity({ settings, now: NOW, env, configDir: dir, http: { ...fast, baseUrl } }));
  assert.ifError(error);
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  assert.equal(requests.length, 1);
  const url = new URL(requests[0].url, baseUrl);
  assert.equal(url.pathname, `/v${DEFAULT_API_VERSION}/data/query/production`);
  assert.equal(url.searchParams.get('perspective'), 'published');
  assert.match(url.searchParams.get('query'), /_type == "sponsorItem" && enabled != false/);
  assert.equal(requests[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.ok(!output.includes(TOKEN), 'the read token never appears in the logs');

  const read = (f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  const sponsors = read('sponsors.json');
  assert.equal(sponsors._generated, GENERATED_NOTE);
  assert.equal(sponsors.founding[0].title, 'Gulf Horizon Capital');
  const events = read('events.json');
  assert.deepEqual(events._help, ['keep me']);
  assert.equal(events.demoFixture, 'events/demo-events.json', 'demo mode keeps its fictional events');
  assert.deepEqual(events.events, [{ id: 'fund-forum', title: 'Fund Managers Forum', eventType: 'Finance week', startDate: '2026-10-20', endDate: '2026-10-22', city: 'Dubai', url: 'https://forum.example/', organiser: 'Forum Co', featured: true }]);
  const content = read('content.json');
  assert.equal(content.socialHighlights[0].handle, 'adfinance');
  assert.equal(content.advertiseTiers[0].id, 'gold');
  assert.equal(content.pages[0].slug, 'privacy');
  assert.equal(content.pages[0].blocks.length, 4);
  assert.deepEqual(result.counts.pages, ['privacy']);
});

test('cms:pull writes nothing when any item is invalid, so the site keeps its last good content', async () => {
  const dir = freshConfigDir('pull-invalid');
  const before = ['events.json', 'sponsors.json'].map((f) => readFileSync(path.join(dir, f), 'utf8'));
  respond = () => {
    const bad = fixture();
    bad.highlights[0].url = 'https://evil.example/post';
    bad.events[0].endDate = '2026-10-01';
    bad.sponsors.push(...Array.from({ length: 2 }, (_, i) => ({ id: `extra-${i}`, slot: 'founding', title: `Extra ${i}` })));
    return { status: 200, body: { result: bad } };
  };
  try {
    const result = await pullFromSanity({ settings, now: NOW, env, configDir: dir, http: { ...fast, baseUrl } });
    assert.equal(result.ok, false);
    const all = result.errors.join('\n');
    assert.match(all, /socialHighlights #1/);
    assert.match(all, /endDate/);
    assert.match(all, /founding: 3 items are enabled but the page has room for 1/);
    assert.deepEqual(['events.json', 'sponsors.json'].map((f) => readFileSync(path.join(dir, f), 'utf8')), before);
    assert.throws(() => readFileSync(path.join(dir, 'content.json')), /ENOENT/);
  } finally {
    respond = () => ({ status: 200, body: { result: fixture() } });
  }
});

test('a rejected token gives a clear message without echoing the token', async () => {
  const { error, output } = await captureOutput(() =>
    pullFromSanity({ settings, now: NOW, env: { ...env, SANITY_READ_TOKEN: `${TOKEN}-wrong` }, configDir: freshConfigDir('pull-401'), http: { ...fast, baseUrl } }));
  assert.match(error?.message || '', /refused the read token/);
  assert.ok(!error.message.includes(TOKEN) && !output.includes(TOKEN));
});

/* ------------------------------------ seed ------------------------------------ */

test('the seed import (npm run cms:seed) holds today\'s content and passes the backend checks once published', async () => {
  const { buildSeed } = await import('../scripts/cms-seed.mjs');
  const docs = buildSeed();
  const of = (type) => docs.filter((d) => d._type === type);
  assert.ok(docs.every((d) => /^[A-Za-z0-9_-]+$/.test(d._id)), 'ids without dots, so the documents are not private paths');
  assert.deepEqual(of('page').map((p) => p._id).sort(), ['page-about', 'page-privacy', 'page-terms'], 'the fixed page documents the Studio opens');
  assert.deepEqual(of('advertiseTier').map((t) => t.tier).sort(), [...ADVERTISING_TIERS].sort());
  assert.ok(of('page').every((p) => !p.body.some((b) => b.children.some((c) => /Our team|Rania/.test(c.text)))), 'About keeps its team grid out of the copy');

  // What CONTENT_QUERY would return for these documents once published (images aside).
  const result = {
    sponsors: of('sponsorItem').map(({ _id, _type, id, position, enabled, image, ...rest }) => ({ id: id.current, ...rest, image: null })),
    events: of('event').map(({ _id, _type, id, ...rest }) => ({ id: id.current, ...rest })),
    highlights: [],
    tiers: of('advertiseTier').map(({ _id, _type, position, enabled, ...rest }) => rest),
    pages: of('page').map(({ _id, _type, ...rest }) => ({ updatedAt: null, intro: null, ...rest }))
  };
  const mapped = mapSanityContent(result);
  assert.deepEqual(mapped.errors, []);
  const { validateSponsors } = await import('../src/pipeline/sponsors.js');
  assert.deepEqual(validateSponsors(mapped.sponsors).errors, [], 'every seeded sponsor is valid and every slot is within its limit');
  const content = validateContent(mapped.content, { now: NOW });
  assert.deepEqual(content.errors, []);
  assert.equal(content.content.slots.advertiseTiers.length, 4);
  const privacy = content.content.pages.privacy;
  assert.ok(privacy.blocks.some((b) => b.spans.some((s) => s.href === 'https://funds.ae/frontend_demo/Contact.dc.html')), 'relative links become https links on the site');
  assert.ok(privacy.blocks.some((b) => b.type === 'li' && b.list === 'bullet'));
});

/* ------------------------- Studio rules == backend rules ---------------------- */

test('the Studio enforces the same sponsor rules as the backend', () => {
  assert.deepEqual(Object.keys(studio.SPONSOR_SLOTS), SPONSOR_SLOTS);
  for (const slot of SPONSOR_SLOTS) {
    const { label, where, ...rules } = studio.SPONSOR_SLOTS[slot];
    assert.ok(label && where, `${slot} has a label and help text`);
    assert.deepEqual(rules, SLOT_RULES[slot], `studio/schemaTypes/rules.js ${slot} differs from SLOT_RULES`);
  }
});

test('the Studio enforces the same content limits as the backend', () => {
  assert.deepEqual(studio.HIGHLIGHT_LIMITS, CONTENT_LIMITS.highlights);
  assert.deepEqual(studio.TIER_LIMITS, CONTENT_LIMITS.tiers);
  assert.deepEqual(studio.PAGE_LIMITS, CONTENT_LIMITS.pages);
  assert.deepEqual(studio.TIER_IDS, ADVERTISING_TIERS);
  assert.deepEqual(studio.PAGE_SLUGS, PAGE_SLUGS);
});

test('the Studio event limits match what the backend accepts', () => {
  const base = { id: 'limit-test', title: 'Limit test', eventType: 'Forum', startDate: '2026-11-01', city: 'Dubai' };
  const ok = (patch) => validateEvents([{ ...base, ...patch }], { now: NOW, demo: false }).errors.length === 0;
  for (const field of ['title', 'eventType', 'city', 'venue', 'organiser']) {
    const [min, max] = studio.EVENT_LIMITS[field];
    assert.ok(ok({ [field]: 'x'.repeat(max) }), `${field}: ${max} characters is allowed`);
    assert.ok(!ok({ [field]: 'x'.repeat(max + 1) }), `${field}: ${max + 1} characters is refused`);
    assert.ok(!ok({ [field]: 'x'.repeat(min - 1) }), `${field}: ${min - 1} characters is refused`);
  }
  const day = (offset) => new Date(Date.UTC(2026, 9, 7) + offset * 86_400_000).toISOString().slice(0, 10);
  const [minStart, maxStart] = studio.EVENT_LIMITS.startDateDays;
  assert.ok(ok({ startDate: day(maxStart) }) && !ok({ startDate: day(maxStart + 1) }), 'latest start date');
  assert.ok(ok({ startDate: day(minStart), endDate: null }) && !ok({ startDate: day(minStart - 1) }), 'earliest start date');
  const [, maxEnd] = studio.EVENT_LIMITS.endDateDays;
  assert.ok(ok({ startDate: day(maxStart), endDate: day(maxEnd) }) && !ok({ startDate: day(maxStart), endDate: day(maxEnd + 1) }), 'latest end date');
});
