// The news source registry and categories managed in Sanity: the seed maps back to exactly
// today's config files, cms:pull validates everything and writes both files or neither, an
// empty registry never replaces them, and categories created in the Studio keep their id.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.FUNDSAE_ALLOW_PRIVATE_URLS = '1';
const { buildNewsSeed } = await import('../scripts/cms-seed.mjs');
const { toSourcesConfig, toNewsTaxonomy } = await import('../src/cms/mapping.js');
const { pullRegistryFromSanity, REGISTRY_NOTE } = await import('../src/cms/pull.js');
const { CONFIG_DIR, readJson, validateSources, validateNewsTaxonomy } = await import('../src/config.js');
const { buildTaxonomyIndex, refsFor } = await import('../src/news/reviewDocs.js');

const TOKEN = 'skREGISTRYtoken0123456789SECRET';
const strip = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_')));

/** What REGISTRY_QUERY returns for these documents once published. */
function queryResult(docs) {
  const of = (type) => docs.filter((d) => d._type === type);
  const keywords = (list) => (list || []).map(({ term, weight }) => ({ term, weight }));
  return {
    sources: of('newsSource').map(({ _id, _type, id, ...rest }) => ({ id: id.current, ...rest })),
    capitalTypes: of('capitalType').map(({ _type, id, keywords: k, ...rest }) => ({ ...rest, id: id.current, keywords: keywords(k) })),
    assetClasses: of('assetClass').map(({ _type, id, keywords: k, ...rest }) => ({ ...rest, id: id.current, keywords: keywords(k) }))
  };
}

let server;
let baseUrl;
let reply = {};
before(async () => {
  server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: reply }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

const env = { SANITY_PROJECT_ID: 'ab12cd34', SANITY_READ_TOKEN: TOKEN };
const settings = { userAgent: 'FundsAeNewsBot/1.0 (test)' };
function configCopy() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fundsae-registry-'));
  for (const f of ['sources.news.json', 'news-taxonomy.json', 'taxonomy.json']) copyFileSync(path.join(CONFIG_DIR, f), path.join(dir, f));
  return dir;
}
const pull = (dir) => pullRegistryFromSanity({ settings, env, configDir: dir, http: { baseUrl, retries: 0 } });

test('the news seed maps back to exactly today\'s source registry and categories', () => {
  const result = queryResult(buildNewsSeed());
  const sources = readJson(path.join(CONFIG_DIR, 'sources.news.json')).sources;
  const byId = new Map(toSourcesConfig(result.sources).map((s) => [s.id, s]));
  assert.equal(byId.size, sources.length);
  for (const s of sources) assert.deepEqual(byId.get(s.id), s, s.id);
  const taxonomy = strip(readJson(path.join(CONFIG_DIR, 'news-taxonomy.json')));
  assert.deepEqual(toNewsTaxonomy(result), taxonomy, 'seeded categories have the default ids, so no docId is added');
});

test('cms:pull writes both files from Sanity, keeping demo sources and the help notes', async () => {
  const dir = configCopy();
  try {
    const seed = buildNewsSeed();
    reply = queryResult(seed);
    reply.sources = reply.sources.filter((s) => s.id !== 'pe-hub'); // an editor deleted one
    reply.sources[0] = { ...reply.sources[0], enabled: false, notes: 'Paused by an editor.' };
    const r = await pull(dir);
    assert.equal(r.ok, true, r.errors?.join('\n'));
    assert.equal(r.counts.sources, seed.filter((d) => d._type === 'newsSource').length - 1);
    const written = JSON.parse(readFileSync(path.join(dir, 'sources.news.json'), 'utf8'));
    assert.equal(written._generated, REGISTRY_NOTE);
    assert.ok(written._help.length > 0, 'help notes kept');
    assert.equal(written.demoSources.length, 5, 'demo sources kept');
    assert.ok(!written.sources.some((s) => s.id === 'pe-hub'));
    assert.equal(written.sources[0].notes, 'Paused by an editor.');
    assert.deepEqual(validateSources(written.sources.map(strip), 'news', { demo: false }), []);
    const taxonomy = JSON.parse(readFileSync(path.join(dir, 'news-taxonomy.json'), 'utf8'));
    assert.equal(taxonomy._generated, REGISTRY_NOTE);
    assert.deepEqual(validateNewsTaxonomy(strip(taxonomy), readJson(path.join(dir, 'taxonomy.json'))), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an invalid registry writes nothing, with every reason listed', async () => {
  const dir = configCopy();
  const before = readFileSync(path.join(dir, 'sources.news.json'), 'utf8');
  try {
    reply = queryResult(buildNewsSeed());
    reply.sources[0] = { ...reply.sources[0], licenseStatus: 'blocked', enabled: true };
    reply.capitalTypes[0] = { ...reply.capitalTypes[0], displayOrder: 5000 };
    const r = await pull(dir);
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /"blocked" must have "enabled": false/);
    assert.match(r.errors.join('\n'), /displayOrder/);
    assert.equal(readFileSync(path.join(dir, 'sources.news.json'), 'utf8'), before, 'the registry file is untouched');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty Sanity registry never replaces the files', async () => {
  const dir = configCopy();
  try {
    reply = { sources: [], capitalTypes: [], assetClasses: [] };
    const r = await pull(dir);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /no news sources/);
    assert.match(r.errors.join(' '), /no Capital Types or Asset Classes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a category created in the Studio keeps its document id, and new stories reference it', () => {
  const result = queryResult(buildNewsSeed());
  result.assetClasses.push({ _id: '3f9c2b7e-1d4a-4c55-9e0a-7b1c2d3e4f50', id: 'cold-storage', name: 'Cold Storage', displayOrder: 135, homeSection: 'none', keywords: [{ term: 'cold store', weight: 3 }] });
  const taxonomy = toNewsTaxonomy(result);
  const added = taxonomy.assetClasses.find((a) => a.id === 'cold-storage');
  assert.equal(added.docId, '3f9c2b7e-1d4a-4c55-9e0a-7b1c2d3e4f50');
  assert.equal(added.homeSection, null, '"none" means no home page box');
  assert.equal(taxonomy.assetClasses.find((a) => a.id === 'office').docId, undefined);
  assert.deepEqual(validateNewsTaxonomy(taxonomy, readJson(path.join(CONFIG_DIR, 'taxonomy.json'))), []);
  const [ref] = refsFor(buildTaxonomyIndex(taxonomy).asset, ['cold-storage']);
  assert.deepEqual(ref, { _type: 'reference', _ref: '3f9c2b7e-1d4a-4c55-9e0a-7b1c2d3e4f50', _weak: true, _key: 'cold-storage' });
});
