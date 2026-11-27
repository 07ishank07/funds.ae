// The contract between database, API and website, checked end to end:
//   1. every published api/v1 document has exactly the fields in src/contracts/models.js
//   2. every DB model field has a column in schema/schema.sql, and the JSON store holds no others
//   3. every data slot and form the website scripts use exists in the pages, and every form
//      field name is one the API accepts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADVERTISING_TIERS, DB_MODELS, DTO_FIELDS, EMPLOYMENT_TYPES, ENVELOPE_FIELDS, HERO_BUTTON_TARGETS, SPONSOR_SLOTS, SUBMISSION_KINDS } from '../src/contracts/models.js';
import { JOB_FORM_OPTIONS, SUBMISSION_SCHEMAS } from '../src/validation/submissions.js';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(backend, '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'fundsae-contract-'));
const apiDir = path.join(tmp, 'api');
const api = (file) => JSON.parse(readFileSync(path.join(apiDir, file), 'utf8'));
const data = (file) => JSON.parse(readFileSync(path.join(tmp, 'data', 'demo', file), 'utf8'));
const sameKeys = (obj, fields, where) => assert.deepEqual(Object.keys(obj).sort(), [...fields].sort(), where);
// Old page addresses kept only to forward to the renamed page (no header, banner or connector).
const MOVED_PAGES = { 'Advertise.dc.html': 'PartnerWithUs.dc.html' };
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
  // The home page hero banner: null until one is published in Sanity, then the contract fields.
  assert.ok('hero' in doc, 'content.json carries hero');
  if (doc.hero !== null) sameKeys(doc.hero, DTO_FIELDS.hero, 'hero');
  // The home page tags its hero as the slot the connector fills.
  const home = readFileSync(path.join(repo, 'frontend_demo', 'this.html'), 'utf8');
  assert.ok(home.includes("hero.setAttribute('data-fundsae-slot', 'home-hero')"), 'home hero slot');
  assert.ok(readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8').includes("slots('home-hero')"), 'connector fills the hero');
});

test('meta.json advertises versions, capabilities and every endpoint that exists', () => {
  const meta = api('meta.json');
  assert.deepEqual(Object.keys(meta.versions).sort(), ['careers', 'content', 'employers', 'events', 'jobs', 'news', 'sponsors']);
  assert.deepEqual(meta.capabilities, { submissions: false }, 'static hosting cannot take forms');
  const taxonomy = api('taxonomy.json');
  for (const t of taxonomy.topics) assert.ok(existsSync(path.join(apiDir, 'news', 'topics', `${t.id}.json`)), t.id);
  for (const s of taxonomy.sections) assert.ok(existsSync(path.join(apiDir, 'news', 'sections', `${s.id}.json`)), s.id);
  for (const c of taxonomy.categories) assert.ok(existsSync(path.join(apiDir, 'news', `${c.id}.json`)), c.id);
  for (const file of [meta.endpoints.jobs, meta.endpoints.employers, meta.endpoints.events, meta.endpoints.sponsors, meta.endpoints.content]) {
    assert.ok(existsSync(path.join(apiDir, file)), file);
  }
  const sectionIds = taxonomy.sections.map((s) => s.id);
  for (const id of ['residential-real-estate', 'commercial-real-estate', 'infrastructure', 'special-alternative-real-estate', 'ai-technology']) assert.ok(sectionIds.includes(id), `section ${id}`);
  const grants = api('news/sections/grants-funding.json');
  assert.ok(grants.items.length > 0);
  assert.ok(grants.items.every((s) => s.category === 'uae' && s.topics.includes('grants-funding')));
  assert.ok(existsSync(path.join(apiDir, meta.endpoints.realEstate)), 'the Real Estate Capital News archive');
  for (const id of ['residential-real-estate', 'commercial-real-estate', 'infrastructure', 'special-alternative-real-estate']) {
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
    tables[m[1]] = new Set(m[2].split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((w) => /^[a-z][a-z0-9_]*$/.test(w)));
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
    ...[...pages.matchAll(/\btag\([^;]*'([a-z-]+)'(?:, true)?\);/g)].map((m) => m[1]),
    // ...or sets the attribute on an element it builds (the home hero).
    ...[...pages.matchAll(/setAttribute\('data-fundsae-slot', '([a-z-]+)'\)/g)].map((m) => m[1])
  ]);
  for (const slot of used) assert.ok(declared.has(slot), `connector uses slot "${slot}" that no page declares`);
  for (const slot of declared) assert.ok(used.has(slot), `page declares slot "${slot}" that the connector never fills`);
});

// Pages with neither the hero banner nor the Elite Founding Sponsor banner (Careers has its own sponsor box).
const NO_BANNER_PAGES = ['Careers.dc.html'];

test('every page but the home page and Careers shows the same Elite Founding Sponsor banner, and all link to the Events page', () => {
  const read = (f) => readFileSync(path.join(repo, 'frontend_demo', f), 'utf8');
  const pages = readdirSync(path.join(repo, 'frontend_demo')).filter((f) => f.endsWith('.html') && !MOVED_PAGES[f]);
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
    // The hero banner is on the home page only (checked below).
    if (file !== 'this.html') assert.ok(!html.includes('fx-hero') && !html.includes('hero-banner.css'), `${file} has no hero banner`);
    // The home page shows the hero instead, and Careers has neither banner.
    if (file === 'this.html' || NO_BANNER_PAGES.includes(file)) {
      assert.ok(!html.includes('class="fx-founding"') && !html.includes('href="founding-banner.css"'), `${file} has no Elite Founding Sponsor banner`);
      continue;
    }
    for (const text of bannerText) assert.ok(html.includes(text), `${file}: banner lacks ${text}`);
    assert.ok(html.includes('founding-banner.css'), `${file} does not load founding-banner.css`);
    assert.match(html, /class="fx-founding-cta" href="(PartnerWithUs\.dc\.html)?#elite-partner"/, `${file}: banner button`);
    if (file !== 'this.html') assert.ok(html.includes('data-fundsae-slot="sponsor-founding"'), `${file}: banner slot`);
  }
  const home = read('this.html');
  // Home: a hero banner (headline and an original illustration, no form or links) in place of the Elite Founding Sponsor banner.
  assert.ok(!home.includes('fx-founding') && !home.includes('Your firm here'), 'no Elite Founding Sponsor banner on the home page');
  // Built-in hero: the Photo style (full-bleed Dubai photo), with no buttons and no figures row.
  for (const s of ['>The future of capital</p>', '<h1 id="fx-hero-title" class="fx-hero-title">Capital. Markets. Opportunity.</h1>',
    '<img src="img/hero-dubai.jpg" alt="', "hero.className = 'fx-hero fx-hero--photo';",
    "(document.querySelector('.fx-hero') || mainColumns).before(bar)", "heroStyle.href = 'hero-banner.css?v=3';"]) {
    assert.ok(home.includes(s), `hero: ${s}`);
  }
  assert.ok(!home.includes('fx-hero-form') && !home.includes('fx-hero-links'), 'the hero has no form or link list');
  assert.ok(!home.includes('class="fx-hero-acts"') && !home.includes('class="fx-hero-btn') && !/Stories a year|Sources tracked/.test(home), 'the hero has no buttons or figures');
  for (const art of ['hero-skyline.svg', 'hero-skyline-warm.svg', 'hero-dubai.jpg']) assert.ok(existsSync(path.join(repo, 'frontend_demo', 'img', art)), `${art} is in the repository`);
  // The photo is a licensed stock photo (credited in img/CREDITS.md) and light enough for a banner.
  assert.ok(statSync(path.join(repo, 'frontend_demo', 'img', 'hero-dubai.jpg')).size < 600 * 1024, 'hero photo under 600 KB');
  assert.ok(readFileSync(path.join(repo, 'frontend_demo', 'img', 'CREDITS.md'), 'utf8').includes('hero-dubai.jpg'), 'hero photo is credited');
  // The connector switches styles and only links a button (if the markup ever has one again) to a known site page.
  const heroScript = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  assert.ok(heroScript.includes("box.querySelector('.fx-hero-title')"), 'connector fills the h1 or h2 headline');
  assert.ok(heroScript.includes("box.classList.toggle('fx-hero--photo', style === 'photo')") && heroScript.includes("box.classList.toggle('fx-hero--minimal', style === 'minimal')"), 'connector applies the banner style');
  assert.ok(heroScript.includes("box.querySelector('.fx-hero-btn2'), hero.button2Label, hero.button2Href"), 'connector fills the second button');
  const heroPages = JSON.parse(heroScript.match(/var HERO_PAGES = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(heroPages, Object.values(HERO_BUTTON_TARGETS), 'connector button pages = HERO_BUTTON_TARGETS');
  for (const p of heroPages) assert.ok(existsSync(path.join(repo, 'frontend_demo', p)), `${p} exists`);
  // Home news tabs: the page script and the connector agree on the names; Global Stories is the world category.
  const connector = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  assert.ok(home.includes("const REGION_NAMES = ['News', 'Global'];") && home.includes("Global: 'Global Stories'"), 'home tabs are UAE Stories and Global Stories');
  assert.ok(home.includes("News: 'UAE Stories'"), 'News tab is labelled UAE Stories');
  assert.ok(home.includes('<h2 id="platinum-sponsors-title">Spotlight</h2>') && home.includes("url('img/partners/${id}.png')"), 'Spotlight box with dummy pictures');
  assert.ok(!home.includes('gold-sponsors-title') && !home.includes("'sponsor-gold'"), 'home has no Gold Sponsors box');
  // Every Gold Partner in sponsors.json has its own dummy picture, and the page lists the same ids.
  const partnerIds = JSON.parse(readFileSync(path.join(backend, 'config', 'sponsors.json'), 'utf8')).platinum.map((p) => p.id);
  for (const id of partnerIds) {
    assert.ok(existsSync(path.join(repo, 'frontend_demo', 'img', 'partners', `${id}.png`)), `dummy picture for ${id}`);
    assert.ok(home.includes(`['${id}', `), `home lists ${id}`);
  }
  // The site menu is in the footer on every page, not in the header.
  assert.ok(home.includes(`nav.m-only[aria-label="Sections"]').forEach((nav) => nav.remove())`), 'home removes both header menus');
  for (const page of ['About', 'PartnerWithUs', 'Careers', 'Contact', 'Events', 'GrantsFunding', 'News', 'Privacy', 'Terms', 'Videos']) {
    const html = read(`${page}.dc.html`);
    assert.ok(!html.includes('aria-label="Sections"'), `${page} has no header menu`);
    const footNav = html.slice(html.indexOf('<nav class="foot-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="foot-nav"')));
    // Footer: About, Contact us and the legal links only (the same on every page).
    for (const label of ['About', 'Contact us', 'Terms of Service', 'Privacy Policy']) assert.ok(footNav.includes(`>${label}</a>`), `${page} footer links to ${label}`);
    for (const label of ['Top news', 'Careers', 'Events', 'Partner with us']) assert.ok(!footNav.includes(`>${label}</a>`), `${page} footer has no ${label}`);
    // Header: the home page's masthead, mobile bar and category bar, from the shared stylesheet and script.
    assert.ok(html.includes('href="site-header.css"') && html.includes('src="../js/fundsae-header.js"'), `${page} uses the shared header`);
    assert.ok(html.includes('class="fxh"') && html.includes('class="m-only fxh-m"') && html.includes('class="fx-catbar"'), `${page} has the home page header`);
    assert.ok(html.includes('data-fundsae-date'), `${page} header shows the date`);
    assert.ok(!html.includes('class="masthead"'), `${page} has no old masthead`);
    const catbar = html.slice(html.indexOf('<nav class="fx-catbar"'), html.indexOf('</nav>', html.indexOf('<nav class="fx-catbar"')));
    for (const [label, href] of [['Grants &amp; Funding', 'GrantsFunding.dc.html'], ['Videos &amp; Podcasts', 'Videos.dc.html'], ['Partner with us', 'PartnerWithUs.dc.html'], ['Careers', 'Careers.dc.html'], ['Events', 'Events.dc.html']]) {
      assert.ok(catbar.includes(`<a href="${href}"`) && catbar.includes(`>${label}</a>`), `${page} category bar links to ${label}`);
    }
    // No investor-type links: Real Estate Stories, one divider, then the site's pages.
    assert.ok(!catbar.includes('?category=') && !catbar.includes('?capital='), `${page} category bar has no investor-type links`);
    assert.equal(catbar.split('fx-catbar-rule').length - 1, 1, `${page} category bar has one divider`);
    const links = [...catbar.matchAll(/>([^<>]+)<\/a>/g)].map((m) => m[1]);
    assert.deepEqual(links.slice(-2), ['Events', 'Partner with us'], `${page} category bar ends with Events, then Partner with us`);
  }
  // One bar under the masthead: Real Estate Stories, Grants & Funding | Videos & Podcasts, Partner with us, Careers, Events.
  assert.ok(home.includes("[['Real Estate Stories', null], ['Grants & Funding', { href: 'GrantsFunding.dc.html' }]],"), 'category bar starts with Real Estate Stories and Grants & Funding');
  assert.ok(home.includes("'UAE Business Grants and Funding news': 'GrantsFunding.dc.html'") && home.includes("'Other Funding Resources': 'GrantsFunding.dc.html'"), 'the home funding boxes open the Grants & Funding page');
  assert.ok(readFileSync(path.join(repo, 'js', 'fundsae-header.js'), 'utf8').includes("['Grants & Funding', 'GrantsFunding.dc.html']"), 'mobile menu links to Grants & Funding');
  for (const tpl of ['story.html', 'job.html']) {
    assert.ok(readFileSync(path.join(backend, 'templates', tpl), 'utf8').includes('<a href="../GrantsFunding.dc.html">Grants &amp; Funding</a>'), `${tpl} header links to Grants & Funding`);
  }
  for (const label of ['Sovereign', 'Pension', 'Private Equity', 'REITs', 'Family Offices', 'Banks', 'Government', 'Endowments']) {
    assert.ok(!home.includes(`['${label}', `), `category bar has no ${label} link`);
  }
  assert.ok(home.includes("[['Videos & Podcasts', { href: 'Videos.dc.html' }], ['Careers', { href: 'Careers.dc.html' }], ['Events', { href: 'Events.dc.html' }], ['Partner with us', { href: 'PartnerWithUs.dc.html' }]]"), 'category bar ends with Videos & Podcasts, Careers, Events and Partner with us links');
  for (const gone of ['Latest', 'Fundraising', 'Deals', 'People', 'Venture', 'Credit', 'Secondaries', 'Hedge Funds', 'LPs', 'Regulation', 'Providers']) {
    assert.ok(!home.includes(`['${gone}', [`), `category bar no longer has ${gone}`);
  }
  assert.ok(!home.includes('fx-investorbar'), 'no separate investor row');
  // The connector no longer rebuilds the bar from the Capital Types editors mark for it.
  const barBlock = home.slice(home.indexOf('const CATEGORY_GROUPS'), home.indexOf('const bar = document.createElement'));
  assert.ok(!barBlock.includes("'capital:"), 'no investor types in the built-in bar');
  assert.ok(!connector.includes('renderCatbar') && !connector.includes('fx-catbar'), 'the connector does not touch the category bar');
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
  assert.match(careers, /<h1[^>]*>Financial Services Jobs<\/h1>/);
  assert.ok(careers.includes("badge.className = 'role-logo'"), 'job cards carry a dummy employer logo');
  // Careers from Sanity: the connector follows careers.json for the Top boxes, links posted jobs to their page,
  // shows the salary/visa line and employer logos (images through setLogoImage, https only, no referrer).
  const careersConnector = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  for (const s of ["load('careers.json', 'careers')", 'pickedOrder(automatic, careersDoc && careersDoc.topJobs)', 'careersDoc && careersDoc.topEmployers',
    "'jobs/' + job.slug + '.html'", 'salaryText(job.salary)', "img.referrerPolicy = 'no-referrer'", 'item.resourceType']) {
    assert.ok(careersConnector.includes(s), `connector: ${s}`);
  }
  // Featured Employers grid is gone; Top Employers in column 2 ranks employers and links to each one's roles.
  assert.ok(!careers.includes('employer-grid') && !careers.includes('Featured Employers'), 'Careers has no Featured Employers grid');
  assert.match(careers, /<aside>[\s\S]*<section class="top-employers"[\s\S]*?<ol class="top-jobs-list top-employers-list" data-fundsae-slot="employers">[\s\S]*<\/aside>/);
  assert.match(careers, /<li><a href="\?employer=emp_[a-f0-9]{16}#opportunities-title"><span class="tj-rank">1<\/span>/);
  // Exclusive Elite Sponsor: a dummy box leads column 2, with a real image file, and never shows in live mode.
  assert.match(careers, /<aside>\s*<!--[\s\S]*?-->\s*<section class="elite-sponsor"[^>]*data-demo-only data-fundsae-slot="sponsor-elite-exclusive">/);
  assert.ok(careers.includes('html[data-fundsae-connected="live"] [data-demo-only] { display: none !important; }'), 'demo-only content is hidden in live mode');
  const sponsorImage = careers.match(/class="elite-sponsor-media"[^>]*><img src="\.\.\/(assets\/sponsors\/[a-z0-9-]+\.png)"/);
  assert.ok(sponsorImage, 'the sponsor box shows an image from assets/sponsors/');
  const png = readFileSync(path.join(repo, sponsorImage[1]));
  assert.equal(png.subarray(1, 4).toString(), 'PNG', 'the sponsor image is a PNG');
  assert.ok(png.length <= 500 * 1024, 'the sponsor image is within the 500 KB sponsor-image limit');
  // The Spotlight box is on the home page only; the gold slot is not shown anywhere.
  assert.ok(!careers.includes('data-fundsae-slot="sponsor-platinum"') && !careers.includes('data-fundsae-slot="sponsor-gold"'), 'Careers has no Spotlight or Gold Sponsors box');
  // Featured Companies strip at the foot of Careers (no Elite Founding Sponsor banner on this page): the scrolling
  // track holds the sponsor slot, labelled as sponsored.
  assert.ok(!careers.includes('sponsor-founding') && !careers.includes('founding-banner.css'), 'Careers has no Elite Founding Sponsor banner');
  assert.match(careers, /<\/aside>\s*<\/div>\s*<!--[\s\S]*?-->\s*<section class="partners"[\s\S]*?<\/section>\s*<footer/);
  // Job cards carry a dummy initials logo but no Featured tag; Top Employers lists 20, each with an initials logo.
  assert.ok(!/role-featured/.test(careers), 'job cards have no Featured tag');
  // The Exclusive Elite Sponsor box (demo only) heads the right column of both Careers and Events.
  const events = read('Events.dc.html');
  for (const page of [careers, events]) {
    assert.ok(page.includes('<p class="elite-sponsor-tags"><span>Exclusive Elite Sponsor</span><span>Sponsored</span></p>'), 'Exclusive Elite Sponsor box');
    assert.ok(page.includes('html[data-fundsae-connected="live"] [data-demo-only] { display: none !important; }'), 'hidden in live mode');
  }
  assert.ok(/<aside>\s*<!-- Exclusive Elite Sponsor[\s\S]*?<section class="elite-sponsor"/.test(events), 'Events: the box opens the right column');
  assert.ok(events.includes('href="Careers.dc.html?employer='), 'Events: the box links to the employer roles on Careers');
  // Managed in Sanity: both boxes are the sponsor area "eliteExclusive" (one sponsor for both pages), filled by the connector,
  // which shows the "Space available" advert in live mode when no sponsor is published.
  for (const page of [careers, events]) assert.ok(page.includes('data-fundsae-slot="sponsor-elite-exclusive"'), 'the box is the eliteExclusive sponsor slot');
  const sponsorConnector = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  for (const s of ["slots('sponsor-elite-exclusive')", "pick('eliteExclusive')", "'Space available'", "'Become the Exclusive Elite Sponsor'", "box.removeAttribute('data-demo-only')"]) {
    assert.ok(sponsorConnector.includes(s), `connector: ${s}`);
  }
  const topEmployers = careers.slice(careers.indexOf('data-fundsae-slot="employers"'), careers.indexOf('</ol>', careers.indexOf('data-fundsae-slot="employers"')));
  assert.equal((topEmployers.match(/<li>/g) || []).length, 20, 'Top Employers shows 20');
  assert.equal((topEmployers.match(/class="te-logo"/g) || []).length, 20, 'every Top Employer has a logo');
  assert.equal(careers.split('class="partners"').length, 2, 'one Featured Companies strip');
  assert.match(careers, /class="partners-track">\s*<div class="partners-list" data-fundsae-slot="sponsor-companies">/);
  assert.ok(careers.includes('<h2 id="partners-title" class="partners-title">Partners<span class="fxh-sr"> (sponsored)</span></h2>'), 'a Partners heading, labelled as sponsored for screen readers');
  assert.ok(!careers.includes('partners-head') && !careers.includes('Feature your firm'), 'no visible tag or link above the strip');
  // Partner with us: one package choice per API tier, and the Elite Exclusive Partner advert preselects its own.
  const advertise = read('PartnerWithUs.dc.html');
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

test('the Advertise page is now Partner with us: no link or label uses the old name, and the old address forwards', () => {
  const read = (...f) => readFileSync(path.join(repo, ...f), 'utf8');
  const files = [
    ...readdirSync(path.join(repo, 'frontend_demo')).filter((f) => f.endsWith('.html') && !MOVED_PAGES[f]).map((f) => ['frontend_demo', f]),
    ...readdirSync(path.join(repo, 'frontend_demo', 'news')).filter((f) => f.endsWith('.html')).map((f) => ['frontend_demo', 'news', f]),
    ['backend', 'templates', 'story.html'], ['backend', 'templates', 'job.html'], ['js', 'fundsae-header.js'], ['js', 'fundsae-connector.js']
  ];
  for (const f of files) {
    const text = read(...f);
    assert.ok(!text.includes('Advertise.dc.html'), `${f.join('/')} links to the old Advertise page`);
    assert.ok(!/>Advertise</.test(text) && !text.includes("['Advertise',"), `${f.join('/')} still says Advertise`);
  }
  assert.ok(read('js', 'fundsae-header.js').includes("['Partner with us', 'PartnerWithUs.dc.html']"), 'header menu links to Partner with us');
  assert.ok(read('frontend_demo', 'PartnerWithUs.dc.html').includes('<title>Partner with us · Funds.ae</title>'), 'page title');
  for (const [old, now] of Object.entries(MOVED_PAGES)) {
    const stub = read('frontend_demo', old);
    assert.ok(stub.includes(`url=${now}"`) && stub.includes(`location.replace('${now}' + location.search + location.hash)`), `${old} forwards to ${now}`);
    assert.ok(stub.includes('name="robots" content="noindex"') && !stub.includes('<form'), `${old} is only a redirect`);
  }
  assert.ok(read('i18n.js').includes("'Partner with us': "), 'Arabic label for Partner with us');
});

test('Videos & Podcasts: a header link on every page and a video hub page of dummy videos', () => {
  const read = (...f) => readFileSync(path.join(repo, ...f), 'utf8');
  const page = read('frontend_demo', 'Videos.dc.html');
  for (const f of [...readdirSync(path.join(repo, 'frontend_demo', 'news')).filter((n) => n.endsWith('.html')).map((n) => ['frontend_demo', 'news', n]),
    ['backend', 'templates', 'story.html'], ['backend', 'templates', 'job.html']]) {
    assert.ok(read(...f).includes('<a href="../Videos.dc.html">Videos &amp; Podcasts</a>'), `${f.join('/')} header links to Videos & Podcasts`);
  }
  assert.ok(read('js', 'fundsae-header.js').includes("['Videos & Podcasts', 'Videos.dc.html']"), 'mobile menu links to Videos & Podcasts');
  assert.ok(read('frontend_demo', 'this.html').includes('<a href="Videos.dc.html" style="display: inline-block; margin-top: 16px'), 'home box View All opens the page');
  assert.ok(page.includes('<title>Videos &amp; Podcasts · Funds.ae</title>') && page.includes('<a href="Videos.dc.html" aria-current="page">'), 'title and current link');
  // Featured episode, Latest row, two large recent cards, then one row per series.
  assert.ok(page.includes('class="vp-featured"') && page.indexOf('class="vp-featured"') < page.indexOf('id="vp-latest-title"'), 'featured block first');
  assert.equal([...page.matchAll(/class="vp-card vp-card-big"/g)].length, 2, 'two large recent cards');
  assert.ok([...page.matchAll(/id="vp-series-\d+"/g)].length >= 5, 'series rows');
  assert.ok(page.includes('The Funds.ae Podcast') && page.includes('>Podcast<'), 'podcast episodes');
  assert.ok(page.includes('Demo videos:'), 'marked as demo content');
  assert.ok(!/<img|<video|<iframe|url\(/.test(page.slice(page.indexOf('<main'), page.indexOf('</main>'))), 'no images, players or embeds (dummy thumbnails are CSS)');
  assert.ok(read('i18n.js').includes("'Videos & Podcasts': "), 'Arabic label');
});

test('Grants & Funding page: dummy funding, loan and grant opportunities with working filters', () => {
  const page = readFileSync(path.join(repo, 'frontend_demo', 'GrantsFunding.dc.html'), 'utf8');
  const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'));
  assert.ok(page.includes('<title>Grants &amp; Funding · Funds.ae</title>') && page.includes('<a href="GrantsFunding.dc.html" aria-current="page">'), 'title and current header link');
  for (const type of ['all', 'grant', 'loan', 'equity', 'trade']) assert.ok(main.includes(`data-gf-type="${type}"`), `filter chip ${type}`);
  assert.ok(main.includes('data-gf-emirate') && main.includes('data-gf-search') && main.includes('data-gf-count') && main.includes('data-gf-empty'), 'emirate, search, count and empty message');
  const cards = [...main.matchAll(/<article class="gf-card[^"]*" data-type="(grant|loan|equity|trade)" data-emirate="(abu-dhabi|dubai|sharjah|northern|uae)">/g)];
  assert.ok(cards.length >= 12, 'at least 12 opportunity cards, each with a type and an emirate');
  assert.equal(cards.length, (main.match(/class="gf-card/g) || []).length, 'every card is filterable');
  for (const type of ['grant', 'loan', 'equity', 'trade']) assert.ok(cards.some((m) => m[1] === type), `at least one ${type}`);
  assert.ok(main.includes('Demo data:') && main.includes('not financial advice'), 'demo notice and disclaimer');
  // Each card: a "TYPE · EMIRATE" line, the company name, one sentence about the funding and a details link.
  const bodies = main.split('<article class="gf-card').slice(1).map((c) => c.slice(0, c.indexOf('</article>')));
  for (const c of bodies) {
    assert.match(c, /<p class="gf-kicker">(Grant|Loan|Equity|Trade finance) · /, 'card type line');
    assert.match(c, /<h3>[^<]{3,}<\/h3>\s*<p class="gf-brief">[^<]{20,}<\/p>\s*<a class="gf-link" href="#"/, 'company name, brief text, then the link');
  }
  assert.ok(!/<img|https?:\/\//.test(main), 'no images or external links in the page body');
  const script = page.slice(page.lastIndexOf('<script>'), page.lastIndexOf('</script>'));
  assert.ok(script.includes('count.textContent') && !/innerHTML|insertAdjacentHTML/.test(script), 'the filter script sets text only');
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
      const optional = kind === 'job'
        ? ['companyUrl', 'workMode', 'employmentType', 'seniority', 'department', 'regulator', 'salaryTo', 'contactRole']
        : ['message', 'endDate', 'url', 'employmentType'];
      const required = schemaFields.filter((f) => f !== 'website' && !optional.includes(f));
      for (const r of required) assert.ok(names.includes(r), `${file} ${kind} form lacks required field "${r}"`);
    }
  }
  // The newsletter form is built by this.html's script; its field names are checked here.
  const home = readFileSync(path.join(repo, 'frontend_demo', 'this.html'), 'utf8');
  assert.match(home, /data-fundsae-form', 'newsletter'/);
  for (const n of ["input.name = 'email'", "placement.name = 'placement'", "trapInput.name = 'website'"]) assert.ok(home.includes(n), n);
  assert.deepEqual([...seen].sort(), ['advertise', 'contact', 'event', 'job']);
  // Post a job (PostJob.dc.html, linked from Careers): its choices are the validator's lists, so nothing the
  // page offers is refused by the API.
  const postJob = readFileSync(path.join(repo, 'frontend_demo', 'PostJob.dc.html'), 'utf8');
  for (const [name, list] of Object.entries({ ...JOB_FORM_OPTIONS, employmentType: EMPLOYMENT_TYPES })) {
    const select = new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(postJob);
    assert.ok(select, `PostJob has a ${name} list`);
    const values = [...select[1].matchAll(/<option value="([^"]*)"/g)].map((o) => o[1].replace(/&amp;/g, '&')).filter(Boolean);
    assert.deepEqual(values, list, `${name} choices match the API`);
  }
  assert.ok(postJob.includes('fundsae-forms.js'), 'PostJob loads the forms script');
  assert.ok(readFileSync(path.join(repo, 'frontend_demo', 'Careers.dc.html'), 'utf8').includes('<a class="post-job-btn" href="PostJob.dc.html">Post a job</a>'), 'Careers links to Post a job');
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
  // No Real Estate News link in the header; the page is reached from the home page's real estate boxes (View All).
  for (const f of ['About', 'PartnerWithUs', 'Careers', 'Contact', 'Events', 'GrantsFunding', 'News', 'PostJob', 'Privacy', 'Terms', 'Videos']) {
    assert.ok(!read(`${f}.dc.html`).includes('>Real Estate News</a>'), `${f} has no Real Estate News header link`);
  }
  const home = read('this.html');
  for (const id of ['residential-real-estate', 'commercial-real-estate', 'infrastructure', 'special-alternative-real-estate']) {
    assert.ok(home.includes(`'News.dc.html?section=${id}'`), `the ${id} box's View All opens the page with its Asset Classes`);
  }
  // Every real estate tile shows its source in small text; live tiles get the publisher's name.
  assert.ok(home.includes("source.className = 'fx-tile-source'"), 'real estate tiles carry a source line');
  assert.ok(readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8').includes("art.querySelector('.fx-tile-source')"), 'the connector fills the source line');
});
