// The Careers section from Sanity to the site: the pull reads published jobs without the filer, the public
// filter holds everything unapproved, the pipeline publishes jobs with their new fields, careers.json keeps the
// editors' order, and every posted job gets an escaped page. A mock Sanity server stands in for the real one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(tmpdir(), 'fundsae-careers-'));
process.env.FUNDSAE_API_DIR = path.join(tmp, 'api');
process.env.FUNDSAE_ALLOW_PRIVATE_URLS = '1';

const { loadAll } = await import('../src/config.js');
const { loadCareersFromSanity, CAREERS_QUERY } = await import('../src/cms/jobs.js');
const { runJobs } = await import('../src/pipeline/jobs.js');
const { publishJobs } = await import('../src/pipeline/publish.js');
const { renderJobPage, JOB_TEMPLATE, salaryText } = await import('../src/pipeline/jobPages.js');
const { createRepositories } = await import('../src/repositories/index.js');
const { JsonStore } = await import('../src/store/jsonStore.js');
const { planJobAction } = await import('../../studio/schemaTypes/jobWorkflow.js');

const NOW = new Date('2026-10-30T08:00:00Z');
const APPROVER = 'pApprover01';
const base = loadAll();
const pagesDir = path.join(tmp, 'job-pages');

const job = (id, extra = {}) => ({
  _id: id, _type: 'jobPosting', status: 'pending_review',
  title: 'Associate, Private Credit', company: 'Example Capital', location: 'DIFC, Dubai',
  url: 'https://jobs.example.com/associate', salaryFrom: 25000, salaryTo: 35000, salaryCurrency: 'AED', salaryPeriod: 'month',
  visa: 'Visa sponsorship offered', seniority: 'Associate', employmentType: 'Full-time',
  description: 'Originate and monitor direct lending deals across the GCC.\n\nYou will work with the credit committee.',
  requirements: ['Three years in credit', '<b>Strong</b> modelling'],
  ...extra
});
const publish = (doc) => {
  const plan = planJobAction('approvePublish', doc, { userId: APPROVER, userName: 'Approver', approverIds: [APPROVER], now: NOW });
  assert.ok(plan.ok, plan.reasons.join('; '));
  return { ...doc, ...plan.set };
};

// What the mock Sanity holds. The filer is on every job, so a leak would show up in the output files.
const filer = { name: 'Sara Ali', email: 'sara@example.ae', submittedAt: NOW.toISOString(), source: 'form' };
const live = publish(job('jobs.sub_aaaaaaaaaaaaaaaaaaaa', { employer: { _ref: 'employer-doc-1' }, filer }));
const studioJob = publish(job('jobs.4f1c2b9e-studio-job', { title: 'Compliance Officer <script>alert(1)</script>', company: 'Harbour Bank', salaryTo: undefined }));
const changed = { ...publish(job('jobs.sub_bbbbbbbbbbbbbbbbbbbb', { title: 'Changed After Approval Role', filer })), salaryFrom: 99000 };
const pending = job('jobs.sub_cccccccccccccccccccc', { title: 'Pending Secret Role', filer });
const rejected = { ...publish(job('jobs.sub_dddddddddddddddddddd', { title: 'Rejected Secret Role', filer })), status: 'rejected' };
let sanityDocs;
let requests = [];
let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push({ query: url.searchParams.get('query'), auth: req.headers.authorization, tag: url.searchParams.get('tag') });
    // Like Sanity with a published-status filter: published documents only (rejected/pending excluded by the query).
    const strip = ({ filer: _f, ...rest }) => rest; // the query never asks for the filer
    const result = {
      jobs: sanityDocs.jobs.filter((d) => d.status === 'published').map(strip),
      employers: sanityDocs.employers,
      careers: sanityDocs.careers
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

const env = { SANITY_PROJECT_ID: 'abc123', SANITY_DATASET: 'development', SANITY_READ_TOKEN: 'sk-read' };
const settingsWithApprover = () => {
  const settings = structuredClone(base.settings);
  settings.mode = 'live';
  settings.news.review.approverIds = [APPROVER];
  settings.jobs.source = 'sanity';
  return settings;
};

test('the pull asks only for public fields and keeps only approved, unchanged jobs, in the editors\' order', async () => {
  sanityDocs = {
    jobs: [live, studioJob, changed, pending, rejected],
    employers: [{ _id: 'employer-doc-1', name: 'Example Capital Partners', id: 'example-capital', logoRef: 'image-abc123-200x200-png', description: 'A GCC private credit manager.', website: 'https://example.com' }],
    careers: { topEmployers: ['employer-doc-1', 'employer-missing'], topJobs: ['jobs.sub_cccccccccccccccccccc', 'jobs.4f1c2b9e-studio-job', 'jobs.sub_aaaaaaaaaaaaaaaaaaaa'] }
  };
  requests = [];
  const careers = await loadCareersFromSanity({ settings: settingsWithApprover(), now: NOW, env, http: { baseUrl, retries: 0 } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].auth, 'Bearer sk-read', 'read token');
  assert.equal(requests[0].tag, 'fundsae.careers.pull');
  assert.ok(!/filer/.test(requests[0].query), 'the query never asks for the filer');
  assert.equal(requests[0].query.replace(/\s+/g, ' '), CAREERS_QUERY.replace(/\s+/g, ' '));
  assert.deepEqual(careers.listings.map((l) => l.id).sort(), ['4f1c2b9e-studio-job', 'sub_aaaaaaaaaaaaaaaaaaaa']);
  assert.deepEqual(careers.held.map((h) => h.id), ['jobs.sub_bbbbbbbbbbbbbbbbbbbb'], 'changed since approval');
  assert.deepEqual(careers.top, { employers: ['example-capital'], jobs: ['4f1c2b9e-studio-job', 'sub_aaaaaaaaaaaaaaaaaaaa'] }, 'pending and unknown picks are skipped');
  const listing = careers.listings.find((l) => l.id === 'sub_aaaaaaaaaaaaaaaaaaaa');
  assert.equal(listing.company, 'Example Capital', 'the approved company name, not the employer document name');
  assert.match(listing.logoUrl, /^https:\/\/cdn\.sanity\.io\/images\/abc123\/development\/abc123-200x200\.png/);
});

test('published jobs reach jobs.json, employers.json, careers.json and their own pages; nothing else does', async () => {
  const settings = settingsWithApprover();
  const careers = await loadCareersFromSanity({ settings, now: NOW, env, http: { baseUrl, retries: 0 } });
  const repos = createRepositories(new JsonStore(path.join(tmp, 'data')));
  const ctx = { ...base, settings, demo: false, jobSources: [], repos, now: NOW, manualJobs: careers.listings, careers };
  const result = await runJobs(ctx);
  publishJobs(ctx, result.jobs);
  const read = (file) => JSON.parse(readFileSync(path.join(process.env.FUNDSAE_API_DIR, file), 'utf8'));
  const jobs = read('jobs.json').items;
  assert.equal(jobs.length, 2);
  const credit = jobs.find((j) => j.company === 'Example Capital');
  assert.deepEqual(credit.salary, { from: 25000, to: 35000, currency: 'AED', period: 'month' });
  assert.equal(credit.visa, 'Visa sponsorship offered');
  assert.equal(credit.seniority, 'Associate');
  assert.match(credit.slug, /^associate-private-credit-example-capital-[0-9a-f]{4}$/);
  assert.match(credit.logoUrl, /^https:\/\/cdn\.sanity\.io\//);
  const employer = read('employers.json').items.find((e) => e.id === credit.employerId);
  assert.equal(employer.description, 'A GCC private credit manager.');
  assert.equal(employer.website, 'https://example.com');
  const top = read('careers.json');
  assert.deepEqual(top.topEmployers, [employer.id]);
  assert.deepEqual(top.topJobs, [jobs.find((j) => j.company === 'Harbour Bank').id, credit.id], 'the editors\' order');

  // Job pages: one per posted job, escaped, with the apply link.
  const pages = readdirSync(pagesDir);
  assert.equal(pages.length, 2);
  const harbour = readFileSync(path.join(pagesDir, `${jobs.find((j) => j.company === 'Harbour Bank').slug}.html`), 'utf8');
  assert.ok(!harbour.includes('<script>alert(1)</script>') && harbour.includes('Compliance Officer'), 'markup in a title never reaches the page');
  const creditPage = readFileSync(path.join(pagesDir, `${credit.slug}.html`), 'utf8');
  assert.ok(creditPage.includes('&lt;b&gt;Strong&lt;/b&gt; modelling'), 'requirements are escaped');
  assert.ok(creditPage.includes('<p>You will work with the credit committee.</p>'), 'paragraphs');
  assert.ok(creditPage.includes('href="https://jobs.example.com/associate" target="_blank" rel="noopener noreferrer"'));
  assert.ok(creditPage.includes('AED 25,000–35,000 / month'));

  // No filer details and no unpublished job anywhere in what was written.
  const everything = [process.env.FUNDSAE_API_DIR, pagesDir, path.join(tmp, 'data')]
    .flatMap((dir) => readdirSync(dir, { recursive: true }).map((f) => path.join(dir, String(f))))
    .filter((f) => existsSync(f) && /\.(json|html)$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  for (const secret of ['sara@example.ae', 'Sara Ali', 'Pending Secret Role', 'Rejected Secret Role', 'Changed After Approval Role']) {
    assert.ok(!everything.includes(secret), `${secret} must not be published`);
  }

  // A job taken down in Sanity disappears with its page on the next run.
  const after = { ...careers, listings: careers.listings.filter((l) => l.company !== 'Harbour Bank'), top: { employers: [], jobs: [] } };
  const ctx2 = { ...ctx, manualJobs: after.listings, careers: after };
  const second = await runJobs(ctx2);
  publishJobs(ctx2, second.jobs);
  assert.equal(read('jobs.json').items.length, 1);
  assert.equal(readdirSync(pagesDir).length, 1, 'its page is removed');
  assert.deepEqual(read('careers.json').topJobs, [], 'empty lists mean automatic order on the page');
});

test('job pages refuse a job without a valid slug or https apply link, and never delete hand-made files', () => {
  const template = readFileSync(JOB_TEMPLATE, 'utf8');
  const record = { jobId: 'j_1', title: 'Analyst', company: 'X Capital', location: 'Dubai', url: 'https://x.example/apply', slug: 'analyst-x', description: 'Some description text here.' };
  assert.doesNotThrow(() => renderJobPage(record, { template }));
  assert.throws(() => renderJobPage({ ...record, slug: '../evil' }, { template }), /slug/);
  assert.throws(() => renderJobPage({ ...record, url: 'javascript:alert(1)' }, { template }), /apply link/);
  assert.equal(salaryText({ from: 18000, to: null, currency: 'USD', period: 'year' }), 'USD 18,000 / year');
  mkdirSync(pagesDir, { recursive: true });
  writeFileSync(path.join(pagesDir, 'hand-made.html'), '<!DOCTYPE html><p>Not generated</p>');
  return import('../src/pipeline/jobPages.js').then(({ writeJobPages }) => {
    writeJobPages([], { dir: pagesDir });
    assert.ok(existsSync(path.join(pagesDir, 'hand-made.html')));
  });
});
