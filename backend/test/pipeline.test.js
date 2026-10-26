// End-to-end test: runs the real CLI in demo mode into temporary folders. Demo stories go
// through the review queue like live ones; fixtures/news/demo-decisions.json plays the editor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'fundsae-'));
const env = { ...process.env, FUNDSAE_MODE: 'demo', FUNDSAE_DATA_DIR: path.join(tmp, 'data'), FUNDSAE_API_DIR: path.join(tmp, 'api'), GITHUB_ACTIONS: '' };
const run = (cmd) => execFileSync(process.execPath, ['src/cli.js', cmd], { cwd: backend, env, encoding: 'utf8' });
const api = (file) => JSON.parse(readFileSync(path.join(tmp, 'api', file), 'utf8'));
const queue = () => JSON.parse(readFileSync(path.join(tmp, 'data', 'demo', 'news-review.json'), 'utf8')).docs;
/** Every file written under the temporary api/ folder, as one string. */
function allApiText(dir = path.join(tmp, 'api')) {
  return readdirSync(dir).map((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? allApiText(p) : readFileSync(p, 'utf8');
  }).join(' ');
}

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
    const urls = queue().flatMap((d) => [d.canonicalUrl, ...d.otherSources.map((o) => o.canonicalUrl)]);
    assert.equal(new Set(urls).size, urls.length, 'no duplicate canonical URLs');
  });

  await t.test('stores every required field in the review queue', () => {
    for (const d of queue()) {
      for (const f of ['_id', 'articleId', 'storyId', 'originalHeadline', 'originalUrl', 'sourceName', 'sourcePublishedAt', 'importedAt', 'category', 'topic', 'headline', 'status', 'classification']) {
        assert.ok(d[f] !== undefined && d[f] !== '', `${f} missing on ${d._id}`);
      }
      assert.match(d._id, /^queue[.]a_[0-9a-f]{16}$/);
      assert.ok((d.excerpt || '').length <= 280, 'excerpt only, never full text');
      assert.ok((d.summary || '').length <= 280);
    }
  });

  await t.test('only stories the editor published reach the site', () => {
    const docs = queue();
    const byStatus = (s) => docs.filter((d) => d.status === s);
    assert.equal(byStatus('published').length, 22);
    assert.equal(byStatus('pending_review').length, 2);
    assert.equal(byStatus('rejected').length, 1);
    assert.equal(news.count, 22);
    // Story pages follow the API folder in tests (config.js STORY_PAGES_DIR), never the real site.
    const pagesDir = path.join(tmp, 'story-pages');
    for (const s of news.items) assert.ok(readFileSync(path.join(pagesDir, `${s.slug}.html`), 'utf8').includes(s.url), `page for ${s.id}`);
    assert.equal(readdirSync(pagesDir).length, news.count, 'one page per published story');
    const text = allApiText() + allApiText(pagesDir);
    for (const d of [...byStatus('pending_review'), ...byStatus('rejected')]) {
      assert.ok(!text.includes(d.headline), `not public: ${d._id}`);
      assert.ok(!text.includes(d.storyId), `no trace of ${d._id}`);
    }
    assert.ok(news.items.every((s) => docs.find((d) => d.storyId === s.id)?.status === 'published'));
  });

  await t.test('splits UAE and Rest of the World', () => {
    assert.ok(api('news/uae.json').items.every((s) => s.category === 'uae'));
    assert.ok(api('news/world.json').items.every((s) => s.category === 'world'));
    const northlight = news.items.find((s) => /Northlight/.test(s.headline));
    assert.equal(northlight.category, 'world', 'a passing mention of Abu Dhabi does not make a story UAE news');
  });

  await t.test('is idempotent: a second run adds nothing and keeps every decision', () => {
    const before = queue();
    run('news');
    const after = queue();
    assert.equal(after.length, before.length);
    for (const doc of before) {
      const again = after.find((d) => d._id === doc._id);
      for (const f of ['status', 'headline', 'summary', 'approval', 'capitalTypes', 'assetClasses', 'publishedAt']) {
        assert.deepEqual(again[f], doc[f], `${doc._id}.${f} unchanged`);
      }
    }
    assert.equal(api('news.json').count, 22);
  });

  await t.test('news:publish republishes the same stories and never writes to the queue', () => {
    const before = readFileSync(path.join(tmp, 'data', 'demo', 'news-review.json'), 'utf8');
    run('news:publish');
    assert.equal(readFileSync(path.join(tmp, 'data', 'demo', 'news-review.json'), 'utf8'), before);
    assert.equal(api('news.json').count, 22);
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
    assert.deepEqual(sponsors.slots.founding, [], 'no founding sponsor yet, so the home banner shows its own advert');
    assert.ok(sponsors.slots.careerResources.every((i) => i.sponsored === false));
    assert.ok(sponsors.slots.gold.every((i) => i.sponsored === true && i.url === null));
    assert.ok(api('sources.json').items.every((s) => s.status === 'ok' || s.status === 'disabled'));
    assert.equal(api('meta.json').lastRun.status, 'ok');
  });

  rmSync(tmp, { recursive: true, force: true });
});
