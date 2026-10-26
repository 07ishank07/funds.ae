// The news category systems: config/news-taxonomy.json (Capital Types, Asset Classes),
// the geography and transaction keywords in taxonomy.json, their validation, and the
// rule classifier that suggests tags for the review queue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const { loadAll, validateNewsTaxonomy, readJson, CONFIG_DIR } = await import('../src/config.js');
const { buildClassifier, classifyArticle } = await import('../src/lib/classify.js');
const { buildTaxonomyClassifier, classifyTaxonomy } = await import('../src/lib/taxonomyClassify.js');
const { NEWS_GEOGRAPHIES, NEWS_HOME_SECTIONS, NEWS_TRANSACTION_TYPES } = await import('../src/news/rules.js');

const cfg = loadAll();
const tc = buildTaxonomyClassifier(cfg.newsTaxonomy, cfg.taxonomy);
const topics = buildClassifier(cfg.taxonomy);

/** Classifies the way the pipeline does: UAE from the topic classifier, then the taxonomy suggestions. */
function classify(title, summary = '') {
  const base = classifyArticle(topics, { title, summary }, { region: 'global' }, cfg.settings);
  return { ...classifyTaxonomy(tc, { title, summary }, { uae: base.category === 'uae' }), relevance: base.relevance };
}

test('the seed has the prompt\'s 12 Capital Types plus Government and Endowments, and 13 Asset Classes', () => {
  const names = cfg.newsTaxonomy.capitalTypes.map((c) => c.name);
  for (const name of ['Institutional Investors', 'Private Equity', 'Sovereign Wealth Funds', 'Pension Funds', 'REITs', 'Family Offices',
    'Private Credit & Debt Funds', 'Banks & Lenders', 'Infrastructure Funds', 'Asset Managers', 'Developers & Owner-Operators',
    'Joint Ventures & Co-Investments', 'Government', 'Endowments']) assert.ok(names.includes(name), name);
  assert.equal(names.length, 14);
  assert.deepEqual(cfg.newsTaxonomy.assetClasses.map((a) => a.name), ['Office', 'Retail', 'Industrial & Logistics', 'Residential & Multifamily',
    'Hospitality & Hotels', 'Data Centres', 'Healthcare & Life Sciences', 'Student Accommodation', 'Senior Living', 'Mixed-Use',
    'Land & Development', 'Infrastructure & Energy', 'Alternative Real Estate']);
});

test('the category bar\'s Capital Types keep today\'s labels, order and topic ids', () => {
  const nav = cfg.newsTaxonomy.capitalTypes.filter((c) => c.showInNav).sort((a, b) => a.displayOrder - b.displayOrder);
  assert.deepEqual(nav.map((c) => c.navLabel), ['Sovereign', 'Pension', 'Private Equity', 'REITs', 'Family Offices', 'Banks', 'Government', 'Endowments']);
  const topicIds = new Set(cfg.taxonomy.topics.map((t) => t.id));
  for (const c of nav) assert.ok(topicIds.has(c.id), `${c.id} is also a topic id, so old links and filters keep working`);
});

test('every home page real estate box is fed by at least one Asset Class', () => {
  for (const section of NEWS_HOME_SECTIONS) {
    assert.ok(cfg.newsTaxonomy.assetClasses.some((a) => a.homeSection === section), section);
  }
});

test('geography and transaction keywords use the fixed ids from the shared rules', () => {
  for (const g of cfg.taxonomy.geographies) assert.ok(NEWS_GEOGRAPHIES.includes(g.id), g.id);
  for (const t of cfg.taxonomy.transactionTypes) assert.ok(NEWS_TRANSACTION_TYPES.includes(t.id), t.id);
});

test('a sovereign investor backing a Dubai build-to-rent fund', () => {
  const r = classify('Mubadala backs Dubai build-to-rent fund', 'The sovereign investor is the anchor investor.');
  assert.deepEqual(r.capitalTypes, ['sovereign-wealth']);
  assert.deepEqual(r.assetClasses, ['residential-multifamily']);
  assert.deepEqual(r.geography, ['uae']);
  assert.equal(r.transactionType, 'investment');
  assert.equal(r.confidence, 1);
  assert.equal(r.needsReview, false);
  assert.match(r.explanation, /sovereign-wealth \(.*mubadala\)/);
});

test('a story can carry several Capital Types and Asset Classes', () => {
  const r = classify('ADIA and CPPIB buy Abu Dhabi logistics park', 'The deal adds to a run of industrial transactions in the Gulf.');
  assert.deepEqual(r.capitalTypes, ['sovereign-wealth', 'pension-funds']);
  assert.deepEqual(r.assetClasses, ['industrial-logistics']);
  assert.equal(r.transactionType, 'acquisition');

  const jv = classify('Aldar and Mubadala form AED 1bn joint venture for Abu Dhabi offices');
  assert.deepEqual(jv.capitalTypes.sort(), ['developers-operators', 'joint-ventures', 'sovereign-wealth']);
  assert.deepEqual(jv.assetClasses, ['office']);
  assert.equal(jv.transactionType, 'joint-venture');

  const fund = classify('Hines launches European student housing fund with first close at €400m');
  assert.deepEqual(fund.assetClasses, ['student-accommodation', 'residential-multifamily']);
  assert.deepEqual(fund.geography, ['europe']);
  assert.equal(fund.transactionType, 'fund-close');
});

test('a family office is never read as an office building', () => {
  const r = classify('Sharjah family office launches $200m venture fund for climate start-ups', 'Family offices across the Gulf are backing climate funds.');
  assert.deepEqual(r.capitalTypes, ['family-offices']);
  assert.deepEqual(r.assetClasses, []);
  assert.deepEqual(classify('DIFC fund managers pass 500 as hedge funds and family offices keep arriving').assetClasses, []);
  assert.deepEqual(classify('Investor buys Abu Dhabi offices').assetClasses, ['office'], 'real offices still count');
});

test('several geographies, and Global only when nothing more specific matches', () => {
  assert.deepEqual(classify('Saudi PIF and UK pension fund back London office deal').geography.sort(), ['saudi-arabia', 'uk']);
  assert.deepEqual(classify('Brookfield secures $500m refinancing for Riyadh data centre platform').geography, ['saudi-arabia']);
  assert.deepEqual(classify('Investors pour money into logistics worldwide', 'A worldwide rush for warehouses.').geography, ['global']);
  assert.deepEqual(classify('London and worldwide investors buy warehouses').geography, ['uk']);
});

test('a story with too little information stays unclassified and is flagged for review', () => {
  const vague = classify('Markets close higher on Tuesday', 'Stocks rose.');
  assert.deepEqual([vague.capitalTypes, vague.assetClasses, vague.geography], [[], [], []]);
  assert.equal(vague.transactionType, null);
  assert.equal(vague.confidence, 0);
  assert.equal(vague.needsReview, true);
  assert.deepEqual(vague.reasons, ['No Capital Type matched.', 'No Asset Class matched.', 'Low confidence (0).']);

  const venture = classify('Fintech startup raises $20m Series A', 'The round was led by a venture capital firm.');
  assert.deepEqual(venture.assetClasses, [], 'no real estate asset is invented for a venture round');
  assert.equal(venture.needsReview, true);
});

test('real estate deals rank first in the queue; lifestyle articles are pushed out by negative terms', () => {
  const deal = classify('Brookfield secures $500m refinancing for Riyadh data centre platform');
  assert.equal(deal.priority, 5);
  assert.equal(classify('Markets close higher on Tuesday').priority, 0);
  const lifestyle = classify('Interior design tips for your new Dubai villa', 'Home decor ideas for first-time buyers.');
  assert.ok(lifestyle.relevance < cfg.settings.news.relevanceThreshold, `relevance ${lifestyle.relevance} is below the import threshold`);
  assert.deepEqual(lifestyle.capitalTypes, []);
});

test('news taxonomy validation explains every problem', () => {
  const good = readJson(path.join(CONFIG_DIR, 'news-taxonomy.json'));
  assert.deepEqual(validateNewsTaxonomy(good, cfg.taxonomy), []);
  const broken = structuredClone(good);
  broken.capitalTypes[0].id = 'Bad Id';
  broken.capitalTypes[1].id = broken.capitalTypes[2].id;
  broken.capitalTypes[3].keywords = { 'Upper Case': 3, ok: 9 };
  broken.capitalTypes[4].navLabel = '';
  broken.capitalTypes[5].displayOrder = 1000;
  broken.assetClasses[0].homeSection = 'sports';
  broken.assetClasses[1].name = 'x';
  const errors = validateNewsTaxonomy(broken, cfg.taxonomy).join('\n');
  for (const expected of [/"id" must be lowercase/, /duplicate id/, /keyword "Upper Case"/, /keyword "ok" needs a weight from 1 to 5/,
    /"navLabel" must be 2-24/, /"displayOrder" must be a whole number/, /"homeSection" must be one of/, /"name" must be 2-60/]) {
    assert.match(errors, expected);
  }
  assert.match(validateNewsTaxonomy({ capitalTypes: [], assetClasses: good.assetClasses }).join(' '), /at least one Capital Type/);
  const tooMany = structuredClone(good);
  tooMany.capitalTypes.forEach((c) => { c.showInNav = true; c.navLabel = c.navLabel || 'Label'; });
  assert.match(validateNewsTaxonomy(tooMany, cfg.taxonomy).join(' '), /at most 12 Capital Types can show/);
  assert.match(validateNewsTaxonomy(good, { geographies: [{ id: 'uae', keywords: { dubai: 3 } }] }).join(' '), /"id" must be one of/, 'UAE comes from uaeTerms');
});
