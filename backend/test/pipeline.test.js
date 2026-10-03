// End-to-end test: runs the real CLI in demo mode into temporary folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'fundsae-'));
const env = { ...process.env, FUNDSAE_MODE: 'demo', FUNDSAE_DATA_DIR: path.join(tmp, 'data'), FUNDSAE_API_DIR: path.join(tmp, 'api'), GITHUB_ACTIONS: '' };
const run = (cmd) => execFileSync(process.execPath, ['src/cli.js', cmd], { cwd: backend, env, encoding: 'utf8' });
const api = (file) => JSON.parse(readFileSync(path.join(tmp, 'api', file), 'utf8'));
const db = () => JSON.parse(readFileSync(path.join(tmp, 'data', 'demo', 'news-db.json'), 'utf8'));

test('demo pipeline end to end', async (t) => {
  run('all');
  const news = api('news.json');

  await t.test('publishes grouped stories with every original link', () => {
    assert.equal(news.mode, 'demo');
    const qirsh = news.items.filter((s) => /qirsh/i.test(s.headline));
    assert.equal(qirsh.length, 1, 'three reports of the Qirsh round become one story');
    assert.equal(qirsh[0].sourceCount, 3);
    assert.ok(qirsh[0].sources.every((s) => s.url.startsWith('https://')));
    const falcon = news.items.filter((s) => /falcon ridge/i.test(s.headline));
    assert.equal(falcon.length, 1);
    assert.equal(falcon[0].sourceCount, 3);
  });

  await t.test('removes duplicates, opinion, adverts, podcasts, off-topic and stale items', () => {
    const headlines = news.items.flatMap((s) => s.sources.map((x) => x.title)).join('\n');
    for (const banned of ['Opinion:', 'Sponsored:', 'football', 'Podcast:', 'gadgets', 'Weather:', 'J-curve', 'fund of funds']) {
      assert.ok(!headlines.includes(banned), `should not publish: ${banned}`);
    }
    const urls = db().articles.map((a) => a.canonicalUrl);
    assert.equal(new Set(urls).size, urls.length, 'no duplicate canonical URLs');
  });

  await t.test('stores every required field', () => {
    for (const a of db().articles) {
      for (const f of ['articleId', 'title', 'sourceName', 'originalUrl', 'publishedAt', 'category', 'topic', 'storyId', 'ingestedAt']) {
        assert.ok(a[f], `${f} missing on ${a.articleId}`);
      }
      assert.ok('summary' in a && 'imageUrl' in a);
      assert.ok(a.summary.length <= 280, 'excerpt only, never full text');
    }
  });

  await t.test('splits UAE and Rest of the World', () => {
    assert.ok(api('news/uae.json').items.every((s) => s.category === 'uae'));
    assert.ok(api('news/world.json').items.every((s) => s.category === 'world'));
    const northlight = news.items.find((s) => /Northlight/.test(s.headline));
    assert.equal(northlight.category, 'world', 'a passing mention of Abu Dhabi does not make a story UAE news');
  });

  await t.test('is idempotent: a second run adds nothing', () => {
    const before = db().articles.length;
    run('news');
    assert.equal(db().articles.length, before);
  });

  await t.test('publishes UAE finance jobs only, featured first', () => {
    const jobs = api('jobs.json').items;
    assert.ok(jobs.length >= 8);
    assert.equal(jobs[0].featured, true);
    assert.ok(!jobs.some((j) => /London|Singapore|Riyadh/.test(j.location)));
    assert.ok(!jobs.some((j) => /Chef|Engineer|Port Operations/.test(j.title)));
  });

  await t.test('publishes sponsors and health', () => {
    const sponsors = api('sponsors.json');
    assert.equal(sponsors.slots.sponsoredPosts.length, 20);
    assert.equal(sponsors.slots.platinum.length, 5);
    assert.ok(sponsors.slots.careerResources.every((i) => i.sponsored === false));
    assert.ok(sponsors.slots.gold.every((i) => i.sponsored === true && i.url === null));
    assert.ok(api('sources.json').items.every((s) => s.status === 'ok' || s.status === 'disabled'));
    assert.equal(api('meta.json').lastRun.status, 'ok');
  });

  rmSync(tmp, { recursive: true, force: true });
});
