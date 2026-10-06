// Tests for retries, conditional requests, size limits and timeouts, against a local mock server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.FUNDSAE_ALLOW_PRIVATE_URLS = '1';
const { fetchText } = await import('../src/lib/http.js');

let server;
let base;
const hits = {};
before(async () => {
  server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    if (req.url === '/flaky') {
      if (hits[req.url] < 3) { res.writeHead(503); return res.end(); }
      res.writeHead(200, { ETag: '"v1"' }); return res.end('<rss></rss>');
    }
    if (req.url === '/missing') { res.writeHead(404); return res.end(); }
    if (req.url === '/etag') {
      if (req.headers['if-none-match'] === '"v1"') { res.writeHead(304); return res.end(); }
      res.writeHead(200, { ETag: '"v1"' }); return res.end('body');
    }
    if (req.url === '/huge') { res.writeHead(200); return res.end('x'.repeat(2000)); }
    if (req.url === '/slow') { setTimeout(() => { res.writeHead(200); res.end('late'); }, 500); return; }
    res.writeHead(500); res.end();
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const fast = { retries: 3, retryBaseDelayMs: 5, timeoutMs: 1000 };

test('retries transient 5xx errors, then succeeds', async () => {
  const res = await fetchText(`${base}/flaky`, fast);
  assert.equal(res.status, 200);
  assert.equal(hits['/flaky'], 3);
  assert.equal(res.etag, '"v1"');
});

test('does not retry permanent errors such as 404', async () => {
  await assert.rejects(fetchText(`${base}/missing`, fast), (err) => err.status === 404 && err.permanent);
  assert.equal(hits['/missing'], 1);
});

test('uses conditional requests and reports not-modified', async () => {
  const res = await fetchText(`${base}/etag`, { ...fast, etag: '"v1"' });
  assert.equal(res.notModified, true);
});

test('refuses oversized responses', async () => {
  await assert.rejects(fetchText(`${base}/huge`, { ...fast, maxResponseBytes: 1000 }), /larger than/);
});

test('times out slow servers and gives up after retries', async () => {
  await assert.rejects(fetchText(`${base}/slow`, { retries: 1, retryBaseDelayMs: 5, timeoutMs: 100 }), /Timed out/);
});
