// The contract between database, API and website, checked end to end:
//   1. every published api/v1 document has exactly the fields in src/contracts/models.js
//   2. every DB model field has a column in schema/schema.sql, and the JSON store holds no others
//   3. every data slot and form the website scripts use exists in the pages, and every form
//      field name is one the API accepts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADVERTISING_TIERS, DB_MODELS, DTO_FIELDS, ENVELOPE_FIELDS, SPONSOR_SLOTS, SUBMISSION_KINDS } from '../src/contracts/models.js';
import { SUBMISSION_SCHEMAS } from '../src/validation/submissions.js';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(backend, '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'fundsae-contract-'));
const apiDir = path.join(tmp, 'api');
const api = (file) => JSON.parse(readFileSync(path.join(apiDir, file), 'utf8'));
const data = (file) => JSON.parse(readFileSync(path.join(tmp, 'data', 'demo', file), 'utf8'));
const sameKeys = (obj, fields, where) => assert.deepEqual(Object.keys(obj).sort(), [...fields].sort(), where);
const snake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

before(() => {
  const env = { ...process.env, FUNDSAE_MODE: 'demo', FUNDSAE_DATA_DIR: path.join(tmp, 'data'), FUNDSAE_API_DIR: apiDir, GITHUB_ACTIONS: '' };
  execFileSync(process.execPath, ['src/cli.js', 'all'], { cwd: backend, env, encoding: 'utf8' });
});
after(() => rmSync(tmp, { recursive: true, force: true }));

test('every API document carries the shared envelope', () => {
  const files = ['meta.json', 'news.json', 'jobs.json', 'employers.json', 'events.json', 'sponsors.json', 'content.json', 'sources.json', 'taxonomy.json'];
  for (const f of files) {
    const doc = api(f);
    for (const key of ENVELOPE_FIELDS) assert.ok(key in doc, `${f} lacks ${key}`);
    assert.equal(doc.apiVersion, 1);
    assert.equal(doc.mode, 'demo');
  }
});

test('list items have exactly the contract fields, with null (never "") for missing values', () => {
  const check = (file, dto, extra) => {
    const doc = api(file);
    assert.equal(doc.count, doc.items.length, `${file} count`);
    assert.ok(doc.items.length > 0, `${file} has demo items`);
    for (const item of doc.items) {
      sameKeys(item, DTO_FIELDS[dto], `${file} item ${item.id}`);
      for (const [k, v] of Object.entries(item)) assert.notEqual(v, '', `${file} ${item.id}.${k} is ""`);
      if (extra) extra(item);
    }
  };
  check('news.json', 'story', (s) => {
    s.sources.forEach((src) => sameKeys(src, DTO_FIELDS.storySource, 'story source'));
    for (const tag of [...s.capitalTypes, ...s.assetClasses, ...s.geography, ...(s.transactionType ? [s.transactionType] : [])]) {
      sameKeys(tag, DTO_FIELDS.storyTag, `${s.id} tag`);
    }
    assert.match(s.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(typeof s.featured, 'boolean');
    assert.ok(s.liveAt && !Number.isNaN(Date.parse(s.liveAt)), 'when an approver put it on the site');
  });
  check('news/real-estate.json', 'story', (s) => assert.ok(s.assetClasses.length > 0, `${s.id} has an Asset Class`));
  check('jobs.json', 'job', (j) => assert.match(j.employerId, /^emp_[a-f0-9]{16}$/));
  check('employers.json', 'employer');
  assert.equal(api('employers.json').items.length, 20, 'the demo publishes 20 employers for the Careers Top Employers list');
  check('events.json', 'event', (e) => assert.match(e.startDate, /^\d{4}-\d{2}-\d{2}$/));
  check('sources.json', 'source');
});

test('sponsors.json has one list per page slot with the unified item fields', () => {
  const doc = api('sponsors.json');
  assert.deepEqual(Object.keys(doc.slots).sort(), [...SPONSOR_SLOTS].sort());
  for (const [slot, list] of Object.entries(doc.slots)) {
    for (const item of list) {
      sameKeys(item, DTO_FIELDS.sponsorItem, `${slot} ${item.id}`);
      assert.ok(item.url === null || item.url.startsWith('https://'), `${slot} ${item.id} url`);
    }
  }
});

test('content.json has the Sanity-managed slots and pages, with the contract fields (fuller checks in cms.test.js)', () => {
  const doc = api('content.json');
  assert.deepEqual(Object.keys(doc.slots).sort(), ['advertiseTiers', 'socialHighlights']);
  for (const item of doc.slots.socialHighlights) sameKeys(item, DTO_FIELDS.socialHighlight, item.id);
  for (const tier of doc.slots.advertiseTiers) sameKeys(tier, DTO_FIELDS.advertiseTier, tier.id);
  for (const [slug, page] of Object.entries(doc.pages)) sameKeys(page, DTO_FIELDS.page, slug);
});

test('meta.json advertises versions, capabilities and every endpoint that exists', () => {
  const meta = api('meta.json');
  assert.deepEqual(Object.keys(meta.versions).sort(), ['content', 'employers', 'events', 'jobs', 'news', 'sponsors']);
  assert.deepEqual(meta.capabilities, { submissions: false }, 'static hosting cannot take forms');
  const taxonomy = api('taxonomy.json');
  for (const t of taxonomy.topics) assert.ok(existsSync(path.join(apiDir, 'news', 'topics', `${t.id}.json`)), t.id);
  for (const s of taxonomy.sections) assert.ok(existsSync(path.join(apiDir, 'news', 'sections', `${s.id}.json`)), s.id);
  for (const c of taxonomy.categories) assert.ok(existsSync(path.join(apiDir, 'news', `${c.id}.json`)), c.id);
  for (const file of [meta.endpoints.jobs, meta.endpoints.employers, meta.endpoints.events, meta.endpoints.sponsors, meta.endpoints.content]) {
    assert.ok(existsSync(path.join(apiDir, file)), file);
  }
  const sectionIds = taxonomy.sections.map((s) => s.id);
  for (const id of ['residential-real-estate', 'commercial-real-estate', 'infrastructure', 'ai-technology']) assert.ok(sectionIds.includes(id), `section ${id}`);
  const grants = api('news/sections/grants-funding.json');
  assert.ok(grants.items.length > 0);
  assert.ok(grants.items.every((s) => s.category === 'uae' && s.topics.includes('grants-funding')));
  assert.ok(existsSync(path.join(apiDir, meta.endpoints.realEstate)), 'the Real Estate Capital News archive');
  for (const id of ['residential-real-estate', 'commercial-real-estate', 'infrastructure']) {
    const section = taxonomy.sections.find((s) => s.id === id);
    assert.ok(section.assetClasses.length > 0, `${id} is fed by Asset Classes`);
    for (const story of api(`news/sections/${id}.json`).items) assert.ok(story.assetClasses.some((a) => section.assetClasses.includes(a.id)), `${story.id} in ${id}`);
  }
});

test('taxonomy.json publishes both category systems, geographies and transaction types', () => {
  const taxonomy = api('taxonomy.json');
  assert.equal(taxonomy.capitalTypes.length, 14);
  assert.equal(taxonomy.assetClasses.length, 13);
  for (const c of taxonomy.capitalTypes) sameKeys(c, ['id', 'label', 'navLabel', 'showInNav', 'order', 'description'], c.id);
  for (const a of taxonomy.assetClasses) sameKeys(a, ['id', 'label', 'homeSection', 'order', 'description'], a.id);
  assert.deepEqual(taxonomy.capitalTypes.filter((c) => c.showInNav).map((c) => c.navLabel),
    ['Sovereign', 'Pension', 'Private Equity', 'REITs', 'Family Offices', 'Banks', 'Government', 'Endowments']);
  assert.ok(taxonomy.geographies.some((g) => g.id === 'uae' && g.label === 'UAE'));
  assert.ok(taxonomy.transactionTypes.some((t) => t.id === 'fund-close'));
});

test('schema.sql has a column for every model field', () => {
  const sql = readFileSync(path.join(backend, 'schema', 'schema.sql'), 'utf8');
  const tables = {};
  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
    tables[m[1]] = new Set(m[2].split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((w) => /^[a-z_]+$/.test(w)));
  }
  for (const [model, def] of Object.entries(DB_MODELS)) {
    assert.ok(tables[def.table], `schema.sql has no table ${def.table} for ${model}`);
    for (const field of def.fields) assert.ok(tables[def.table].has(snake(field)), `${def.table}.${snake(field)} missing (model ${model}.${field})`);
    for (const [field, column] of Object.entries(def.system || {})) assert.ok(tables[def.table].has(column), `${def.table}.${column} missing (Sanity field ${field})`);
  }
});

test('the JSON store holds no fields the schema does not know about', () => {
  const allowed = (model) => new Set([...DB_MODELS[model].fields, ...Object.keys(DB_MODELS[model].derived || {})]);
  const check = (records, model) => {
    const ok = allowed(model);
    for (const r of records) for (const k of Object.keys(r)) assert.ok(ok.has(k), `${model} record has unmapped field "${k}"`);
  };
  const queue = data('news-review.json');
  assert.ok(queue.docs.length, 'the demo review queue has stories');
  const reviewFields = new Set([...DB_MODELS.newsReviewItems.fields, ...Object.keys(DB_MODELS.newsReviewItems.system)]);
  for (const doc of queue.docs) for (const k of Object.keys(doc)) assert.ok(reviewFields.has(k), `review document has unmapped field "${k}"`);
  check(data('jobs-db.json').jobs, 'jobs');
});

test('the website scripts and pages agree on data slots', () => {
  const connector = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  const used = new Set([...connector.matchAll(/(?:slots|hasSlot)\('([a-z-]+)'\)/g)].map((m) => m[1]));
  for (const m of connector.matchAll(/var sponsorSlots = \[([^\]]+)\]/g)) for (const s of m[1].matchAll(/'([a-z-]+)'/g)) used.add(s[1]);
  const pages = readdirSync(path.join(repo, 'frontend_demo')).filter((f) => f.endsWith('.html'))
    .map((f) => readFileSync(path.join(repo, 'frontend_demo', f), 'utf8')).join('\n');
  const declared = new Set([
    ...[...pages.matchAll(/data-fundsae-slot="([a-z-]+)"/g)].map((m) => m[1]),
    // this.html tags its runtime-built sections in script: tag(element, 'slot-name', ...)
    ...[...pages.matchAll(/\btag\([^;]*'([a-z-]+)'(?:, true)?\);/g)].map((m) => m[1])
  ]);
  for (const slot of used) assert.ok(declared.has(slot), `connector uses slot "${slot}" that no page declares`);
  for (const slot of declared) assert.ok(used.has(slot), `page declares slot "${slot}" that the connector never fills`);
});

test('every page but Careers shows the same Elite Founding Sponsor banner, and all link to the Events page', () => {
  const read = (f) => readFileSync(path.join(repo, 'frontend_demo', f), 'utf8');
  const pages = readdirSync(path.join(repo, 'frontend_demo')).filter((f) => f.endsWith('.html'));
  assert.ok(pages.includes('Events.dc.html'), 'Events and Expos has its own page');
  const bannerText = [
    '>Elite Founding Sponsor<', '>Space available<', '>Your firm here<', '>Become a founding sponsor<',
    ">Put your firm in front of the UAE's GPs, LPs, family offices and fund service providers, every day.<"
  ];
  for (const file of pages) {
    const html = read(file);
    assert.ok(html.includes('fundsae-connector.js'), `${file} does not load the connector, so sponsors would never show`);
    assert.ok(!html.includes('Careers.dc.html#events'), `${file} still links to the old Careers events box`);
    assert.ok(!/Platinum (Sponsors|Partner)/.test(html), `${file} still shows "Platinum" instead of "Elite"`);
    if (file !== 'this.html') assert.match(html, /<a href="Events\.dc\.html"( aria-current="page")?>Events<\/a>/, `${file}: nav Events link`);
    // Careers shows the Featured Companies strip under its masthead instead (checked below).
    if (file === 'Careers.dc.html') continue;
    for (const text of bannerText) assert.ok(html.includes(text), `${file}: banner lacks ${text}`);
    assert.ok(html.includes('founding-banner.css'), `${file} does not load founding-banner.css`);
    assert.match(html, /class="fx-founding-cta" href="(Advertise\.dc\.html)?#elite-partner"/, `${file}: banner button`);
    if (file !== 'this.html') assert.ok(html.includes('data-fundsae-slot="sponsor-founding"'), `${file}: banner slot`);
  }
  const home = read('this.html');
  // Home news tabs: the page script and the connector agree on the names; Global Stories is the world category.
  const connector = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  assert.ok(home.includes("const REGION_NAMES = ['News', 'Global'];") && home.includes("Global: 'Global Stories'"), 'home tabs are UAE Stories and Global Stories');
  assert.ok(home.includes("News: 'UAE Stories'"), 'News tab is labelled UAE Stories');
  assert.ok(home.includes('<h2 id="platinum-sponsors-title">Gold Partners</h2>') && home.includes("url('img/partners/${id}.png')"), 'Gold Partners box with dummy pictures');
  assert.ok(!home.includes('gold-sponsors-title') && !home.includes("'sponsor-gold'"), 'home has no Gold Sponsors box');
  // Every Gold Partner in sponsors.json has its own dummy picture, and the page lists the same ids.
  const partnerIds = JSON.parse(readFileSync(path.join(backend, 'config', 'sponsors.json'), 'utf8')).platinum.map((p) => p.id);
  for (const id of partnerIds) {
    assert.ok(existsSync(path.join(repo, 'frontend_demo', 'img', 'partners', `${id}.png`)), `dummy picture for ${id}`);
    assert.ok(home.includes(`['${id}', `), `home lists ${id}`);
  }
  // The site menu is in the footer on every page, not in the header.
  assert.ok(home.includes(`nav.m-only[aria-label="Sections"]').forEach((nav) => nav.remove())`), 'home removes both header menus');
  for (const page of ['About', 'Advertise', 'Careers', 'Contact', 'Events', 'News', 'Privacy', 'Terms']) {
    const html = read(`${page}.dc.html`);
    assert.ok(!html.includes('aria-label="Sections"'), `${page} has no header menu`);
    const footNav = html.slice(html.indexOf('<nav class="foot-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="foot-nav"')));
    // Footer: About, Contact us and the legal links only (the same on every page).
    for (const label of ['About', 'Contact us', 'Terms of Service', 'Privacy Policy']) assert.ok(footNav.includes(`>${label}</a>`), `${page} footer links to ${label}`);
    for (const label of ['Top news', 'Careers', 'Events', 'Advertise']) assert.ok(!footNav.includes(`>${label}</a>`), `${page} footer has no ${label}`);
    // Header: the home page's masthead, mobile bar and category bar, from the shared stylesheet and script.
    assert.ok(html.includes('href="site-header.css"') && html.includes('src="../js/fundsae-header.js"'), `${page} uses the shared header`);
    assert.ok(html.includes('class="fxh"') && html.includes('class="m-only fxh-m"') && html.includes('class="fx-catbar"'), `${page} has the home page header`);
    assert.ok(html.includes('data-fundsae-date') && html.includes('href="this.html?category=Sovereign"'), `${page} header shows the date and links investor types to the home page`);
    assert.ok(!html.includes('class="masthead"'), `${page} has no old masthead`);
    const catbar = html.slice(html.indexOf('<nav class="fx-catbar"'), html.indexOf('</nav>', html.indexOf('<nav class="fx-catbar"')));
    for (const [label, href] of [['Advertise', 'Advertise.dc.html'], ['Careers', 'Careers.dc.html'], ['Events', 'Events.dc.html']]) {
      assert.ok(catbar.includes(`<a href="${href}"`) && catbar.includes(`>${label}</a>`), `${page} category bar links to ${label}`);
    }
  }
  // One bar under the masthead: Top | the investor types | Advertise (a link to the Advertise page).
  for (const label of ['Top Stories', 'Sovereign', 'Pension', 'Private Equity', 'REITs', 'Family Offices', 'Banks', 'Government', 'Endowments']) {
    assert.ok(home.includes(`['${label}', `), `category bar has ${label}`);
  }
  assert.ok(home.includes("[['Real Estate News', { href: 'News.dc.html' }], ['Advertise', { href: 'Advertise.dc.html' }], ['Careers', { href: 'Careers.dc.html' }], ['Events', { href: 'Events.dc.html' }]]"), 'category bar ends with Real Estate News, Advertise, Careers and Events links');
  for (const gone of ['Latest', 'Fundraising', 'Deals', 'People', 'Venture', 'Credit', 'Secondaries', 'Hedge Funds', 'LPs', 'Regulation', 'Providers']) {
    assert.ok(!home.includes(`['${gone}', [`), `category bar no longer has ${gone}`);
  }
  assert.ok(!home.includes('fx-investorbar'), 'no separate investor row');
  // The bar's built-in investor types are Capital Types (editors replace them from the Studio at runtime).
  const capitalIds = JSON.parse(readFileSync(path.join(backend, 'config', 'news-taxonomy.json'), 'utf8')).capitalTypes.map((c) => c.id);
  const barBlock = home.slice(home.indexOf('const CATEGORY_GROUPS'), home.indexOf('const bar = document.createElement'));
  const barIds = [...barBlock.matchAll(/'capital:([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.equal(barIds.length, 8, 'eight investor types in the built-in bar');
  for (const id of barIds) assert.ok(capitalIds.includes(id), `category bar Capital Type ${id} exists in news-taxonomy.json`);
  assert.ok(connector.includes("load('taxonomy.json', 'news').then(renderCatbar)"), 'the connector rebuilds the bar from the published Capital Types');
  assert.ok(connector.includes("document.addEventListener('fundsae:news-topics'") && home.includes("new CustomEvent('fundsae:news-topics'"), 'category bar filters Latest Stories through the connector');
  assert.ok(!home.includes('Tech and Data Centre News') && !connector.includes('tiles-ai-technology'), 'home has no Tech and Data Centre box');
  assert.ok(home.includes('if (careersBox) careersBox.remove();') && !home.includes("'home-jobs'"), 'home has no UAE Careers box');
  assert.ok(home.includes('careersColumn.insertBefore(newsletterBox, careersColumn.firstChild)'), 'Subscribe to stay ahead leads column 3');
  assert.ok(home.includes('sidebar.insertBefore(videosPodcastsBox, sidebar.firstElementChild)'), 'Videos and Podcasts leads column 2');
  // Events and Expos leads into Featured Partners in column 3, with a highlighted event card (dummy picture).
  assert.ok(home.includes('featuredPartnersBox.after(eventsPanel)'), 'Events and Expos sits under Featured Partners in column 3');
  assert.ok(home.includes(`tag(document.querySelector('.fx-event-feature'), 'events-feature')`) && connector.includes("slots('events-feature')"), 'highlighted event card');
  assert.ok(existsSync(path.join(repo, 'frontend_demo', 'img', 'events', 'featured-event.png')), 'dummy event picture');
  assert.ok(home.includes('>Featured Partners</h2>') && !home.includes('>Featured Companies<'), 'Featured Companies is now Featured Partners');
  assert.ok(home.includes('sponsoredForVoices.after(influencersBox)'), 'Influencers follow Sponsored Posts in column 2');
  assert.ok(home.includes("leadVoice.classList.add('fx-voice-lead')") && existsSync(path.join(repo, 'frontend_demo', 'img', 'influencers', 'top-voice.png')), 'top influencer leads with a dummy picture');
  assert.ok(home.includes('videosPodcastsBox.after(sponsoredPostsBox)') && !home.includes('careersColumn.insertBefore(sponsoredPostsBox'), 'Sponsored Posts sits in column 2 under Videos and Podcasts');
  assert.ok(connector.includes("var NEWS_REGIONS = ['News', 'Global'];") && connector.includes("var REGIONS = { uae: 'News', world: 'Global' };"), 'connector tabs match');
  assert.ok(!/'(UAE News|Global News|Business Funding)'/.test(home + connector), 'old tab names are gone');
  assert.ok(home.includes("['Events', { href: 'Events.dc.html' }]") && home.includes("'Events.dc.html#submit-event'"), 'home links to the Events page');
  assert.ok(home.includes("[['About', 'About.dc.html'], ['Contact us', 'Contact.dc.html']]") && home.includes("'../js/fundsae-header.js'"), 'home footer and shared header script');
  assert.ok(read('Events.dc.html').includes('data-fundsae-slot="events"'), 'the Events page lists events');
  const careers = read('Careers.dc.html');
  assert.ok(!careers.includes('data-fundsae-slot="events"') && !careers.includes('data-fundsae-form="event"'), 'Careers no longer has events');
  assert.match(careers, /<h1[^>]*>Search for a Career in Financial Services<\/h1>/);
  // Featured Employers grid is gone; Top Employers in column 2 ranks employers and links to each one's roles.
  assert.ok(!careers.includes('employer-grid') && !careers.includes('Featured Employers'), 'Careers has no Featured Employers grid');
  assert.match(careers, /<aside>[\s\S]*<section class="top-employers"[\s\S]*?<ol class="top-jobs-list top-employers-list" data-fundsae-slot="employers">[\s\S]*<\/aside>/);
  assert.match(careers, /<li><a href="\?employer=emp_[a-f0-9]{16}#opportunities-title"><span class="tj-rank">1<\/span>/);
  // Exclusive Elite Sponsor: a dummy box leads column 2, with a real image file, and never shows in live mode.
  assert.match(careers, /<aside>\s*<!--[\s\S]*?-->\s*<section class="elite-sponsor"[^>]*data-demo-only>/);
  assert.ok(careers.includes('html[data-fundsae-connected="live"] [data-demo-only] { display: none !important; }'), 'demo-only content is hidden in live mode');
  const sponsorImage = careers.match(/class="elite-sponsor-media"[^>]*><img src="\.\.\/(assets\/sponsors\/[a-z0-9-]+\.png)"/);
  assert.ok(sponsorImage, 'the sponsor box shows an image from assets/sponsors/');
  const png = readFileSync(path.join(repo, sponsorImage[1]));
  assert.equal(png.subarray(1, 4).toString(), 'PNG', 'the sponsor image is a PNG');
  assert.ok(png.length <= 500 * 1024, 'the sponsor image is within the 500 KB sponsor-image limit');
  // The Gold Partners box is on the home page only; the gold slot is not shown anywhere.
  assert.ok(!careers.includes('data-fundsae-slot="sponsor-platinum"') && !careers.includes('data-fundsae-slot="sponsor-gold"'), 'Careers has no Gold Partners or Gold Sponsors box');
  // Featured Companies strip at the foot of Careers (no Elite Founding Sponsor banner on this page): the scrolling
  // track holds the sponsor slot, labelled as sponsored.
  assert.ok(!careers.includes('sponsor-founding') && !careers.includes('founding-banner.css'), 'Careers has no Elite Founding Sponsor banner');
  assert.match(careers, /<\/aside>\s*<\/div>\s*<!--[\s\S]*?-->\s*<section class="partners"[\s\S]*?<\/section>\s*<footer/);
  // Job cards carry no logo tile or Featured tag; Top Employers lists 20, each with an initials logo.
  assert.ok(!/role-logo|role-featured/.test(careers), 'job cards have no logo or Featured tag');
  const topEmployers = careers.slice(careers.indexOf('data-fundsae-slot="employers"'), careers.indexOf('</ol>', careers.indexOf('data-fundsae-slot="employers"')));
  assert.equal((topEmployers.match(/<li>/g) || []).length, 20, 'Top Employers shows 20');
  assert.equal((topEmployers.match(/class="te-logo"/g) || []).length, 20, 'every Top Employer has a logo');
  assert.equal(careers.split('class="partners"').length, 2, 'one Featured Companies strip');
  assert.match(careers, /class="partners-track">\s*<div class="partners-list" data-fundsae-slot="sponsor-companies">/);
  assert.match(careers, /aria-labelledby="partners-title"[\s\S]*?class="partners-tag">Sponsored</);
  // Advertise: one package choice per API tier, and the Elite Exclusive Partner advert preselects its own.
  const advertise = read('Advertise.dc.html');
  const options = [...advertise.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(options.sort(), [...ADVERTISING_TIERS].sort());
  assert.match(advertise, /id="elite-partner"[\s\S]*data-fundsae-tier="exclusive"/);
  // Three package cards (Featured Partner, Gold Partner, Elite Exclusive Partner) under a benefits pitch.
  assert.equal([...advertise.matchAll(/<div class="tier[ "]/g)].length, 3, 'three package cards');
  for (const name of ['Featured Partner', 'Gold Partner', 'Elite Exclusive Partner']) assert.ok(advertise.includes(`<h2>${name}</h2>`), name);
  assert.ok(advertise.includes('Benefits of partnering with Funds.ae') && advertise.indexOf('id="pitch-title"') < advertise.indexOf('id="packages"'), 'pitch sits above the packages');
  assert.ok(!advertise.includes('advertise-exclusive') && !connector.includes("'advertise-exclusive'"), 'no separate Elite Exclusive hero');
  // Cards are CMS-managed: placements, show-price, duration and CTA are drawn by the connector, and the enquiry
  // form's package list follows the published packages.
  for (const slot of ['class="placements"', 'class="features"', 'class="duration"', 'class="price"']) assert.ok(advertise.includes(slot), `card template has ${slot}`);
  assert.ok(!/\.tier:not\(\.exclusive\) \.price \{ display: none/.test(advertise), 'prices are shown or hidden by the showPrice field, not page CSS');
  assert.ok(connector.includes("price.hidden = !tier.showPrice") && connector.includes("select[name=\"tier\"]") && connector.includes('tier.ctaUrl'), 'connector draws showPrice, CTA and the package list');
});

test('every website form posts only field names the API accepts', () => {
  const pages = readdirSync(path.join(repo, 'frontend_demo')).filter((f) => f.endsWith('.html'));
  const seen = new Set();
  for (const file of pages) {
    const html = readFileSync(path.join(repo, 'frontend_demo', file), 'utf8');
    for (const m of html.matchAll(/<form[^>]*data-fundsae-form="([a-z]+)"[^>]*>([\s\S]*?)<\/form>/g)) {
      const [, kind, body] = m;
      assert.ok(SUBMISSION_KINDS.includes(kind), `${file}: unknown form kind ${kind}`);
      seen.add(kind);
      const names = [...body.matchAll(/\bname="([A-Za-z]+)"/g)].map((n) => n[1]);
      const schemaFields = Object.keys(SUBMISSION_SCHEMAS[kind].fields);
      for (const n of names) assert.ok(schemaFields.includes(n), `${file} ${kind} form sends "${n}" which the API rejects`);
      const required = schemaFields.filter((f) => f !== 'website' && !['message', 'endDate', 'url', 'employmentType'].includes(f));
      for (const r of required) assert.ok(names.includes(r), `${file} ${kind} form lacks required field "${r}"`);
    }
  }
  // The newsletter form is built by this.html's script; its field names are checked here.
  const home = readFileSync(path.join(repo, 'frontend_demo', 'this.html'), 'utf8');
  assert.match(home, /data-fundsae-form', 'newsletter'/);
  for (const n of ["input.name = 'email'", "placement.name = 'placement'", "trapInput.name = 'website'"]) assert.ok(home.includes(n), n);
  // "Post a role" was removed from Careers.dc.html (jobs are sourced from the pipeline and
  // config/jobs.manual.json, not visitor submissions), so no page has a "job" form. The API
  // still accepts POST /api/v1/submissions/job for a future paid-listing flow.
  assert.deepEqual([...seen].sort(), ['advertise', 'contact', 'event']);
});

test('the Real Estate Capital News page has its hooks, scripts and a bar link on every page', () => {
  const read = (f) => readFileSync(path.join(repo, 'frontend_demo', f), 'utf8');
  const page = read('News.dc.html');
  for (const hook of ['data-fundsae-news', 'data-fundsae-news-search', 'data-fundsae-news-sort', 'data-fundsae-news-filter="capital"',
    'data-fundsae-news-filter="asset"', 'data-fundsae-news-filter="geo"', 'data-fundsae-news-list', 'data-fundsae-news-more',
    'data-fundsae-news-empty', 'data-fundsae-news-status', 'data-fundsae-news-clear']) {
    assert.ok(page.includes(hook), `News.dc.html has ${hook}`);
  }
  const script = readFileSync(path.join(repo, 'js', 'fundsae-news.js'), 'utf8');
  for (const [, name] of script.matchAll(/hook\('([a-z-]+)'\)/g)) assert.ok(page.includes(`data-fundsae-news-${name}`), `the page has the ${name} hook the script uses`);
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(script.replace(/^\s*\/\/.*$/gm, '')), 'the page script inserts data with textContent only');
  const order = ['fundsae-api.js', 'fundsae-connector.js', 'fundsae-news-filter.js', 'fundsae-news.js'].map((f) => page.indexOf(`<script src="../js/${f}"`));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), 'scripts load in order: api, connector, filter, page');
  assert.ok(page.includes('<a href="News.dc.html" aria-current="page">Real Estate News</a>'));
  for (const f of ['About', 'Advertise', 'Careers', 'Contact', 'Events', 'Privacy', 'Terms']) {
    assert.ok(read(`${f}.dc.html`).includes('<a href="News.dc.html">Real Estate News</a>'), `${f} links to Real Estate News`);
  }
  const home = read('this.html');
  for (const id of ['residential-real-estate', 'commercial-real-estate', 'infrastructure']) {
    assert.ok(home.includes(`'News.dc.html?section=${id}'`), `the ${id} box's View All opens the page with its Asset Classes`);
  }
});
