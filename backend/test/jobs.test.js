// Posted jobs in Sanity (docs/SANITY-CMS-GUIDE.md "Careers"): the Studio's and the backend's rules agree, only
// approvers can publish, the public filter holds everything else back and strips the filer's contact details,
// and the submissions server can only create Pending review jobs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const studioRules = await import('../../studio/schemaTypes/jobRules.js');
const studioWorkflow = await import('../../studio/schemaTypes/jobWorkflow.js');
const backendRules = await import('../src/jobs/rules.js');
const backendWorkflow = await import('../src/jobs/workflow.js');
const { jobHoldReasons, selectPublicJobs, toPublicJob } = await import('../src/jobs/publicFilter.js');
const { jobSubmissionDoc, assertJobSubmissionMutation } = await import('../src/jobs/submissionMutations.js');
const { EMPLOYMENT_TYPES } = await import('../src/contracts/models.js');
const { JOB_FORM_OPTIONS } = await import('../src/validation/submissions.js');

const NOW = new Date('2026-10-30T08:00:00Z');
const APPROVER = 'pApprover01';

const baseJob = () => ({
  _id: 'jobs.sub_0123456789abcdef0123', _type: 'jobPosting', status: 'pending_review',
  title: 'Associate, Private Credit', company: 'Example Capital', location: 'DIFC, Dubai',
  url: 'https://jobs.example.com/associate', salaryFrom: 25000, salaryTo: 35000, salaryCurrency: 'AED', salaryPeriod: 'month',
  visa: 'Visa sponsorship offered', seniority: 'Associate', department: 'Private Credit and Lending', employmentType: 'Full-time',
  description: 'Originate, structure and monitor direct lending transactions across the GCC with a growing team.',
  requirements: ['Three years in credit or leveraged finance', 'Strong financial modelling'],
  filer: { name: 'Sara Ali', email: 'sara@example.ae', submittedAt: NOW.toISOString(), source: 'form' }
});
const approve = (doc) => studioWorkflow.planJobAction('approvePublish', doc, { userId: APPROVER, userName: 'Approver', approverIds: [APPROVER], now: NOW });
const published = (doc = baseJob()) => {
  const plan = approve(doc);
  assert.ok(plan.ok, plan.reasons.join('; '));
  return { ...doc, ...plan.set };
};

test('the Studio and the backend use the same job rules, and the form uses the same choices', () => {
  assert.deepEqual(Object.keys(backendRules).sort(), Object.keys(studioRules).sort());
  for (const key of Object.keys(studioRules)) assert.deepEqual(backendRules[key], studioRules[key], `${key} differs`);
  assert.deepEqual(backendRules.JOB_EMPLOYMENT_TYPES, EMPLOYMENT_TYPES, 'job types equal the API contract');
  assert.deepEqual(JOB_FORM_OPTIONS, backendRules.JOB_FORM_OPTIONS);
  for (const action of Object.values(backendRules.JOB_ACTIONS)) {
    for (const status of [...action.from, action.to]) assert.ok(backendRules.JOB_STATUSES.includes(status), `${action.label}: ${status}`);
  }
});

test('the Studio and the backend agree on the approval hash, the publish checks and the slug', () => {
  const docs = [baseJob(), published(), { ...baseJob(), salaryTo: 1000 }, { ...baseJob(), url: 'http://x.example', visa: 'Maybe' },
    { ...baseJob(), title: 'Ünïcödé Analyst', requirements: ['  spaced  '], employer: { _ref: 'employer-example' } }, {}];
  for (const doc of docs) {
    assert.equal(backendWorkflow.jobApprovalHash(doc), studioWorkflow.jobApprovalHash(doc));
    assert.deepEqual(backendWorkflow.jobPublishBlockers(doc, { now: NOW }), studioWorkflow.jobPublishBlockers(doc, { now: NOW }));
    assert.equal(backendWorkflow.suggestJobSlug(doc), studioWorkflow.suggestJobSlug(doc));
  }
  assert.match(studioWorkflow.suggestJobSlug(baseJob()), /^associate-private-credit-example-capital-[0-9a-f]{4}$/);
  const hash = backendWorkflow.jobApprovalHash;
  assert.notEqual(hash(baseJob()), hash({ ...baseJob(), salaryFrom: 26000 }), 'a salary change changes the hash');
  assert.equal(hash(baseJob()), hash({ ...baseJob(), filer: { name: 'Someone else' }, status: 'published' }), 'filer and status do not');
});

test('only an approver can publish; reject needs a reason; unpublish and archive drop the approval', () => {
  const doc = baseJob();
  assert.equal(studioWorkflow.planJobAction('approvePublish', doc, { userId: 'someone', approverIds: [APPROVER], now: NOW }).ok, false);
  assert.equal(studioWorkflow.planJobAction('approvePublish', doc, { userId: APPROVER, approverIds: [], now: NOW }).ok, false, 'no approvers: nobody publishes');
  const plan = approve(doc);
  assert.equal(plan.set.status, 'published');
  assert.match(plan.set.slug.current, /^associate-private-credit/);
  assert.equal(plan.set.expiresAt.slice(0, 10), '2026-12-29', 'live for 60 days unless an expiry is set');
  assert.equal(plan.set.approval.approvedById, APPROVER);
  const missing = approve({ ...doc, description: 'Too short' });
  assert.equal(missing.ok, false);
  assert.ok(missing.reasons.some((r) => /description/.test(r)));
  assert.equal(studioWorkflow.planJobAction('reject', doc, { reason: 'no' }).ok, false);
  const rejected = studioWorkflow.planJobAction('reject', published(), { reason: 'Agency repost', now: NOW });
  assert.equal(rejected.set.status, 'rejected');
  assert.ok(rejected.unset.includes('approval'));
  assert.ok(studioWorkflow.planJobAction('unpublish', published(), { now: NOW }).unset.includes('approval'));
  assert.equal(studioWorkflow.planJobAction('unpublish', doc, { now: NOW }).ok, false, 'only a live job can be unpublished');
  const save = studioWorkflow.planJobSave({ ...published(), salaryFrom: 27000 }, { userId: 'someone', approverIds: [APPROVER], now: NOW });
  assert.equal(save.ok, false, 'only an approver can change a live job');
});

test('only published, approved, unchanged and unexpired jobs are public, without the filer', () => {
  const ctx = { now: NOW, approverIds: [APPROVER] };
  const live = published();
  assert.deepEqual(jobHoldReasons(live, ctx), []);
  const cases = {
    pending: baseJob(),
    rejected: { ...live, status: 'rejected' },
    archived: { ...live, status: 'archived' },
    draft: { ...live, _id: 'drafts.jobs.sub_0123456789abcdef0123' },
    changed: { ...live, salaryFrom: 99000 },
    stranger: { ...live, approval: { ...live.approval, approvedById: 'pStranger' } },
    forged: { ...baseJob(), status: 'published' },
    expired: { ...live, expiresAt: '2026-10-01T00:00:00Z' }
  };
  for (const [name, doc] of Object.entries(cases)) assert.ok(jobHoldReasons(doc, ctx).length > 0, name);
  assert.ok(jobHoldReasons(live, { now: NOW, approverIds: [] }).length > 0, 'no approvers: nothing is public');
  const { jobs, held } = selectPublicJobs([live, cases.pending, cases.changed], ctx);
  assert.equal(jobs.length, 1);
  assert.deepEqual(held.map((h) => h.id), [cases.pending._id, cases.changed._id]);
  assert.ok(!JSON.stringify(held).includes('Example Capital'), 'held jobs are reported by id only');
  const employers = new Map([['employer-example', { id: 'example-capital', name: 'Example Capital Partners', logoUrl: 'https://cdn.sanity.io/x.png', website: 'https://example.com' }]]);
  const listing = toPublicJob({ ...live, employer: { _ref: 'employer-example' } }, employers);
  assert.equal(listing.id, 'sub_0123456789abcdef0123');
  assert.equal(listing.company, 'Example Capital Partners', 'the employer document names the company');
  assert.equal(listing.logoUrl, 'https://cdn.sanity.io/x.png');
  assert.deepEqual(listing.salary, { from: 25000, to: 35000, currency: 'AED', period: 'month' });
  assert.ok(!JSON.stringify(listing).includes('sara@example.ae') && !JSON.stringify(listing).includes('Sara Ali'), 'no filer details');
});

test('the submissions server can only create a Pending review job', () => {
  const payload = {
    company: 'Example Capital', title: 'Analyst', location: 'Dubai', url: 'https://jobs.example.com/1', salaryFrom: 18000, salaryTo: null,
    salaryCurrency: 'AED', salaryPeriod: 'month', visa: 'Must hold own UAE visa', name: 'Omar Haddad', contactRole: null,
    description: 'Support the investment team with models, research and portfolio reporting.', email: 'omar@example.ae', website: null
  };
  const doc = jobSubmissionDoc(payload, { id: 'sub_0123456789abcdef0123', now: NOW });
  assert.equal(doc._id, 'jobs.sub_0123456789abcdef0123');
  assert.equal(doc.status, 'pending_review');
  assert.equal(doc.salaryTo, undefined, 'empty optional fields are left out');
  assert.deepEqual(Object.keys(doc.filer).sort(), ['email', 'name', 'source', 'submittedAt']);
  assert.doesNotThrow(() => assertJobSubmissionMutation({ createIfNotExists: doc }));
  const refused = [
    { create: doc },
    { createOrReplace: doc },
    { patch: { id: doc._id, set: { status: 'published' } } },
    { createIfNotExists: { ...doc, status: 'published' } },
    { createIfNotExists: { ...doc, approval: { approvedById: 'x' } } },
    { createIfNotExists: { ...doc, _id: 'jobs.anything' } },
    { createIfNotExists: { ...doc, _id: 'sub_0123456789abcdef0123' } },
    { createIfNotExists: { ...doc, filer: { ...doc.filer, source: 'studio' } } },
    { createIfNotExists: { ...doc, filer: { ...doc.filer, ip: '1.2.3.4' } } },
    { createIfNotExists: { ...doc, description: 'x'.repeat(5001) } }
  ];
  for (const m of refused) assert.throws(() => assertJobSubmissionMutation(m), /Refused job submission mutation/, JSON.stringify(m).slice(0, 80));
});
