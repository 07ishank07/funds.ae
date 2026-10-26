// Optional AI suggestions (src/ai/enrich.js) with a stand-in Claude client: off by default, only for
// sources that allow it, only the headline and excerpt are sent, answers are checked (known ids,
// 280 characters, no copied runs of 8 words), failures and refusals leave the rule-based result.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(tmpdir(), 'fundsae-ai-'));
process.env.FUNDSAE_ALLOW_PRIVATE_URLS = '1';
process.env.FUNDSAE_API_DIR = path.join(tmp, 'api');

const { aiEnabled, createEnricher, cleanSuggestion, longestCopiedRun, AI_DEFAULTS } = await import('../src/ai/enrich.js');
const { loadAll, withNewsDefaults, applyNewsSettings, validateSources } = await import('../src/config.js');
const { buildTaxonomyIndex, withAiSuggestion } = await import('../src/news/reviewDocs.js');
const { runNews } = await import('../src/pipeline/news.js');
const { createFileNewsReview } = await import('../src/repositories/newsReview.js');
const { JsonStore } = await import('../src/store/jsonStore.js');
const { assertImporterMutation } = await import('../src/news/importerMutations.js');

const base = loadAll();
const article = {
  articleId: 'a_0123456789abcdef', sourceName: 'Example Wire',
  title: 'Mubadala backs $250 million Dubai build-to-rent fund',
  summary: 'Abu Dhabi sovereign investor Mubadala is the anchor investor in a $250 million build-to-rent fund in Dubai.'
};
const good = {
  summary: 'Mubadala is anchoring a new Dubai rental-housing fund worth about $250m, its latest bet on the emirate\'s residential market.',
  capitalTypes: ['sovereign-wealth', 'not-a-type'], assetClasses: ['residential-multifamily'], geography: ['uae'],
  transactionType: 'investment', confidence: 0.91
};

/** A stand-in for client.beta.messages.create that records requests and plays back answers. */
function fakeClient(answers) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        create: async (params) => {
          requests.push(params);
          const next = answers.shift();
          if (next instanceof Error) throw next;
          if (next?.stop_reason) return next;
          if (typeof next === 'string') return { stop_reason: 'end_turn', content: [{ type: 'text', text: next }] };
          return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(next) }] };
        }
      }
    }
  };
}
const settingsWith = (ai) => {
  const settings = structuredClone(base.settings);
  settings.news.ai = { ...settings.news.ai, ...ai };
  return settings;
};

test('AI is off by default, and needs both the setting and an API key', () => {
  assert.equal(base.settings.news.ai.enabled, false);
  assert.deepEqual(base.settings.news.ai, AI_DEFAULTS);
  assert.equal(aiEnabled(base.settings, { ANTHROPIC_API_KEY: 'sk-test' }), false);
  assert.equal(aiEnabled(settingsWith({ enabled: true }), {}), false);
  assert.equal(aiEnabled(settingsWith({ enabled: true }), { ANTHROPIC_API_KEY: 'sk-test' }), true);
});

test('the request sends only the publisher, headline and excerpt, asks for checked JSON, and opts into fallbacks', async () => {
  const client = fakeClient([good]);
  const { enrich } = await createEnricher({ settings: settingsWith({ enabled: true }), newsTaxonomy: base.newsTaxonomy, client });
  const suggestion = await enrich(article);
  const [request] = client.requests;
  assert.equal(request.model, 'claude-opus-5-5');
  assert.deepEqual(request.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(request.fallbacks, 'default');
  assert.equal(request.output_config.effort, 'low');
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.equal(request.output_config.format.schema.additionalProperties, false);
  assert.ok(request.output_config.format.schema.properties.capitalTypes.items.enum.includes('sovereign-wealth'));
  assert.equal(request.thinking, undefined, 'thinking is left to the model (always on for Claude Opus 5.5)');
  assert.equal(request.messages.length, 1);
  assert.equal(request.messages[0].content, `Publisher: Example Wire\nHeadline: ${article.title}\nExcerpt: ${article.summary}`);
  assert.deepEqual(suggestion.capitalTypes, ['sovereign-wealth'], 'unknown ids are dropped');
  assert.equal(suggestion.summary, good.summary);
  assert.equal(suggestion.confidence, 0.91);
});

test('summaries that are too long or copy the publisher are discarded; the tags are kept', () => {
  const ctx = { newsTaxonomy: base.newsTaxonomy, headline: article.title, excerpt: article.summary };
  assert.equal(cleanSuggestion({ ...good, summary: 'x '.repeat(200) }, ctx).summary, null);
  const copied = cleanSuggestion({ ...good, summary: 'Reports say Abu Dhabi sovereign investor Mubadala is the anchor investor in a fund.' }, ctx);
  assert.equal(copied.summary, null, 'eight or more words in a row from the excerpt');
  assert.deepEqual(copied.assetClasses, ['residential-multifamily']);
  const odd = cleanSuggestion({ ...good, transactionType: 'none', confidence: 7, geography: ['uae', 'mars'] }, ctx);
  assert.equal(odd.transactionType, null);
  assert.equal(odd.confidence, 1);
  assert.deepEqual(odd.geography, ['uae']);
  assert.equal(cleanSuggestion(null, ctx), null);
  assert.equal(longestCopiedRun('the anchor investor in a fund', 'is the anchor investor in a new fund'), 5);
  assert.equal(longestCopiedRun('Totally different words', article.summary), 0);
});

test('refusals and errors leave the story to the rules; a bad key stops further calls; maxPerRun caps the run', async () => {
  const refusal = { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] };
  const authError = Object.assign(new Error('invalid x-api-key'), { status: 401 });
  const client = fakeClient([refusal, new Error('timeout'), authError, good]);
  const { enrich, stats } = await createEnricher({ settings: settingsWith({ enabled: true, maxPerRun: 10 }), newsTaxonomy: base.newsTaxonomy, client });
  assert.equal(await enrich(article), null, 'refused');
  assert.equal(await enrich(article), null, 'network error');
  assert.equal(await enrich(article), null, 'bad key');
  assert.equal(await enrich(article), null, 'no more calls after a 401');
  assert.equal(client.requests.length, 3);
  assert.equal(stats.refused, 1);
  assert.equal(stats.failed, 2);

  const capped = fakeClient([good, good, good]);
  const limited = await createEnricher({ settings: settingsWith({ enabled: true, maxPerRun: 2 }), newsTaxonomy: base.newsTaxonomy, client: capped });
  for (let i = 0; i < 3; i++) await limited.enrich(article);
  assert.equal(capped.requests.length, 2);
});

test('a model without default fallbacks gets none', async () => {
  const client = fakeClient([good]);
  const { enrich } = await createEnricher({ settings: settingsWith({ enabled: true, model: 'claude-haiku-5-5' }), newsTaxonomy: base.newsTaxonomy, client });
  await enrich(article);
  assert.equal(client.requests[0].fallbacks, undefined);
  assert.equal(client.requests[0].betas, undefined);
});

/** Runs fn and returns what the logger wrote to stderr meanwhile. */
async function stderrOf(fn) {
  const original = process.stderr.write.bind(process.stderr);
  let out = '';
  process.stderr.write = (chunk, ...rest) => { out += String(chunk); return typeof rest.at(-1) === 'function' ? (rest.at(-1)(), true) : true; };
  try { await fn(); } finally { process.stderr.write = original; }
  return out;
}

test("Claude's answer never reaches the logs, and cut-off or broken answers fall back to the rules", async () => {
  const client = fakeClient(['Mubadala backs a fund, not JSON', { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"summary": "Mubadala' }] }]);
  const { enrich, stats } = await createEnricher({ settings: settingsWith({ enabled: true }), newsTaxonomy: base.newsTaxonomy, client });
  const logs = await stderrOf(async () => {
    assert.equal(await enrich(article), null);
    assert.equal(await enrich(article), null);
  });
  assert.equal(stats.failed, 2);
  assert.match(logs, /not valid JSON/);
  assert.match(logs, /cut off/);
  assert.ok(!/Mubadala/.test(logs), 'no headline or model text in the logs');
});

test('a summary that only repeats the headline is dropped', () => {
  const ctx = { newsTaxonomy: base.newsTaxonomy, headline: article.title, excerpt: '' };
  assert.equal(cleanSuggestion({ ...good, summary: `${article.title}.` }, ctx).summary, null);
});

test('the run stops asking once its time budget is spent', async () => {
  let now = 0;
  const client = fakeClient([good, good, good]);
  const { enrich, stats } = await createEnricher({ settings: settingsWith({ enabled: true }), newsTaxonomy: base.newsTaxonomy, client, clock: () => now });
  await enrich(article);
  now = 6 * 60_000;
  await stderrOf(async () => { assert.equal(await enrich(article), null); });
  assert.equal(client.requests.length, 1);
  assert.equal(stats.outOfTime, true);
});

test('where the AI suggests no categories, the keyword-based ones stay', () => {
  const index = buildTaxonomyIndex(base.newsTaxonomy);
  const doc = {
    geography: ['uae'], transactionType: 'investment',
    classification: { method: 'rules', suggestedCapitalTypes: ['sovereign-wealth'], suggestedAssetClasses: ['residential-multifamily'] }
  };
  const next = withAiSuggestion(doc, { summary: null, capitalTypes: [], assetClasses: ['industrial-logistics'], geography: [], transactionType: null, confidence: 0.8 }, index);
  assert.deepEqual(next.classification.suggestedCapitalTypes, ['sovereign-wealth']);
  assert.deepEqual(next.classification.suggestedAssetClasses, ['industrial-logistics']);
  assert.deepEqual(next.capitalTypes.map((r) => r._key), ['sovereign-wealth']);
  assert.equal(next.transactionType, 'investment');
  assert.deepEqual(next.geography, ['uae']);
  assert.ok(next.classification.reasons.some((r) => /Keyword-based categories kept/.test(r)));
  assert.equal(next.summary, undefined, 'no summary survived, so none is set');
});

test('AI summaries need a terms review, and the importer refuses an over-long suggested summary', () => {
  const live = withNewsDefaults({ id: 'wire-x', name: 'Wire X', homepage: 'https://example.com', type: 'rss', url: 'https://example.com/feed.xml', region: 'uae', focus: 'private-markets', tier: 'L2', licenseStatus: 'wire' });
  assert.match(validateSources([{ ...live, allowAiSummary: true }], 'news', { demo: false }).join(' '), /allowAiSummary/);
  assert.deepEqual(validateSources([{ ...live, allowAiSummary: true, licenseStatus: 'permission_granted', termsReviewedAt: '2026-10-01' }], 'news', { demo: false }), []);
  const doc = { _id: 'queue.a_0123456789abcdef', _type: 'newsArticle', status: 'pending_review', classification: { suggestedSummary: 'x'.repeat(281) } };
  assert.throws(() => assertImporterMutation({ createIfNotExists: doc }), /suggestedSummary/);
});

test('AI settings are validated', () => {
  const problems = (ai) => {
    try { applyNewsSettings({ news: { maxAgeDays: 21, excerptMaxChars: 280, ai } }); return ''; } catch (err) { return err.message; }
  };
  assert.equal(problems({ enabled: true }), '');
  assert.match(problems({ enabled: 'yes' }), /news\.ai\.enabled/);
  assert.match(problems({ model: 'gpt-4' }), /news\.ai\.model/);
  assert.match(problems({ effort: 'extreme' }), /news\.ai\.effort/);
  assert.match(problems({ maxPerRun: 0 }), /news\.ai\.maxPerRun/);
});

/* ------------------------------ in the pipeline ------------------------------ */

let server;
let origin;
before(async () => {
  server = http.createServer((req, res) => {
    const items = {
      '/ai-ok.xml': [{ title: article.title, link: 'https://news.example.com/mubadala-btr', excerpt: article.summary }],
      '/ai-no.xml': [{ title: 'Aldar sells Abu Dhabi office tower to a European pension fund', link: 'https://other.example.com/aldar-office', excerpt: 'Aldar sold an office tower in Abu Dhabi.' }],
      '/ai-wire.xml': [{ title: 'ADIA joins Riyadh logistics warehouse joint venture', link: 'https://wire.example.com/adia-logistics', excerpt: 'ADIA has joined a logistics warehouse venture in Riyadh.' }]
    }[req.url] || [];
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>F</title>${items.map((i) =>
      `<item><title>${i.title}</title><link>${i.link}</link><guid>${i.link}</guid><pubDate>${new Date('2026-10-25T06:00:00Z').toUTCString()}</pubDate><description>${i.excerpt}</description></item>`).join('')}</channel></rss>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test('new stories from sources that allow it carry the AI suggestion, still pending; others are left alone', async () => {
  const source = (id, extra) => withNewsDefaults({
    id, name: `Source ${id}`, homepage: 'https://example.com', type: 'rss', url: `${origin}/${id}.xml`, enabled: true,
    region: 'uae', focus: 'private-markets', priority: 2, tier: 'L2', licenseStatus: 'wire', ...extra
  });
  const reviewed = { licenseStatus: 'terms_reviewed', termsUrl: 'https://example.com/terms', termsReviewedAt: '2026-10-01' };
  // ai-wire allows AI summaries but nobody has read its terms (wire status): it is never sent.
  const sources = [source('ai-ok', { allowAiSummary: true, ...reviewed }), source('ai-no', reviewed), source('ai-wire', { allowAiSummary: true })];
  const settings = settingsWith({ enabled: true });
  settings.mode = 'live';
  settings.http = { ...settings.http, retries: 0, retryBaseDelayMs: 1 };
  settings.news.checkLinks = false;
  const client = fakeClient([good]);
  const enricher = await createEnricher({ settings, newsTaxonomy: base.newsTaxonomy, client });
  const repo = createFileNewsReview(new JsonStore(path.join(tmp, 'queue')));
  const sent = [];
  const review = { ...repo, commit: (m) => { sent.push(...m); return repo.commit(m); } };
  let health = { sources: {} };
  await runNews({
    settings, demo: false, now: new Date('2026-10-26T08:00:00Z'), taxonomy: base.taxonomy, newsTaxonomy: base.newsTaxonomy,
    newsSources: sources, allNewsSources: sources, review, enricher,
    newsHealth: { load: () => health, save: (s) => { health = s; } }
  });
  assert.equal(client.requests.length, 1, 'only the reviewed source that allows AI was sent');
  assert.match(client.requests[0].messages[0].content, /Mubadala/);
  const docs = await repo.loadRecent(new Date(0));
  const ai = docs.find((d) => d.sourceId === 'ai-ok');
  assert.equal(ai.status, 'pending_review', 'a suggestion never publishes anything');
  assert.equal(ai.summary, good.summary);
  assert.equal(ai.summarySource, 'ai');
  assert.equal(ai.excerpt, article.summary, 'the publisher excerpt is kept separately');
  assert.equal(ai.classification.method, 'ai');
  assert.equal(ai.classification.suggestedSummary, good.summary);
  assert.deepEqual(ai.capitalTypes.map((r) => r._key), ['sovereign-wealth']);
  const plain = docs.find((d) => d.sourceId === 'ai-no');
  assert.equal(plain.classification.method, 'rules');
  assert.equal(plain.summarySource, 'excerpt');
  assert.equal(docs.find((d) => d.sourceId === 'ai-wire').classification.method, 'rules');
  for (const m of sent) assert.doesNotThrow(() => assertImporterMutation(m));
});
