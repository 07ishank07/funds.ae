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
import { DB_MODELS, DTO_FIELDS, ENVELOPE_FIELDS, SPONSOR_SLOTS, SUBMISSION_KINDS } from '../src/contracts/models.js';
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
  const files = ['meta.json', 'news.json', 'jobs.json', 'employers.json', 'events.json', 'sponsors.json', 'sources.json', 'taxonomy.json'];
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
  check('news.json', 'story', (s) => s.sources.forEach((src) => sameKeys(src, DTO_FIELDS.storySource, 'story source')));
  check('jobs.json', 'job', (j) => assert.match(j.employerId, /^emp_[a-f0-9]{16}$/));
  check('employers.json', 'employer');
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

test('meta.json advertises versions, capabilities and every endpoint that exists', () => {
  const meta = api('meta.json');
  assert.deepEqual(Object.keys(meta.versions).sort(), ['employers', 'events', 'jobs', 'news', 'sponsors']);
  assert.deepEqual(meta.capabilities, { submissions: false }, 'static hosting cannot take forms');
  const taxonomy = api('taxonomy.json');
  for (const t of taxonomy.topics) assert.ok(existsSync(path.join(apiDir, 'news', 'topics', `${t.id}.json`)), t.id);
  for (const s of taxonomy.sections) assert.ok(existsSync(path.join(apiDir, 'news', 'sections', `${s.id}.json`)), s.id);
  for (const c of taxonomy.categories) assert.ok(existsSync(path.join(apiDir, 'news', `${c.id}.json`)), c.id);
  for (const file of [meta.endpoints.jobs, meta.endpoints.employers, meta.endpoints.events, meta.endpoints.sponsors]) {
    assert.ok(existsSync(path.join(apiDir, file)), file);
  }
  const sectionIds = taxonomy.sections.map((s) => s.id);
  for (const id of ['real-estate-infrastructure', 'energy', 'ai-technology']) assert.ok(sectionIds.includes(id), `section ${id}`);
  const grants = api('news/sections/grants-funding.json');
  assert.ok(grants.items.length > 0);
  assert.ok(grants.items.every((s) => s.category === 'uae' && s.topics.includes('grants-funding')));
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
  }
});

test('the JSON store holds no fields the schema does not know about', () => {
  const allowed = (model) => new Set([...DB_MODELS[model].fields, ...Object.keys(DB_MODELS[model].derived || {})]);
  const check = (records, model) => {
    const ok = allowed(model);
    for (const r of records) for (const k of Object.keys(r)) assert.ok(ok.has(k), `${model} record has unmapped field "${k}"`);
  };
  const news = data('news-db.json');
  check(news.articles, 'articles');
  check(news.stories, 'stories');
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
