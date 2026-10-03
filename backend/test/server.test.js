// The optional server: read API, website hosting, forms and admin, including the
// security behaviour (validation, origins, limits, headers, path traversal).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server/index.js';
import { dubaiToday } from '../src/server/handlers/read.js';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'fundsae-server-'));
const apiDir = path.join(tmp, 'api');
const ADMIN = 'a'.repeat(40);
const servers = [];
let base;
let dataDir;

async function start(env, name) {
  const dir = path.join(tmp, name);
  const server = createServer({ apiDir, dataDir: dir, env });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${server.address().port}`, dir };
}

before(async () => {
  const env = { ...process.env, FUNDSAE_MODE: 'demo', FUNDSAE_DATA_DIR: path.join(tmp, 'data'), FUNDSAE_API_DIR: apiDir, GITHUB_ACTIONS: '' };
  execFileSync(process.execPath, ['src/cli.js', 'all'], { cwd: backend, env, encoding: 'utf8' });
  const main = await start({ ALLOWED_ORIGINS: 'https://funds.example', ADMIN_API_TOKEN: ADMIN, WRITE_RATE_LIMIT_PER_MIN: '1000', WRITE_RATE_LIMIT_PER_HOUR: '1000' }, 'main');
  base = main.url;
  dataDir = main.dir;
});
after(() => {
  servers.forEach((s) => s.close());
  rmSync(tmp, { recursive: true, force: true });
});

const get = (p, init) => fetch(base + p, { redirect: 'manual', ...init });
const json = async (p, init) => {
  const res = await get(p, init);
  return { res, body: await res.json() };
};
const post = (kind, body, headers = {}, url = base) => fetch(`${url}/api/v1/submissions/${kind}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});
const contact = { name: 'Aisha Rahman', email: 'aisha@example.ae', subject: 'Hello', message: 'A message long enough to pass.' };
const stored = (kind, dir = dataDir) => {
  const file = path.join(dir, 'submissions', `${kind}.jsonl`);
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

/* ----------------------------------- reads ---------------------------------- */

test('news filters, paging and validation', async () => {
  const uae = await json('/api/v1/news?category=uae&limit=3');
  assert.equal(uae.res.status, 200);
  assert.equal(uae.body.limit, 3);
  assert.ok(uae.body.items.length <= 3 && uae.body.items.every((s) => s.category === 'uae'));
  assert.ok(uae.body.total >= uae.body.items.length);

  const grants = await json('/api/v1/news?section=grants-funding');
  assert.ok(grants.body.items.length > 0 && grants.body.items.every((s) => s.category === 'uae'));

  for (const bad of ['category=mars', 'topic=nope', 'section=nope', 'limit=0', 'limit=101', 'offset=-1', `q=${'x'.repeat(101)}`, 'foo=1']) {
    const r = await json(`/api/v1/news?${bad}`);
    assert.equal(r.res.status, 400, bad);
    assert.equal(r.body.error.code, 'bad_request');
  }
  const id = uae.body.items[0].id;
  assert.equal((await json(`/api/v1/news/${id}`)).body.id, id);
  assert.equal((await get('/api/v1/news/not-an-id')).status, 400);
  assert.equal((await get('/api/v1/news/s_00000000000000')).status, 404);
});

test('jobs by employer, events by status, and the static file names', async () => {
  const all = (await json('/api/v1/jobs?limit=100')).body.items;
  const employerId = all[0].employerId;
  const mine = (await json(`/api/v1/jobs?employer=${employerId}`)).body.items;
  assert.ok(mine.length >= 1 && mine.every((j) => j.employerId === employerId));
  assert.equal((await get('/api/v1/jobs?employer=emp_zzz')).status, 400);

  const today = dubaiToday();
  const upcoming = (await json('/api/v1/events?status=upcoming&limit=100')).body.items;
  assert.ok(upcoming.length > 0 && upcoming.every((e) => (e.endDate || e.startDate) >= today));
  const past = (await json('/api/v1/events?status=past')).body.items;
  assert.ok(past.every((e) => (e.endDate || e.startDate) < today));

  for (const f of ['news.json', 'news/uae.json', 'news/topics/private-credit.json', 'news/sections/real-estate-infrastructure.json', 'news/sections/energy.json', 'news/sections/ai-technology.json', 'employers.json', 'events.json', 'sponsors.json']) {
    assert.equal((await get(`/api/v1/${f}?v=abc123`)).status, 200, f);
  }
});

test('meta says forms work here, ETags and HEAD work, and unknown methods are refused', async () => {
  const { res, body } = await json('/api/v1/meta.json');
  assert.equal(body.capabilities.submissions, true);
  assert.equal((await get('/api/v1/meta.json', { headers: { 'if-none-match': res.headers.get('etag') } })).status, 304);
  const head = await get('/api/v1/news.json', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const put = await get('/api/v1/news', { method: 'PUT' });
  assert.equal(put.status, 405);
  assert.match(put.headers.get('allow'), /GET/);
  assert.equal((await get('/api/v1/submissions/contact')).status, 405);
});

test('API responses carry security headers and read CORS', async () => {
  const res = await get('/api/v1/news', { headers: { origin: 'https://funds.example' } });
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://funds.example');
  const other = await get('/api/v1/news', { headers: { origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

/* ---------------------------------- website --------------------------------- */

test('the website is served, and nothing outside it is', async () => {
  const root = await get('/');
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/frontend_demo/this.html');
  const page = await get('/frontend_demo/Contact.dc.html');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal((await get('/js/fundsae-api.js')).status, 200);
  assert.equal((await get('/i18n.js')).status, 200);
  for (const p of [
    '/backend/config/settings.json', '/admin/index.html', '/.github/workflows/tests.yml', '/frontend_demo/',
    '/frontend_demo/..%2f..%2fbackend/config/settings.json', '/frontend_demo/%2e%2e/backend/package.json',
    '/js/..%5c..%5cbackend%5cpackage.json', '/js/.hidden.js', '/frontend_demo/this.html%00.png', '/js/C:%5cWindows%5cwin.ini'
  ]) {
    assert.equal((await get(p)).status, 404, p);
  }
});

/* ----------------------------------- forms ---------------------------------- */

test('a valid contact form is stored with a hashed IP and nothing is echoed back', async () => {
  const res = await post('contact', contact, { 'user-agent': 'x'.repeat(500) });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.deepEqual(body, { ok: true, status: 'received', mode: 'demo' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const [record] = stored('contact').slice(-1);
  assert.equal(record.payload.email, 'aisha@example.ae');
  assert.equal(record.status, 'new');
  assert.match(record.ipHash, /^[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(record).includes('127.0.0.1'), false, 'raw IP never stored');
  assert.equal(record.userAgent.length, 200);
});

test('bad form input is refused with a reason per field', async () => {
  const bad = await post('contact', { name: 'A', email: 'nope', subject: 'Hi', message: 'short', admin: true });
  assert.equal(bad.status, 400);
  const { error } = await bad.json();
  assert.equal(error.code, 'validation_failed');
  assert.deepEqual(Object.keys(error.fields).sort(), ['admin', 'email', 'message', 'name']);
  assert.equal((await post('contact', 'not json')).status, 400);
  assert.equal((await post('contact', contact, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('contact', { ...contact, message: 'x'.repeat(20_000) })).status, 413);
  assert.equal((await post('nope', contact)).status, 404);
});

test('forms from other sites are refused; this site and listed origins are accepted', async () => {
  const before = stored('contact').length;
  assert.equal((await post('contact', contact, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('contact', contact, { origin: 'null' })).status, 403);
  assert.equal(stored('contact').length, before);
  assert.equal((await post('contact', contact, { origin: base })).status, 202);
  assert.equal((await post('contact', contact, { origin: 'https://funds.example' })).status, 202);
  const preflight = await fetch(`${base}/api/v1/submissions/contact`, { method: 'OPTIONS', headers: { origin: 'https://funds.example' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://funds.example');
  const evil = await fetch(`${base}/api/v1/submissions/contact`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
});

test('the honeypot is silently dropped and newsletter sign-ups are stored once', async () => {
  const before = stored('contact').length;
  assert.equal((await post('contact', { ...contact, website: 'https://spam.example' })).status, 202);
  assert.equal(stored('contact').length, before);
  const first = await post('newsletter', { email: 'Reader@Example.ae', placement: 'home' });
  const again = await post('newsletter', { email: 'reader@example.ae', placement: 'careers' });
  assert.equal(first.status, 202);
  assert.equal(again.status, 202);
  assert.deepEqual(await first.json(), await again.json(), 'same answer, so subscribers cannot be probed');
  assert.equal(stored('newsletter').filter((r) => r.email.toLowerCase() === 'reader@example.ae').length, 1);
});

test('event and job suggestions wait for review', async () => {
  const ev = { title: 'Investor Breakfast', eventType: 'Networking', startDate: dubaiToday(), city: 'Dubai', organiser: 'Example Events', email: 'e@example.com' };
  assert.equal((await post('event', ev)).status, 202);
  assert.equal(stored('event').slice(-1)[0].status, 'pending-review');
  const job = { title: 'Analyst', company: 'Example Capital', location: 'Dubai', url: 'https://jobs.example.com/1', email: 'hr@example.com' };
  assert.equal((await post('job', job)).status, 202);
  assert.equal(stored('job').slice(-1)[0].status, 'pending-review');
});

test('forms are rate limited per client', async () => {
  const limited = await start({ WRITE_RATE_LIMIT_PER_MIN: '2', WRITE_RATE_LIMIT_PER_HOUR: '100' }, 'limited');
  assert.equal((await post('contact', contact, {}, limited.url)).status, 202);
  assert.equal((await post('contact', contact, {}, limited.url)).status, 202);
  const third = await post('contact', contact, {}, limited.url);
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get('retry-after')) >= 1);
});

test('forms can be switched off', async () => {
  const off = await start({ SUBMISSIONS_ENABLED: 'false' }, 'off');
  assert.equal((await (await fetch(`${off.url}/api/v1/meta`)).json()).capabilities.submissions, false);
  const res = await post('contact', contact, {}, off.url);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'submissions_disabled');
});

/* ----------------------------------- admin ---------------------------------- */

test('the admin listing needs the token, and is off without one', async () => {
  assert.equal((await get('/api/v1/admin/submissions?kind=contact')).status, 401);
  assert.equal((await get('/api/v1/admin/submissions?kind=contact', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  const ok = await json('/api/v1/admin/submissions?kind=contact&limit=5', { headers: { authorization: `Bearer ${ADMIN}` } });
  assert.equal(ok.res.status, 200);
  assert.ok(ok.body.items.length > 0 && ok.body.items.length <= 5);
  assert.equal(ok.res.headers.get('cache-control'), 'no-store, private');
  assert.equal(ok.res.headers.get('access-control-allow-origin'), null);
  assert.equal((await get('/api/v1/admin/submissions?kind=secrets', { headers: { authorization: `Bearer ${ADMIN}` } })).status, 400);
  const noToken = await start({ ADMIN_API_TOKEN: 'too-short' }, 'noadmin');
  assert.equal((await fetch(`${noToken.url}/api/v1/admin/submissions?kind=contact`, { headers: { authorization: 'Bearer too-short' } })).status, 404);
});
