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
const MOVED_PAGES = { 'Advertise.dc.html': 'PartnerWithUs.dc.html', 'News.dc.html': 'RealEstateNews.dc.html', 'Contact.dc.html': 'PartnerWithUs.dc.html#contact' };
const snake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

before(() => {
  const env = { ...process.env, FUNDSAE_MODE: 'demo', FUNDSAE_ECONOMY_LIVE: '0', FUNDSAE_DATA_DIR: path.join(tmp, 'data'), FUNDSAE_API_DIR: apiDir, GITHUB_ACTIONS: '' };
  execFileSync(process.execPath, ['src/cli.js', 'all'], { cwd: backend, env, encoding: 'utf8' });
});
after(() => rmSync(tmp, { recursive: true, force: true }));

test('every API document carries the shared envelope', () => {
  const files = ['meta.json', 'news.json', 'jobs.json', 'employers.json', 'events.json', 'sponsors.json', 'content.json', 'economy.json', 'sources.json', 'taxonomy.json'];
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
  // Grants & Funding (edited in Sanity): types with their programme counts, programmes; null keeps the built-in page.
  assert.ok('grants' in doc, 'content.json carries grants');
  if (doc.grants !== null) {
    assert.deepEqual(Object.keys(doc.grants).sort(), ['programmes', 'types']);
    for (const t of doc.grants.types) sameKeys(t, DTO_FIELDS.fundingType, `funding type ${t.id}`);
    for (const p of doc.grants.programmes) sameKeys(p, DTO_FIELDS.fundingProgramme, `programme ${p.id}`);
    for (const t of doc.grants.types) assert.equal(t.count, doc.grants.programmes.filter((p) => p.types.includes(t.id)).length, `${t.id} count`);
  }
  const grantsPage = readFileSync(path.join(repo, 'frontend_demo', 'GrantsFunding.dc.html'), 'utf8');
  assert.ok(grantsPage.includes('<div class="gf-type-grid" data-fundsae-slot="grants-types">') &&
    grantsPage.includes('data-fundsae-slot="grants-programmes"') && grantsPage.includes('window.__gfRefresh = function () { setCategory(cat, false); };'), 'Grants page slots and refresh');
  const grantsJs = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  const grantsFn = grantsJs.slice(grantsJs.indexOf('function programmeCard('), grantsJs.indexOf('/* ------------------------------- Gulf Economy'));
  assert.ok(grantsFn.includes('textContent') && !/innerHTML/.test(grantsFn) && grantsFn.includes('{ httpsOnly: true }'), 'programme cards: textContent, https links');
  // Reusable banners (edited in Sanity): { careers, grants }, each null or the contract fields; null keeps the built-in ones.
  assert.ok('banners' in doc, 'content.json carries banners');
  if (doc.banners !== null) {
    assert.deepEqual(Object.keys(doc.banners).sort(), ['careers', 'grants']);
    for (const [placement, b] of Object.entries(doc.banners)) if (b !== null) sameKeys(b, DTO_FIELDS.banner, `banner ${placement}`);
  }
  // (Events shows a travel advert in column 2 instead of the careers card.)
  for (const [file, slot] of [['Careers.dc.html', 'banner-careers'], ['Careers.dc.html', 'banner-grants']]) {
    assert.ok(readFileSync(path.join(repo, 'frontend_demo', file), 'utf8').includes(`data-fundsae-slot="${slot}"`), `${file} tags its ${slot}`);
  }
  const bannerJs = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  const bannerFn = bannerJs.slice(bannerJs.indexOf('function fillBanner('), bannerJs.indexOf('function renderBanners('));
  assert.ok(bannerFn.includes('textContent') && !/innerHTML/.test(bannerFn) && bannerFn.includes('api.imageUrl(b.image)') && bannerFn.includes('bannerShowing(b)'), 'banners: textContent, https photos, dates');
  // Site settings (edited in Sanity): the pinned Top UAE Story and the footer tagline; null keeps today's behaviour.
  assert.ok('settings' in doc, 'content.json carries settings');
  if (doc.settings !== null) sameKeys(doc.settings, DTO_FIELDS.siteSettings, 'settings');
  const settingsJs = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  const settingsFn = settingsJs.slice(settingsJs.indexOf('function renderSettings('), settingsJs.indexOf('function renderBanners('));
  assert.ok(settingsFn.includes('el.textContent = tagline') && !/innerHTML/.test(settingsFn), 'footer tagline set with textContent');
  assert.ok(settingsJs.includes("var pinned = region === 'News' && siteSettings.topUaeStoryId && inTab.filter("), 'the pin only takes a live UAE story');
  // The home page tags its hero as the slot the connector fills.
  const home = readFileSync(path.join(repo, 'frontend_demo', 'this.html'), 'utf8');
  assert.ok(home.includes("hero.setAttribute('data-fundsae-slot', 'home-hero')"), 'home hero slot');
  assert.ok(readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8').includes("slots('home-hero')"), 'connector fills the hero');
});

test('meta.json advertises versions, capabilities and every endpoint that exists', () => {
  const meta = api('meta.json');
  assert.deepEqual(Object.keys(meta.versions).sort(), ['careers', 'content', 'economy', 'employers', 'events', 'jobs', 'news', 'sponsors']);
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

test('economy.json: IMF figures with the IMF credit, exactly the contract fields', () => {
  const doc = api('economy.json');
  assert.equal(doc.count, doc.items.length);
  assert.ok(doc.items.length >= 4, 'economy.json has countries');
  for (const item of doc.items) sameKeys(item, DTO_FIELDS.economyItem, `economy ${item.id}`);
  sameKeys(doc.source, DTO_FIELDS.economySource, 'economy source');
  assert.equal(doc.source.name, 'International Monetary Fund');
  assert.equal(doc.source.url, 'https://www.imf.org/external/datamapper/datasets/WEO');
  assert.match(doc.notice, /^Source: International Monetary Fund, World Economic Outlook/);
  assert.deepEqual(doc.items.map((i) => i.code), ['AE', 'SA', 'QA', 'KW', 'OM', 'BH']);
  assert.ok(api('meta.json').versions.economy, 'meta.json versions economy.json');
});

test('home page: the Gulf Economy box sits directly above Spotlight and is filled with textContent', () => {
  const home = readFileSync(path.join(repo, 'frontend_demo', 'this.html'), 'utf8');
  assert.ok(home.includes("economyBox.setAttribute('aria-labelledby', 'gulf-economy-title');"), 'home builds the Gulf Economy box');
  assert.ok(home.includes('careersColumn.insertBefore(economyBox, platinumSection);'), 'Gulf Economy goes right before Spotlight');
  // No empty band above the funding tiles: a taller column 3 gives its extra height to row 2, not row 1.
  assert.ok(home.includes('main.wrap { grid-template-rows: auto 1fr !important; }') &&
    home.includes('main.wrap > .fx-fundzone { grid-column: 1 / 3; grid-row: 2; align-self: start;'), 'funding tiles sit right under columns 1 and 2');
  // View All under the funding tiles opens the Grants & Funding page.
  assert.ok(home.includes("fundViewAll.href = 'GrantsFunding.dc.html';") && home.includes("fundViewAll.textContent = 'View All';") &&
    home.includes('fundZone.appendChild(fundViewAll);'), 'funding tiles have a View All link to Grants & Funding');
  // Finance Careers banner: directly under the funding tiles (inside the zone that spans columns 1 and 2), licensed photo.
  assert.ok(home.includes("careersBanner.className = 'fx-careers-banner';") && home.includes('fundZone.appendChild(careersBanner);') &&
    home.indexOf('fundZone.appendChild(fundViewAll);') < home.indexOf('fundZone.appendChild(careersBanner);'), 'Finance Careers banner under the funding tiles');
  assert.ok(home.includes('<a class="fx-cb-btn" href="Careers.dc.html">View finance jobs</a>') && home.includes('src="img/careers-banner.jpg" alt=""'), 'banner links to Careers and shows its photo');
  assert.ok(statSync(path.join(repo, 'frontend_demo', 'img', 'careers-banner.jpg')).size < 400 * 1024 &&
    readFileSync(path.join(repo, 'frontend_demo', 'img', 'CREDITS.md'), 'utf8').includes('| `careers-banner.jpg` |'), 'banner photo is light and credited');
  // A top story per news tab (UAE, GCC, International), above Residential Estate News; the open tab's shows.
  for (const [region, id, heading, photo] of [['News', 'top-uae-title', 'UAE Top Story', 'img/partner-banner.jpg'], ['GCC', 'top-gcc-title', 'GCC Top Story', 'img/re-commercial.jpg'], ['Global', 'top-intl-title', 'International Top Story', 'img/careers-banner.jpg']]) {
    assert.ok(home.includes(`['${region}', '${id}', '${heading}', `) && home.includes(`'${photo}'`), `${heading} section with a licensed sample photo`);
  }
  assert.ok(home.includes("topStory.setAttribute('data-fundsae-slot', 'top-story');") && home.includes('if (topAnchor.nextElementSibling !== topStory) topAnchor.after(topStory);') &&
    home.includes("topStory.style.display = topStory.dataset.topRegion === region ? '' : 'none';"), 'each tab shows its own top story, directly under the tabs and above the headline links');
  const topJs = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  const topFn = topJs.slice(topJs.indexOf('function renderTopUae('), topJs.indexOf('function renderNews('));
  assert.ok(topFn.includes('regionOf(s) === region') && topFn.includes('s.featured') && topFn.includes("region === 'News' && siteSettings.topUaeStoryId") && !/innerHTML/.test(topFn), 'connector picks each tab\'s featured (else newest) story, the UAE pin first, with textContent');
  // Top Tweets closes the third column, directly under Events and Expos.
  assert.ok(home.includes(`const eventsForTweets = document.querySelector('[aria-labelledby="events-title"]');`) &&
    home.includes("eventsForTweets.insertAdjacentElement('afterend', tweetsBox);"), 'Top Tweets sits under Events and Expos');
  // Headed as on imf.org: "Gulf Economy at a Glance", "<year> Projected Real GDP (% Change)", "<year> Projected Consumer Prices (% Change)".
  assert.ok(home.includes('<h2 id="gulf-economy-title">Gulf Economy at a Glance</h2>'), 'box title');
  assert.ok(home.includes('<th scope="col" data-econ-col="gdp">Projected Real GDP (% Change)</th>') &&
    home.includes('<th scope="col" data-econ-col="prices">Projected Consumer Prices (% Change)</th>'), 'IMF column headings');
  const econJs = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  assert.ok(econJs.includes("var ECON_HEADINGS = { gdp: 'Projected Real GDP (% Change)', prices: 'Projected Consumer Prices (% Change)' };") &&
    econJs.includes("th.textContent = (typeof doc.year === 'number' ? doc.year + ' ' : '') + heading;"), 'the year leads each heading');
  assert.ok(econJs.includes("return (n < 0 ? '\\u2212' : '') + Math.abs(n).toFixed(1);"), 'figures as the IMF shows them: -15.6, 3.6');
  assert.ok(home.includes("tag(box('gulf-economy-title'), 'economy');"), 'the box is the economy slot');
  assert.ok(home.includes('href="https://www.imf.org/external/datamapper/datasets/WEO"') && home.includes('Source: <a data-econ-source'), 'the box credits and links the IMF');
  const connector = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  const render = connector.slice(connector.indexOf('function renderEconomy('), connector.indexOf('/* ------------------------------------ main'));
  assert.ok(render.includes('api.valid.economyItem') && render.includes('textContent') && !/innerHTML/.test(render), 'economy rows are built with textContent from validated items');
  assert.ok(connector.includes("load('economy.json', 'economy')"), 'connector loads economy.json');
});

test('Real Estate News: one landing page with three parallel columns, opened by the home View All links', () => {
  const page = readFileSync(path.join(repo, 'frontend_demo', 'RealEstateNews.dc.html'), 'utf8');
  const cols = [...page.matchAll(/<section class="ren-col" id="([a-z]+)" aria-labelledby="ren-\1-title" data-fundsae-slot="news-column" data-fundsae-sections="([a-z,-]+)">\s*<h2 id="ren-\1-title">([^<]+)<\/h2>/g)]
    .map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(cols, [
    ['residential', 'residential-real-estate', 'Residential Real Estate'],
    ['commercial', 'commercial-real-estate', 'Commercial Real Estate'],
    ['alternative', 'special-alternative-real-estate,infrastructure', 'Alternative Real Estate']
  ], 'three columns in order; Alternative carries Infrastructure');
  // Every section a column names is a real page section (published as news/sections/<id>.json).
  const sections = new Set(api('taxonomy.json').sections.map((s) => s.id));
  for (const [, ids] of cols) for (const id of ids.split(',')) assert.ok(sections.has(id), `section ${id} exists`);
  assert.ok(page.includes('<h1>Real Estate News</h1>'), 'page title');
  // Load more news adds stories on this page (no link to another page); the old feed page is gone.
  assert.ok(page.includes('<div class="ren-more"><button type="button" data-fundsae-news-more hidden>Load more news</button></div>'), 'Load more news button');
  assert.ok(page.includes('role="status" aria-live="polite" data-fundsae-news-more-status'), 'Load more announces its result');
  assert.ok(!page.includes('News.dc.html') && !page.includes('View all real estate news'), 'no View all link to the old feed');
  assert.ok(page.includes('src="../js/fundsae-connector.js"'), 'page loads the connector');
  // Each column has its own banner photo behind the lead story: licensed, credited and light enough for the web.
  for (const [col, file] of [['residential', 're-residential.jpg'], ['commercial', 're-commercial.jpg'], ['alternative', 're-alternative.jpg']]) {
    assert.ok(page.includes(`url('img/${file}') center / cover no-repeat`), `${col} column shows ${file}`);
    assert.ok(statSync(path.join(repo, 'frontend_demo', 'img', file)).size < 400 * 1024, `${file} under 400 KB`);
    assert.ok(readFileSync(path.join(repo, 'frontend_demo', 'img', 'CREDITS.md'), 'utf8').includes(`| \`${file}\` |`), `${file} is credited`);
  }
  assert.equal((page.match(/<article class="ren-(lead|item)" data-ren-demo>/g) || []).length, 48, 'sixteen built-in demo headlines per column (eight, then Load more)');
  // Home: every real estate box's View All opens this page at its column; none is limited to one category any more.
  const home = readFileSync(path.join(repo, 'frontend_demo', 'this.html'), 'utf8');
  for (const [label, href] of [['Residential Estate News', 'residential'], ['Commercial Real Estate News', 'commercial'], ['Alternative Real Estate News', 'alternative']]) {
    assert.ok(home.includes(`'${label}': 'RealEstateNews.dc.html#${href}'`), `${label} View All opens the Real Estate News page`);
  }
  assert.ok(!home.includes('News.dc.html?section='), 'no View All is limited to one category');
  // One home box, Alternative Real Estate News, for the Infrastructure and Special & Alternative stories together.
  assert.ok(home.includes("addTileSection('Alternative Real Estate News', [") &&
    home.includes(`tag(document.querySelector('.news > section[aria-label="Alternative Real Estate News"]'), 'tiles-alternative-real-estate');`), 'one Alternative Real Estate News box');
  assert.ok(!/Infrastructure Real Estate News|Special &(amp;)? Alternative Real Estate News/.test(home), 'the two old boxes are gone');
  // Every tile of the three boxes has its own licensed photo (img/re/, credited, light), with no label text on it.
  const rePhotos = readdirSync(path.join(repo, 'frontend_demo', 'img', 're')).filter((f) => f.endsWith('.jpg'));
  assert.equal(rePhotos.length, 36, 'twelve photos per box');
  const reCredits = readFileSync(path.join(repo, 'frontend_demo', 'img', 'CREDITS.md'), 'utf8');
  for (const f of rePhotos) {
    assert.ok(home.includes(`'${f.replace(/\.jpg$/, '')}'`), `${f} is used on the home page`);
    assert.ok(reCredits.includes(`| \`re/${f}\` |`), `${f} is credited`);
    assert.ok(statSync(path.join(repo, 'frontend_demo', 'img', 're', f)).size < 150 * 1024, `${f} under 150 KB`);
  }
  assert.ok(home.includes("image.textContent = '';") && readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8').includes("tag.textContent = '';"), 'no label text on the tile photos');
  const tilesJs = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  assert.ok(tilesJs.includes("var ALTERNATIVE_SECTIONS = ['special-alternative-real-estate', 'infrastructure'];") &&
    tilesJs.includes("renderTiles('tiles-alternative-real-estate', uaeOnly(mergeStoryDocs(docs)), TILES_SHOWN)"), 'the box merges both sections');
  // The three home real estate boxes show UAE stories only (the UAE Stories tab's rule).
  for (const slot of ['tiles-residential-real-estate', 'tiles-commercial-real-estate']) {
    assert.ok(tilesJs.includes(`renderTiles('${slot}', uaeOnly(doc), TILES_SHOWN)`), `${slot}: UAE stories only`);
  }
  assert.ok(tilesJs.includes("return s && typeof s === 'object' && regionOf(s) === 'News';"), 'uaeOnly uses the UAE Stories rule');
  const connector = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  const render = connector.slice(connector.indexOf('/* ---------------------------- Real Estate News page'), connector.indexOf('/* ------------------------------- Gulf Economy'));
  assert.ok(render.includes('api.valid.story') && render.includes('textContent') && !/innerHTML/.test(render), 'columns are built with textContent from validated stories');
  assert.ok(render.includes("state.mode !== 'live'"), 'demo headlines only outside live mode');
  assert.ok(render.includes('var COLUMN_STORIES = 8;') && render.includes('newsColumns.shown += COLUMN_STORIES;') &&
    render.includes('more.hidden = !left;'), 'Load more adds eight per column and hides when nothing is left');
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
const NO_BANNER_PAGES = ['Careers.dc.html', 'Events.dc.html', 'GrantsFunding.dc.html', 'PartnerWithUs.dc.html', 'PodcastEpisode.dc.html', 'RealEstateNews.dc.html', 'Videos.dc.html'];

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
    if (file !== 'this.html') assert.match(html, /<a href="Events\.dc\.html"( aria-current="page")?>Industry Events<\/a>/, `${file}: nav Industry Events link`);
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
    "(designHeader || document.querySelector('.fx-hero') || mainColumns).before(dateLine, siteHeader);", "heroStyle.href = 'hero-banner.css?v=3';"]) {
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
  assert.ok(home.includes("const REGION_NAMES = ['News', 'GCC', 'Global'];") && home.includes("const REGION_LABELS = { News: 'UAE Stories', GCC: 'GCC Stories', Global: 'International Stories' };"), 'home tabs are UAE, GCC and International Stories');
  assert.ok(home.includes("const show = region === 'News';") && home.includes("if (viewAll && viewAll.classList.contains('fx-view-all')) viewAll.style.display = show ? '' : 'none';"), 'real estate boxes (and their View All) under UAE Stories only');
  assert.ok(home.includes('data-more-news-region="GCC"') && home.includes("gccStories.forEach(([title, source]) => dummyStories.push(['GCC', title, source]));"), 'GCC tab has its View All and demo stories');
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
  for (const page of ['About', 'PartnerWithUs', 'Careers', 'Events', 'GrantsFunding', 'PodcastEpisode', 'Privacy', 'RealEstateNews', 'Terms', 'Videos']) {
    const html = read(`${page}.dc.html`);
    assert.ok(!html.includes('aria-label="Sections"'), `${page} has no header menu`);
    const footNav = html.slice(html.indexOf('<nav class="foot-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="foot-nav"')));
    // Footer: About, Contact us and the legal links only (the same on every page).
    for (const label of ['About', 'Contact us', 'Terms of Service', 'Privacy Policy']) assert.ok(footNav.includes(`>${label}</a>`), `${page} footer links to ${label}`);
    for (const label of ['Top news', 'Careers', 'Events', 'Partner with us']) assert.ok(!footNav.includes(`>${label}</a>`), `${page} footer has no ${label}`);
    // Header (option B): a date line, then one sticky row with the logo, the sections, the language slot, the
    // Partner with us button and the phone menu button. No search box and no share icons.
    assert.ok(html.includes('href="site-header.css?v=3"') && html.includes('src="../js/fundsae-header.js"'), `${page} uses the shared header`);
    assert.ok(html.includes('<div class="fxb-top">') && html.includes('<header class="fxb">') && html.includes('<nav class="fx-catbar fxb-nav" aria-label="News categories">'), `${page} has the option B header`);
    assert.ok(html.includes('data-fundsae-date') && html.includes('<span class="fxb-lang"></span>') && html.includes('aria-label="Open menu"'), `${page} header has the date, language slot and menu button`);
    assert.ok(/<a class="fxb-cta" href="PartnerWithUs\.dc\.html"( aria-current="page")?>Partner with us<\/a>/.test(html), `${page} header has the Partner with us button`);
    assert.ok(!/class="fxh"|fxh-search|Search news, funds and firms|Share on social media|class="masthead"/.test(html), `${page} has no old masthead, search box or share icons`);
    const catbar = html.slice(html.indexOf('<nav class="fx-catbar'), html.indexOf('</nav>', html.indexOf('<nav class="fx-catbar')));
    // No investor-type links: Property News, then the site's sections (Partner with us is the button).
    assert.ok(!catbar.includes('?category=') && !catbar.includes('?capital='), `${page} category bar has no investor-type links`);
    const links = [...catbar.matchAll(/<a href="([^"]+)"[^>]*>([^<>]+)<\/a>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(links, [['this.html', 'Property News'], ['Videos.dc.html', 'Watch &amp; Learn'], ['GrantsFunding.dc.html', 'Funding Opportunities'], ['Careers.dc.html', 'Finance Careers'], ['Events.dc.html', 'Industry Events']], `${page} header sections and order`);
  }
  // The home page builds the same header (its own bar inside), hides the design's headers and their search box.
  assert.ok(home.includes("siteHeader.className = 'fxb';") && home.includes('<a class="fxb-cta" href="PartnerWithUs.dc.html">Partner with us</a>') && home.includes("headerCss.href = 'site-header.css?v=3';"), 'home builds the option B header');
  assert.ok(home.includes('html body header.d-only, html body header.m-only { display: none !important; }'), 'home hides the design headers (and their search box)');
  const headerJs = readFileSync(path.join(repo, 'js', 'fundsae-header.js'), 'utf8');
  assert.ok(!/runSearch|Search news, funds and firms|fxh-search-panel/.test(headerJs) && headerJs.includes("header.fxb button[aria-label=\"Open menu\"]"), 'header script: menu only, no search');
  // One bar in the header: Property News | Watch & Learn, Funding Opportunities, Finance Careers, Industry Events.
  assert.ok(home.includes("[['Property News', null]],"), 'category bar starts with Property News');
  // No grants news box on the home page (its tiles, images and links are gone); the funding-type tiles sit under
  // "Business Grants & Funding Resources".
  const homeScript = home.split(/\r?\n/).filter((l) => l.length < 2000).join('\n'); // skip the bundled page template
  assert.ok(!/UAE Business Grants|grantsBox|tiles-grants-funding/.test(homeScript), 'no UAE Business Grants & Funding Resources box');
  assert.ok(home.includes("otherFundingHeading.textContent = 'Business Grants & Funding Resources';") && !homeScript.includes("'Other Funding Resources'"), 'the funding tiles heading');
  // Other Funding Resources: the Grants & Funding page's type tiles (same ids, titles and counts), each linking to
  // that page filtered; the old placeholder links are gone.
  const grantsPage = readFileSync(path.join(repo, 'frontend_demo', 'GrantsFunding.dc.html'), 'utf8');
  const pageTypes = [...grantsPage.matchAll(/data-gf-cat="([a-z-]+)" aria-pressed="false">[\s\S]*?<strong>([^<]+)<\/strong><span>[^<]+<\/span><small>([^<]+)<\/small>/g)]
    .map((m) => [m[1], m[2].replace(/&amp;/g, '&'), m[3]]);
  const homeTypes = [...home.matchAll(/^\s*\['([a-z-]+)', '([^']+)', '[^']+', '([^']+)', '/gm)].map((m) => [m[1], m[2], m[3]]);
  assert.equal(pageTypes.length, 12, 'twelve types on the Grants & Funding page');
  assert.deepEqual(homeTypes, pageTypes, 'home funding tiles match the Grants & Funding page types and counts');
  assert.ok(home.includes("tile.href = 'GrantsFunding.dc.html?category=' + id;") && !home.includes('otherFundingBox') && !home.includes("'Startup Visa Guide'"), 'tiles link to the filtered page; old links gone');
  assert.ok(home.includes('news.after(fundZone);') && home.includes('main.wrap > .fx-fundzone { grid-column: 1 / 3; grid-row: 2;') && home.includes('.fx-fundtypes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));'), 'the funding tiles span columns 1 and 2, four across');
  assert.ok(readFileSync(path.join(repo, 'js', 'fundsae-header.js'), 'utf8').includes("['Funding Opportunities', 'GrantsFunding.dc.html']"), 'mobile menu links to Funding Opportunities');
  for (const tpl of ['story.html', 'job.html']) {
    assert.ok(readFileSync(path.join(backend, 'templates', tpl), 'utf8').includes('<a href="../GrantsFunding.dc.html">Funding Opportunities</a>'), `${tpl} header links to Funding Opportunities`);
  }
  for (const label of ['Sovereign', 'Pension', 'Private Equity', 'REITs', 'Family Offices', 'Banks', 'Government', 'Endowments']) {
    assert.ok(!home.includes(`['${label}', `), `category bar has no ${label} link`);
  }
  assert.ok(home.includes("[['Watch & Learn', { href: 'Videos.dc.html' }], ['Funding Opportunities', { href: 'GrantsFunding.dc.html' }], ['Finance Careers', { href: 'Careers.dc.html' }], ['Industry Events', { href: 'Events.dc.html' }]]"), 'home bar ends with Watch & Learn, Funding Opportunities, Finance Careers and Industry Events (Partner with us is the button)');
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
  assert.ok(connector.includes("var NEWS_REGIONS = ['News', 'GCC', 'Global'];") && connector.includes("var REGIONS = { uae: 'News', world: 'Global' };") && connector.includes('stories.forEach(function (s) { addTo(regionOf(s), s); });'), 'connector tabs match');
  assert.ok(!/'(UAE News|Global News|Business Funding)'/.test(home + connector), 'old tab names are gone');
  assert.ok(home.includes("['Industry Events', { href: 'Events.dc.html' }]") && home.includes("'Events.dc.html#submit-event'"), 'home links to the Events page');
  assert.ok(home.includes("[['About', 'About.dc.html'], ['Contact us', 'PartnerWithUs.dc.html#contact']]") && home.includes("'../js/fundsae-header.js'"), 'home footer and shared header script');
  assert.ok(read('Events.dc.html').includes('data-fundsae-slot="events"'), 'the Events page lists events');
  const careers = read('Careers.dc.html');
  assert.ok(!careers.includes('data-fundsae-slot="events"') && !careers.includes('data-fundsae-form="event"'), 'Careers no longer has events');
  // The Finance Careers banner (as on the home page) tops the page; its heading is the page h1. No Demo data badge.
  assert.match(careers, /<h1 id="careers-banner-title" class="fx-cb-title">Your next move in finance<\/h1>/);
  assert.ok(careers.includes('href="careers-banner.css?v=2"') && careers.includes('<img class="fx-cb-photo" src="img/careers-banner.jpg" alt="">'), 'Careers shows the banner');
  assert.ok(!careers.includes('View finance jobs') && !careers.includes('fx-cb-acts') && !careers.includes('post-job-btn'), 'the Careers banner has no buttons');
  assert.ok(!careers.includes('Financial Services Jobs') && careers.indexOf('fx-careers-top') < careers.indexOf('id="opportunities"'), 'banner replaces the old heading, above the listings');
  // Grants & Funding banner (the Grants page hero: photo, label, headline) in column 2, directly above Career Resources;
  // the home page shows the same card in column 2, directly above Sponsored Posts. Both use grants-promo.css.
  const homePage = read('this.html');
  assert.ok(careers.includes('href="grants-promo.css?v=1"') && homePage.includes("promoCss.href = 'grants-promo.css?v=1';"), 'shared banner styles');
  assert.ok(homePage.includes('sponsoredPostsBox.before(grantsPromo);') && homePage.includes("grantsPromo.href = 'GrantsFunding.dc.html';") &&
    homePage.includes('<img class="gf-promo-img" src="img/grants-hero.jpg" alt="" loading="lazy">'), 'home: Grants & Funding banner above Sponsored Posts');
  assert.ok(careers.includes('<a class="gf-promo" href="GrantsFunding.dc.html" aria-labelledby="gf-promo-title" data-fundsae-slot="banner-grants">') &&
    careers.includes('<img class="gf-promo-img" src="img/grants-hero.jpg" alt="" loading="lazy">') &&
    careers.includes('id="gf-promo-title">Capital for every stage of your business.</span>'), 'Grants & Funding banner on Careers');
  assert.match(careers, /<a class="gf-promo"[\s\S]*?<\/a>\s*<section class="resources-box">/, 'directly above Career Resources in column 2');
  assert.ok(read('GrantsFunding.dc.html').includes('<p class="gf-hero-eb">Grants &amp; Funding</p>'), 'Grants hero label without UAE');
  // Filters: no search box and no Job type; Location lists every main Gulf country and its main cities, plus Remote.
  assert.ok(!careers.includes('id="job-search-input"') && !careers.includes('id="jf-type"'), 'no search box or Job type filter');
  // No filter menus: the Jobs by location cards and Browse jobs by function links filter the list; a count line stays.
  assert.ok(!/<select id="jf-(city|department|sort)"/.test(careers) && !careers.includes('id="job-filters"'), 'no Location, Function or Sort menus');
  assert.ok(careers.includes('<p id="job-search-status" class="job-search-status" role="status" aria-live="polite"></p>') &&
    careers.includes('<button type="button" id="jf-reset" class="jf-clear" hidden>Clear filter</button>'), 'role count and Clear filter');
  const rolesJs = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  // Function lists every finance function; the connector maps each role to one of the same labels. Sort has no
  // "Featured first": Newest is the default.
  const pageFunctions = JSON.parse(careers.match(/var FUNCTIONS = (\[[^\]]+\]);/)[1].replace(/'/g, '"'));
  const fnBlock = rolesJs.slice(rolesJs.indexOf('var JOB_FUNCTIONS = ['), rolesJs.indexOf('];', rolesJs.indexOf('var JOB_FUNCTIONS = [')));
  const jsFunctions = [...fnBlock.matchAll(/, '([^']+)'\]/g)].map((m) => m[1]);
  assert.ok(pageFunctions.length >= 26 && ['Private Equity', 'Venture Capital', 'Private Credit & Debt', 'Wealth & Private Banking', 'Compliance & Regulatory', 'Fund Administration & Operations',
    'Treasury & Capital Management', 'Corporate & Commercial Banking', 'Sales Trading & Brokerage', 'Quantitative Research & Investing', 'Actuarial & Insurance', 'Structured & Trade Finance', 'Audit & Assurance'].every((f) => pageFunctions.includes(f)), 'finance functions listed');
  {
    // The usual finance job families each land in a function (the connector's rules, run on sample titles).
    const rules = [...fnBlock.matchAll(/\[\/(.+?)\/, '([^']+)'\]/g)].map((m) => [new RegExp(m[1]), m[2]]);
    const fnOf = (title) => (rules.find(([re]) => re.test(title.toLowerCase())) || [null, ''])[1];
    for (const [title, fn] of [['Investment Banker', 'Investment Banking & Corporate Finance'], ['Corporate Banker', 'Corporate & Commercial Banking'], ['Private Banker', 'Wealth & Private Banking'],
      ['Options Trader', 'Hedge Funds & Trading'], ['Cryptocurrency Trader', 'Hedge Funds & Trading'], ['Equity Sales Trader', 'Sales Trading & Brokerage'], ['Commodities Broker', 'Sales Trading & Brokerage'],
      ['Execution Trader', 'Sales Trading & Brokerage'], ['Quant Portfolio Manager', 'Quantitative Research & Investing'], ['Fund Manager', 'Investments & Portfolio Management'],
      ['Asset Allocation Officer', 'Investments & Portfolio Management'], ['Wealth Manager', 'Wealth & Private Banking'], ['Life Actuary', 'Actuarial & Insurance'],
      ['Control Assurance Manager', 'Audit & Assurance'], ['Prudential Capital Manager', 'Treasury & Capital Management'], ['Structured Finance Associate', 'Structured & Trade Finance'],
      ['Trade Finance Officer', 'Structured & Trade Finance'], ['Finance Officer', 'Finance & Accounting']]) {
      assert.equal(fnOf(title), fn, title);
    }
  }
  assert.deepEqual([...jsFunctions].sort(), [...pageFunctions].sort(), 'the connector maps roles to exactly the menu functions');
  assert.ok(rolesJs.includes("row.setAttribute('data-function', functionOf(job.department, job.title));"), 'roles are tagged with a function');
  assert.ok(careers.includes('rows.sort(function (a, b) { return time(b) - time(a); });'), 'roles are listed newest first');
  assert.ok(rolesJs.includes("row.setAttribute('data-country', countryOf(job.location));") && rolesJs.includes("[/riyadh/, 'Riyadh', 'SA']"), 'roles are tagged with their Gulf country and city');
  assert.ok(careers.includes("badge.className = 'role-logo'"), 'job cards carry a dummy employer logo');
  assert.ok(careers.includes('  var PER_PAGE = 20, TOTAL = 120;'), 'the job list shows 20 roles per page');
  // Job cards: accent line, then location, salary and job type rows with outline icons; the connector fills each row.
  assert.ok(careers.includes("accent.className = 'role-accent';") && careers.includes("facts.className = 'role-facts';") &&
    careers.includes("factRow(facts, 'location', where);") && careers.includes("factRow(facts, 'salary', salary);") && careers.includes("factRow(facts, 'type', type);"), 'job cards have the fact rows');
  assert.ok(rolesJs.includes("if (salaryEl) salaryEl.textContent = salaryText(job.salary) || 'Competitive';") && rolesJs.includes("if (typeEl) typeEl.textContent = job.employmentType || 'Full-time';"), 'live jobs fill salary and type');
  // Careers from Sanity: the connector follows careers.json for Top Jobs, links posted jobs to their page,
  // shows the salary/visa line and employer logos (images through setLogoImage, https only, no referrer).
  const careersConnector = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  for (const s of ["load('careers.json', 'careers')", 'pickedOrder(automatic, careersDoc && careersDoc.topJobs)',
    "'jobs/' + job.slug + '.html'", 'salaryText(job.salary)', "img.referrerPolicy = 'no-referrer'", 'item.resourceType']) {
    assert.ok(careersConnector.includes(s), `connector: ${s}`);
  }
  // No Featured Employers grid and no Top Employers box: column 2 starts with Jobs by location, then Top Jobs.
  assert.ok(!careers.includes('employer-grid') && !careers.includes('Featured Employers'), 'Careers has no Featured Employers grid');
  assert.ok(!careers.includes('class="top-employers"') && !careers.includes('data-fundsae-slot="employers"') && !careers.includes('.te-logo'), 'Careers has no Top Employers box');
  // The page's styles are well formed: every declaration sits inside a rule (a stray one breaks the rule after it).
  {
    let depth = 0;
    for (const line of careers.slice(careers.indexOf('<style>') + 7, careers.indexOf('</style>')).split(/\r?\n/)) {
      const code = line.replace(/\/\*.*?\*\//g, '');
      assert.ok(depth > 0 || !/^\s+[a-z-]+:\s[^{]*;\s*$/.test(code), `stray CSS declaration outside a rule: ${line.trim()}`);
      depth += (code.match(/{/g) || []).length - (code.match(/}/g) || []).length;
    }
    assert.equal(depth, 0, 'balanced braces in the Careers styles');
  }
  assert.match(careers, /<aside>\s*<!-- Jobs by location:[\s\S]*?<\/section>\s*<section class="top-jobs"/);
  assert.ok(careers.includes('html[data-fundsae-connected="live"] [data-demo-only] { display: none !important; }'), 'demo-only content is hidden in live mode');
  // The Spotlight box is on the home page only; the gold slot is not shown anywhere.
  assert.ok(!careers.includes('data-fundsae-slot="sponsor-platinum"') && !careers.includes('data-fundsae-slot="sponsor-gold"'), 'Careers has no Spotlight or Gold Sponsors box');
  // Featured Companies strip at the foot of Careers (no Elite Founding Sponsor banner on this page): the scrolling
  // track holds the sponsor slot, labelled as sponsored.
  assert.ok(!careers.includes('sponsor-founding') && !careers.includes('founding-banner.css'), 'Careers has no Elite Founding Sponsor banner');
  assert.match(careers, /<\/aside>\s*<\/div>\s*<!--[\s\S]*?-->\s*<section class="partners"[\s\S]*?<\/section>\s*<footer/);
  // Job cards carry a dummy initials logo but no Featured tag.
  assert.ok(!/role-featured/.test(careers), 'job cards have no Featured tag');
  // The Exclusive Elite Sponsor box is gone from Careers (and Events), the connector no longer fills it and the
  // Elite package no longer promises it.
  const events = read('Events.dc.html');
  // Industry Events carries the Partner with us page's exclusive look: deep teal-black, gold accents, a gold eyebrow.
  assert.ok(events.includes('  body { background: #091C21; }') && events.includes('--gold: #C9A961;') && events.includes('<p class="eyebrow">Industry Events</p>'), 'Events uses the Partner page look');
  assert.ok(!/elite-sponsor|sponsor-elite-exclusive/.test(careers), 'Careers has no Exclusive Elite Sponsor box');
  assert.ok(!/elite-sponsor|sponsor-elite-exclusive/.test(events), 'Events has no Exclusive Elite Sponsor box');
  assert.ok(!read('PartnerWithUs.dc.html').includes('Exclusive Elite Sponsor box') &&
    !readFileSync(path.join(backend, 'config', 'content.json'), 'utf8').includes('Exclusive Elite Sponsor box'), 'no package promises the box');
  // Events column 2: the travel advert (a premium airline / hotel style ad on a licensed photo, labelled sponsored and
  // opening the Partner with us packages), then the submit forms. No Finance Careers card on this page.
  assert.ok(/<aside>\s*<!--[^>]*-->\s*<a class="ad-travel" href="PartnerWithUs\.dc\.html#packages"[\s\S]*?<\/a>\s*<!-- Field names are the API contract/.test(events), 'Events: the travel advert, then the submit forms');
  assert.ok(events.includes('<span class="ad-label">Sponsored · demo</span>') && events.includes('<img src="img/ad-travel.jpg" alt=""') && !events.includes('fx-careers-banner') && !events.includes('careers-banner.css'), 'the advert is labelled and replaces the careers card');
  assert.ok(statSync(path.join(repo, 'frontend_demo', 'img', 'ad-travel.jpg')).size < 200 * 1024 && readFileSync(path.join(repo, 'frontend_demo', 'img', 'CREDITS.md'), 'utf8').includes('| `ad-travel.jpg` |'), 'advert photo is light and credited');
  const sponsorConnector = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  assert.ok(!sponsorConnector.includes("slots('sponsor-elite-exclusive')") && !sponsorConnector.includes("pick('eliteExclusive')"), 'connector no longer fills the box');
  assert.equal(careers.split('class="partners"').length, 2, 'one Featured Companies strip');
  assert.match(careers, /class="partners-track">\s*<div class="partners-list" data-fundsae-slot="sponsor-companies">/);
  assert.ok(careers.includes('<h2 id="partners-title" class="partners-title">Partners<span class="fxh-sr"> (sponsored)</span></h2>'), 'a Partners heading, labelled as sponsored for screen readers');
  assert.ok(!careers.includes('partners-head') && !careers.includes('Feature your firm'), 'no visible tag or link above the strip');
  // Partners: a dark logo wall, two rows of white logos (mark and name) gliding right to left; still for reduced motion.
  // Partners: a dark logo wall (partners-wall.css, js/fundsae-partners.js), two rows of white logos gliding right to left,
  // above the footer on the home, Careers, Events & Expos and Videos & Podcasts pages. Still for reduced motion.
  const wall = readFileSync(path.join(repo, 'frontend_demo', 'partners-wall.css'), 'utf8');
  const wallJs = readFileSync(path.join(repo, 'js', 'fundsae-partners.js'), 'utf8');
  assert.ok(wall.includes('grid-template-rows: repeat(2, 76px)') && wall.includes('background: #0B2A30') && wall.includes('.partner .logo:not([style*="url("])'), 'partners logo wall');
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.partners-viewport/.test(wall), 'the wall stands still for reduced motion');
  assert.ok(!/innerHTML/.test(wallJs) && wallJs.includes("list.setAttribute('data-fundsae-slot', 'sponsor-companies');") && wallJs.includes("copy.setAttribute('aria-hidden', 'true');"), 'the script builds the wall with textContent and keeps the loop copy hidden');
  assert.ok(!careers.includes('Featured Partners strip: keeps an aria-hidden copy'), 'one loop script, shared');
  // Top Jobs ranks are uniform: one solid teal circle style for every number (no different top three).
  assert.ok(careers.includes('.top-jobs .top-jobs-list .tj-rank { background: var(--tone); color: #FFFFFF; }') && !careers.includes('nth-child(-n+3) .tj-rank'), 'uniform Top Jobs ranks');
  // Top hiring companies: below Top Jobs, 10 employers (name, open jobs), each opening the list filtered to its roles.
  const hiring = careers.slice(careers.indexOf('<section class="top-hiring"'), careers.indexOf('</section>', careers.indexOf('<section class="top-hiring"')));
  assert.ok(careers.indexOf('<section class="top-jobs"') < careers.indexOf('<section class="top-hiring"') && careers.indexOf('<section class="top-hiring"') < careers.indexOf('class="gf-promo"'), 'Top hiring companies sits below Top Jobs');
  assert.ok(hiring.includes('<h2 id="top-hiring-title">Top hiring companies</h2>') && hiring.includes('data-fundsae-slot="top-hiring"'), 'heading and slot');
  assert.equal((hiring.match(/<li><a href="\?employer=emp_[a-f0-9]{16}#opportunities-title"><span class="th-name">[^<]+<\/span><span class="th-count">\d+ jobs?<\/span><\/a><\/li>/g) || []).length, 10, 'ten companies, each with its jobs');
  const hiringJs = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  assert.ok(hiringJs.includes("pickedOrder(api.items(doc.items, api.valid.employer, 'employers'), careersDoc && careersDoc.topEmployers).slice(0, LIMITS.topHiring)") && hiringJs.includes('topHiring: 10'), 'connector: Studio order, ten companies');
  // Jobs by location: first in column 2, one flag card per GCC country, each filtering the list to its country.
  const jbl = careers.slice(careers.indexOf('<aside>'), careers.indexOf('class="top-jobs"'));
  assert.ok(jbl.includes('<h2 id="jobs-location-title">Jobs by location</h2>'), 'Jobs by location tops column 2');
  assert.deepEqual([...jbl.matchAll(/data-jbl-country="([A-Z]{2})"><svg class="jbl-flag"/g)].map((m) => m[1]), ['AE', 'SA', 'QA', 'KW', 'BH', 'OM'], 'the six GCC countries, with flags');
  assert.ok(careers.includes("var value = 'country:' + card.getAttribute('data-jbl-country');") && careers.includes('syncLocationCards(byCountry);') && careers.includes('if (!ready) return;'), 'cards filter by country and show the counts');
  // Browse jobs by function: under the banner, above Current Opportunities, drawn from the Function menu's list, each link filtering by it.
  assert.ok(/<main>\s*<!-- Finance Careers banner[\s\S]*?<\/section>\s*<!-- Browse jobs by function[\s\S]*?<\/section>\s*<section class="opportunities"/.test(careers), 'the banner, then Browse jobs by function, then Current Opportunities');
  assert.ok(careers.includes('FUNCTIONS.forEach(function (fn) {') && careers.includes("a.setAttribute('data-bf-function', fn);") &&
    careers.includes('syncFunctionLinks(seen);') && careers.includes("selects.department.value = selects.department.value === fn ? '' : fn;"), 'links come from the Function list, show counts and filter');
  // One card style across the page, matching the job cards: white cards, capital headings with the teal accent line, teal accents.
  assert.ok(careers.includes('.jobs-by-location, .top-jobs, .resources-box, .browse-functions, .job-search {') && careers.includes("--tone: #2F8A8C; --tone-soft: #E3F1F0; --tint: #FFFFFF;"), 'every block shares the job card style');
  assert.ok(/\.top-jobs h2::before, [^{]*\{\s*content: ""; position: absolute; left: 0; bottom: 0; display: block; width: 30px; height: 3px;/.test(careers), 'headings carry the accent line');
  for (const page of ['Careers.dc.html', 'Events.dc.html', 'Videos.dc.html']) {
    const html = read(page);
    assert.ok(html.includes('<link rel="stylesheet" href="partners-wall.css?v=1">'), `${page} loads partners-wall.css`);
    assert.ok(html.indexOf('src="../js/fundsae-partners.js"') > 0 && html.indexOf('src="../js/fundsae-partners.js"') < html.indexOf('src="../js/fundsae-connector.js"'), `${page} builds the wall before the connector fills it`);
    assert.match(html, /<section class="partners"[^>]*>[\s\S]*?<\/section>\s*<footer class="site-footer">/, `${page}: the wall sits just above the footer`);
  }
  assert.ok(homePage.includes("partners.setAttribute('data-fundsae-partners', '');") && homePage.includes('footer.before(partners);') && homePage.includes("'../js/fundsae-partners.js', '../js/fundsae-connector.js'"), 'home adds the wall above its footer');
  // Partner with us: one package card button per API tier (each opens Contact us), and the Exclusive Partner card is #elite-partner.
  const advertise = read('PartnerWithUs.dc.html');
  const cardTiers = [...advertise.matchAll(/data-fundsae-tier="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cardTiers.sort(), [...ADVERTISING_TIERS].sort());
  assert.match(advertise, /id="elite-partner"[\s\S]*data-fundsae-tier="exclusive"/);
  // Three package cards (Gold Partner, the recommended one; Elite Partner; Exclusive Partner) under a benefits pitch.
  assert.equal([...advertise.matchAll(/<div class="tier[ "]/g)].length, 3, 'three package cards');
  for (const name of ['Gold Partner', 'Elite Partner', 'Exclusive Partner']) assert.ok(advertise.includes(`<h2>${name}</h2>`), name);
  // The page carries the "Be seen." banner's look (deep teal-black, gold accents); Contact us has no intro line.
  assert.ok(advertise.includes('  body { background: #091C21; }') && advertise.includes('--gold: #C9A961;') && advertise.includes('.tier.featured .badge { background: var(--gold);'), 'dark and gold brand look');
  assert.ok(!advertise.includes('news tips, corrections, press') && /<h2 id="contact-title">Get in touch with Funds\.ae<\/h2>\s*<\/div>\s*<\/div>/.test(advertise), 'Contact us has no intro line');
  // Every benefit is a dark heading over a short description; the lead-in line sits above the benefits.
  const cardOf = (name, tier) => advertise.slice(advertise.indexOf(`<h2>${name}</h2>`), advertise.indexOf(`data-fundsae-tier="${tier}"`));
  const benefit = (heading, detail) => `><span><strong>${heading}</strong><span class="detail">${detail}</span></span></li>`;
  const goldCard = cardOf('Gold Partner', 'silver');
  for (const [h, d] of [['Sponsored Posts', 'Two sponsored posts a month on the home page, rotating'], ['Videos and Podcasts', 'Two featured listings in Videos and Podcasts'],
    ['Events and Expos', 'Two featured listings a month in Industry Events'], ['Top Tweets (X posts)', 'One of your tweets in Top Tweets on the home page, rotating'],
    ['Featured Partner link', 'A link to your firm on the home page'], ['Partners logo scroll', 'Your logo in the scrolling Partners strip above the footer on four pages'], ['Top hiring companies', 'A listing on the Careers page'],
    ['Career Resources', 'A link to your firm on the Careers page'], ['Job posts', '10 job posts a month, 1 pinned in Top Jobs']]) {
    assert.ok(goldCard.includes(benefit(h, d)), `Gold Partner: ${h}`);
  }
  const eliteCard = cardOf('Elite Partner', 'gold');
  assert.ok(eliteCard.includes('<p class="tier-lead">Everything in Gold Partner, plus:</p>'), 'Elite Partner lead-in');
  for (const [h, d] of [['Videos and Podcasts', '1 video pinned on the home page per month'], ['Thought Leaders and Influencers', 'A feature in Thought Leaders'],
    ['Spotlight logo on Home Page', 'Your logo in the high-visibility Spotlight box on the home page'], ['Job posts', '20 job posts a month, 2 pinned in Top Jobs'], ['Limited partners', 'A limited number of partners']]) {
    assert.ok(eliteCard.includes(benefit(h, d)), `Elite Partner: ${h}`);
  }
  const exclusiveCard = cardOf('Exclusive Partner', 'exclusive');
  assert.equal(advertise.split('<small>/ month</small>').length - 1, 3, 'every price reads per month, with no billing terms');
  for (const price of ['AED 9,000', 'AED 15,000', 'AED 35,000']) assert.ok(advertise.includes('<div class="price">' + price + ' <small>/ month</small></div>'), price);
  assert.ok(advertise.includes('<span class="badge">Exclusive Partnership</span>') && !advertise.includes('One partner only'), 'Exclusive Partner badge');
  assert.ok(exclusiveCard.includes('<ul class="placements" hidden></ul>') && exclusiveCard.includes('<p class="tier-lead">Selective partnership for:</p>'), 'Exclusive Partner lead-in, no placement lines');
  for (const [h, d] of [['Category exclusivity', 'The only partner in your category'], ['Home page banner', 'Your brand in the banner on the home page'],
    ['Business growth', 'A strategic business growth partnership'], ['Consulting', 'A consulting-based solution'], ['Monthly review', 'A meeting each month to review and adjust the approach']]) {
    assert.ok(exclusiveCard.includes(benefit(h, d)), `Exclusive Partner: ${h}`);
  }
  const tierJs = readFileSync(path.join(repo, 'js', 'fundsae-connector.js'), 'utf8');
  assert.ok(tierJs.includes("var lead = fillBenefits(features, tier.features);") && tierJs.includes("var cut = line.indexOf(': ');"), 'connector draws heading and description benefits');
  assert.ok(advertise.includes('<div class="tier featured">\n        <span class="badge">Recommended</span>\n        <h2>Gold Partner</h2>'.split('\n').join(advertise.includes('\r\n') ? '\r\n' : '\n')), 'Gold Partner is the recommended package');
  assert.ok(advertise.indexOf('id="pitch-title"') < advertise.indexOf('id="packages"'), 'pitch sits above the packages');
  // Why partner (Option B): the licensed Dubai photo banner with "Be seen." and the six benefits, between the pitch and the packages.
  const why = advertise.slice(advertise.indexOf('<section class="section why"'), advertise.indexOf('</section>', advertise.indexOf('<section class="section why"')));
  assert.ok(why.includes('<img class="why-img" src="img/partner-banner.jpg" alt="') && why.includes('<h2 id="why-title">Be seen.</h2>'), 'why-partner banner photo and headline');
  for (const b of ['Reach the decision-makers', 'A trusted setting', 'Seen every day', 'Focused on your market', 'Talent and events reach', 'Clear and accountable']) {
    assert.ok(why.includes(`<li>${b}</li>`), `benefit: ${b}`);
  }
  assert.ok(advertise.indexOf('id="pitch-title"') < advertise.indexOf('class="section why"') && advertise.indexOf('class="section why"') < advertise.indexOf('id="packages"'), 'banner between the pitch and the packages');
  assert.ok(!/Benefits of partnering|class="benefit|Gulf capital reads/.test(advertise), 'the old benefits grid and the cut text are gone');
  assert.ok(statSync(path.join(repo, 'frontend_demo', 'img', 'partner-banner.jpg')).size < 600 * 1024 && readFileSync(path.join(repo, 'frontend_demo', 'img', 'CREDITS.md'), 'utf8').includes('partner-banner.jpg'), 'banner photo is light and credited');
  assert.ok(!advertise.includes('advertise-exclusive') && !connector.includes("'advertise-exclusive'"), 'no separate Elite Exclusive hero');
  // Cards are CMS-managed: placements, show-price, duration and CTA are drawn by the connector, and the enquiry
  // form's package list follows the published packages.
  for (const slot of ['class="placements"', 'class="features"', 'class="duration"', 'class="price"']) assert.ok(advertise.includes(slot), `card template has ${slot}`);
  assert.ok(!/\.tier:not\(\.exclusive\) \.price \{ display: none/.test(advertise), 'prices are shown or hidden by the showPrice field, not page CSS');
  assert.ok(connector.includes("price.hidden = !tier.showPrice") && connector.includes('tier.ctaUrl') && connector.includes("cta.setAttribute('href', '#contact');"), 'connector draws showPrice and the CTA (which opens Contact us)');
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
    assert.ok(stub.includes(`url=${now}"`) && stub.includes(`location.replace('${now}'`), `${old} forwards to ${now}`);
    assert.ok(stub.includes('name="robots" content="noindex"') && !stub.includes('<form'), `${old} is only a redirect`);
  }
  assert.ok(read('i18n.js').includes("'Partner with us': "), 'Arabic label for Partner with us');
});

test('Videos & Podcasts: a header link on every page and a video hub page of dummy videos', () => {
  const read = (...f) => readFileSync(path.join(repo, ...f), 'utf8');
  const page = read('frontend_demo', 'Videos.dc.html');
  for (const f of [...readdirSync(path.join(repo, 'frontend_demo', 'news')).filter((n) => n.endsWith('.html')).map((n) => ['frontend_demo', 'news', n]),
    ['backend', 'templates', 'story.html'], ['backend', 'templates', 'job.html']]) {
    assert.ok(read(...f).includes('<a href="../Videos.dc.html">Watch &amp; Learn</a>'), `${f.join('/')} header links to Watch & Learn`);
  }
  assert.ok(read('js', 'fundsae-header.js').includes("['Watch & Learn', 'Videos.dc.html']"), 'mobile menu links to Watch & Learn');
  assert.ok(read('frontend_demo', 'this.html').includes('<a href="Videos.dc.html" style="display: inline-block; margin-top: 16px'), 'home box View All opens the page');
  assert.ok(page.includes('<title>Videos &amp; Podcasts · Funds.ae</title>') && page.includes('<a href="Videos.dc.html" aria-current="page">'), 'title and current link');
  // Tabs: All, Videos, Podcasts, Interviews, Events; js/fundsae-media.js draws the compact sections (no big banner).
  const tabs = [...page.matchAll(/<button type="button" data-vp-tab="([a-z]+)" aria-pressed="(?:true|false)">([^<]+)<\/button>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(tabs, [['all', 'All'], ['videos', 'Videos'], ['podcasts', 'Podcasts'], ['interviews', 'Interviews'], ['events', 'Events']], 'section tabs');
  assert.ok(page.includes('<div data-vp-library></div>') && page.includes('src="../js/fundsae-media.js"'), 'the library is drawn by the media script');
  assert.ok(!/vp-featured|vp-row|vp-card-big/.test(page), 'no oversized featured banner or scrolling rows');
  // The top of the page is a banner advert (example: a learning institute), labelled sponsored, with a hidden page title.
  assert.ok(page.includes('<h1 class="fxh-sr">Videos &amp; Podcasts</h1>') && !page.includes('class="vp-intro"') && !page.includes('Demo videos:'), 'no intro text, hidden page title');
  assert.ok(/<a class="ad-learning" href="PartnerWithUs\.dc\.html#packages"[\s\S]*?<span class="ad-label">Sponsored · demo<\/span>[\s\S]*?<\/a>\s*<nav class="vp-tabs"/.test(page), 'banner advert above the tabs');
  assert.ok(statSync(path.join(repo, 'frontend_demo', 'img', 'ad-learning.jpg')).size < 300 * 1024 && read('frontend_demo', 'img', 'CREDITS.md').includes('| `ad-learning.jpg` |'), 'advert photo is light and credited');
  const vpMain = page.slice(page.indexOf('<main'), page.indexOf('</main>')).replace('<img src="img/ad-learning.jpg" alt="" width="1600" height="560">', '');
  assert.ok(!/<img|<video|<iframe|url\(/.test(vpMain), 'no other images, players or embeds (dummy thumbnails are CSS)');
  const media = read('js', 'fundsae-media.js');
  for (const [id, title, description] of [['videos', 'Videos', 'News clips, interviews and documentaries.'], ['podcasts', 'Podcasts', 'Audio episodes, each with its own episode page.'],
    ['interviews', 'Interviews', 'CEOs, investors, developers and fund managers.'], ['events', 'Events', 'Conferences, panel discussions and webinars.']]) {
    assert.ok(media.includes(`id: '${id}', kind: `) && media.includes(`title: '${title}', description: '${description}'`), `${title} section and description`);
  }
  assert.ok(!/innerHTML/.test(media) && media.includes("return 'PodcastEpisode.dc.html?ep=' + encodeURIComponent(item.id);"), 'textContent only; podcasts link to their episode page');
  // Each podcast episode has its own page (PodcastEpisode.dc.html?ep=<id>) with the site header and footer.
  const episode = read('frontend_demo', 'PodcastEpisode.dc.html');
  assert.ok(episode.includes('<article class="ep" data-vp-episode>') && episode.includes('src="../js/fundsae-media.js"') &&
    episode.includes('<a href="Videos.dc.html?section=podcasts">Podcasts</a>') && episode.includes('<a href="Videos.dc.html" aria-current="page">'), 'podcast episode page');
  for (const id of ['ep-14', 'ep-13', 'ep-12', 'ep-11', 'ep-10', 'ep-9']) assert.ok(media.includes(`'${id}': [`), `episode ${id} has its page text`);
  assert.ok(read('i18n.js').includes("'Watch & Learn': "), 'Arabic label');
});

test('Grants & Funding page: dummy funding, loan and grant opportunities, browsed by type of funding', () => {
  const page = readFileSync(path.join(repo, 'frontend_demo', 'GrantsFunding.dc.html'), 'utf8');
  const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'));
  assert.ok(page.includes('<title>Grants &amp; Funding · Funds.ae</title>') && page.includes('<a href="GrantsFunding.dc.html" aria-current="page">'), 'title and current header link');
  // The funding-type tiles are the only filter: no type chips, emirate select or search box.
  assert.ok(!/data-gf-type=|data-gf-emirate|data-gf-search|class="gf-chip/.test(page), 'no type chips, emirate filter or search box');
  assert.ok(main.includes('data-gf-results') && main.includes('data-gf-count') && main.includes('data-gf-empty'), 'results heading, count and empty message');
  const cards = [...main.matchAll(/<article class="gf-card[^"]*" data-type="(grant|loan|equity|trade)" data-emirate="(abu-dhabi|dubai|sharjah|northern|uae)" data-cats="([a-z -]+)">/g)];
  assert.ok(cards.length >= 12, 'at least 12 opportunity cards, each with a type and an emirate');
  assert.equal(cards.length, (main.match(/class="gf-card/g) || []).length, 'every card is filterable');
  for (const type of ['grant', 'loan', 'equity', 'trade']) assert.ok(cards.some((m) => m[1] === type), `at least one ${type}`);
  assert.ok(main.includes('not financial advice'), 'disclaimer');
  // Each card: a "TYPE · EMIRATE" line, the company name, one sentence about the funding and a details link.
  const bodies = main.split('<article class="gf-card').slice(1).map((c) => c.slice(0, c.indexOf('</article>')));
  for (const c of bodies) {
    assert.match(c, /<p class="gf-kicker">(Grant|Loan|Equity|Trade finance) · /, 'card type line');
    assert.match(c, /<h3>[^<]{3,}<\/h3>\s*<p class="gf-brief">[^<]{20,}<\/p>\s*<p class="gf-cats">[^<]+<\/p>\s*<a class="gf-link" href="#"/, 'company name, brief text, funding types, then the link');
  }
  assert.ok(!/<img|https?:\/\//.test(main), 'no images or external links in the page body');
  const script = page.slice(page.lastIndexOf('<script>'), page.lastIndexOf('</script>'));
  assert.ok(script.includes('count.textContent') && !/innerHTML|insertAdjacentHTML/.test(script), 'the filter script sets text only');
  // Hero (Option B): the licensed Dubai photo and the headline only, between the header bar and the page; the old
  // intro text and the subtitle are gone.
  const hero = page.slice(page.indexOf('<section class="gf-hero"'), page.indexOf('</section>', page.indexOf('<section class="gf-hero"')));
  assert.ok(hero.includes('<img class="gf-hero-img" src="img/grants-hero.jpg" alt="') && hero.includes('<h1 id="gf-hero-title">Capital for every stage of your business.</h1>'), 'hero photo and headline');
  assert.ok(page.indexOf('<nav class="fx-catbar"') < page.indexOf('<section class="gf-hero"') && page.indexOf('<section class="gf-hero"') < page.indexOf('<main'), 'hero sits under the header bar');
  assert.ok(!/Every type of UAE business funding|From first-time founders|class="gf-intro"/.test(page), 'no intro text or subtitle');
  assert.ok(statSync(path.join(repo, 'frontend_demo', 'img', 'grants-hero.jpg')).size < 600 * 1024, 'hero photo under 600 KB');
  assert.ok(readFileSync(path.join(repo, 'frontend_demo', 'img', 'CREDITS.md'), 'utf8').includes('grants-hero.jpg'), 'hero photo is credited');
  // Browse by type of funding: 12 tiles, every card tagged with known types, every type used.
  const tiles = [...main.matchAll(/<button type="button" class="gf-type" data-gf-cat="([a-z-]+)" aria-pressed="false">/g)].map((m) => m[1]);
  assert.equal(tiles.length, 12, 'twelve funding-type tiles');
  for (const m of cards) for (const c of m[3].split(' ')) assert.ok(tiles.includes(c), `card type ${c} has a tile`);
  for (const id of tiles) assert.ok(cards.some((m) => m[3].split(' ').includes(id)), `tile ${id} lists at least one programme`);
  assert.ok(script.includes("get('category')") && script.includes('history.replaceState'), 'a type can be linked with ?category=');
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
  assert.deepEqual([...seen].sort(), ['contact', 'event', 'job']); // partnership enquiries use Contact us (the advertise API stays for older clients)
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
  // Post a job is no longer linked from the Careers banner; the page stays available at PostJob.dc.html.
});

test('the old news feed page is removed: News.dc.html only forwards to Real Estate News, and nothing links to it', () => {
  const read = (...p) => readFileSync(path.join(repo, ...p), 'utf8');
  const stub = read('frontend_demo', 'News.dc.html');
  assert.ok(!stub.includes('data-fundsae-news') && !stub.includes('<header') && stub.length < 2000, 'News.dc.html has no page left');
  // Old one-category links (bookmarks, cached home pages) open the matching column.
  assert.ok(stub.includes("var COLUMN = { 'residential-real-estate': 'residential', 'commercial-real-estate': 'commercial', 'infrastructure': 'alternative', 'special-alternative-real-estate': 'alternative' };") &&
    stub.includes("location.replace('RealEstateNews.dc.html' + hash)"), 'News.dc.html?section=<box> forwards to that column');
  for (const gone of ['fundsae-news.js', 'fundsae-news-filter.js']) assert.ok(!existsSync(path.join(repo, 'js', gone)), `js/${gone} is removed`);
  // No page, story page, template or script links to the old page any more.
  const files = [
    ...readdirSync(path.join(repo, 'frontend_demo')).filter((f) => f.endsWith('.html') && !MOVED_PAGES[f]).map((f) => ['frontend_demo', f]),
    ...readdirSync(path.join(repo, 'frontend_demo', 'news')).filter((f) => f.endsWith('.html')).map((f) => ['frontend_demo', 'news', f]),
    ['backend', 'templates', 'story.html'], ['backend', 'templates', 'job.html'], ['backend', 'src', 'pipeline', 'storyPages.js'],
    ['js', 'fundsae-connector.js'], ['js', 'fundsae-header.js'], ['i18n.js']
  ];
  for (const f of files) assert.ok(!/(^|[^A-Za-z])News\.dc\.html/.test(read(...f)), `${f.join('/')} links to the removed News.dc.html`);
  // No Real Estate News link in the header; the page is reached from the home page's real estate boxes (View All).
  for (const f of ['About', 'PartnerWithUs', 'Careers', 'Events', 'GrantsFunding', 'PostJob', 'Privacy', 'RealEstateNews', 'Terms', 'Videos']) {
    assert.ok(!read('frontend_demo', `${f}.dc.html`).includes('>Real Estate News</a>'), `${f} has no Real Estate News header link`);
  }
  // Every real estate tile shows its source in small text; live tiles get the publisher's name.
  const home = read('frontend_demo', 'this.html');
  assert.ok(home.includes("source.className = 'fx-tile-source'"), 'real estate tiles carry a source line');
  assert.ok(read('js', 'fundsae-connector.js').includes("art.querySelector('.fx-tile-source')"), 'the connector fills the source line');
});

test('Contact us is part of Partner with us: the footer opens it, and the old page only forwards there', () => {
  const read = (...p) => readFileSync(path.join(repo, ...p), 'utf8');
  const partner = read('frontend_demo', 'PartnerWithUs.dc.html');
  assert.ok(partner.includes('<section class="section" id="contact" aria-labelledby="contact-title">') && partner.includes('<form method="post" data-fundsae-form="contact">') &&
    partner.includes('<h3>Contact details</h3>') && partner.includes('src="../js/fundsae-forms.js"'), 'Partner with us has the contact form and details');
  // One form only: the separate sponsorship enquiry is gone and the package buttons open Contact us instead.
  assert.ok(!partner.includes('data-fundsae-form="advertise"') && !partner.includes('id="enquiry"') && !partner.includes('Talk to our partnerships team'), 'no separate sponsorship enquiry');
  assert.equal([...partner.matchAll(/href="#contact" data-fundsae-tier="/g)].length, 3, 'each package button opens Contact us');
  assert.ok(partner.indexOf('id="packages"') < partner.indexOf('id="contact"'), 'Contact us follows the packages');
  const forms = read('js', 'fundsae-forms.js');
  assert.ok(forms.includes(`document.querySelector('[data-fundsae-form="contact"]')`) && forms.includes("filled = (heading.textContent.trim() + ' enquiry').slice(0, 120);"), 'a package button fills the subject');
  const ids = [...partner.replace(/<!--[\s\S]*?-->/g, '').matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'no repeated ids on the page (two forms)');
  // No page, story/job page, template, menu or content links to the old page any more.
  const files = [
    ...readdirSync(path.join(repo, 'frontend_demo')).filter((f) => f.endsWith('.html') && !MOVED_PAGES[f]).map((f) => ['frontend_demo', f]),
    ...readdirSync(path.join(repo, 'frontend_demo', 'news')).filter((f) => f.endsWith('.html')).map((f) => ['frontend_demo', 'news', f]),
    ['backend', 'templates', 'story.html'], ['backend', 'templates', 'job.html'], ['js', 'fundsae-header.js'], ['backend', 'config', 'content.json']
  ];
  for (const f of files) assert.ok(!read(...f).includes('Contact.dc.html'), `${f.join('/')} links to the old Contact page`);
  assert.ok(read('frontend_demo', 'About.dc.html').includes('<a href="PartnerWithUs.dc.html#contact">Contact us</a>'), 'footer Contact us opens the section');
  assert.ok(!read('frontend_demo', 'About.dc.html').includes('<a href="#">Contact us'), "About's Get in touch button opens the section too");
});

