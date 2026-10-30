// What the funds.ae server may write to Sanity for a Post a Job submission: one createIfNotExists of a
// Pending review job under a private id "jobs.<submission id>", with the submitted fields and the filer's
// contact details. Never a status other than pending_review, never approval or workflow fields, never a
// patch or delete. assertJobSubmissionMutation() throws on anything else, before it is sent.

import { JOB_ID_PATH, JOB_LIMITS, JOB_SUBMISSION_FIELDS } from './rules.js';

export class JobSubmissionMutationError extends Error {}

const SUBMISSION_ID_RE = new RegExp(`^${JOB_ID_PATH}\\.sub_[a-f0-9]{20}$`);
const FILER_FIELDS = new Set(['name', 'role', 'email', 'submittedAt', 'source']);
const ALLOWED = new Set(JOB_SUBMISSION_FIELDS);
const PAYLOAD_FIELDS = [
  'company', 'companyUrl', 'title', 'location', 'workMode', 'employmentType', 'seniority', 'department', 'regulator',
  'url', 'salaryFrom', 'salaryTo', 'salaryCurrency', 'salaryPeriod', 'visa', 'description'
];

/**
 * The Sanity document for a validated job submission (src/validation/submissions.js "job").
 * @param {object} payload  validated fields
 * @param {{id: string, now: Date}} o  id: the submission id ("sub_" + 20 hex)
 */
export function jobSubmissionDoc(payload, { id, now }) {
  const doc = { _id: `${JOB_ID_PATH}.${id}`, _type: 'jobPosting', status: 'pending_review' };
  for (const field of PAYLOAD_FIELDS) {
    const value = payload[field];
    if (value !== undefined && value !== null && value !== '') doc[field] = value;
  }
  doc.filer = { name: payload.name, email: payload.email, submittedAt: now.toISOString(), source: 'form' };
  if (payload.contactRole) doc.filer.role = payload.contactRole;
  return doc;
}

const fail = (message) => {
  throw new JobSubmissionMutationError(`Refused job submission mutation: ${message}`);
};

export function assertJobSubmissionMutation(mutation) {
  const kinds = mutation && typeof mutation === 'object' ? Object.keys(mutation) : [];
  if (kinds.length !== 1 || kinds[0] !== 'createIfNotExists') fail('only createIfNotExists is allowed.');
  const doc = mutation.createIfNotExists;
  if (!doc || typeof doc !== 'object') fail('createIfNotExists needs a document.');
  if (!SUBMISSION_ID_RE.test(doc._id || '')) fail(`"${doc._id}" is not a submission id (${JOB_ID_PATH}.sub_<20 hex>).`);
  if (doc._type !== 'jobPosting') fail('type must be jobPosting.');
  if (doc.status !== 'pending_review') fail(`a submitted job must be pending_review, not "${doc.status}".`);
  for (const key of Object.keys(doc)) if (!ALLOWED.has(key)) fail(`the server may not write "${key}".`);
  if (typeof doc.description !== 'string' || doc.description.length > JOB_LIMITS.description[1]) fail('the description is missing or too long.');
  const filer = doc.filer;
  if (!filer || typeof filer !== 'object') fail('the filer is missing.');
  for (const key of Object.keys(filer)) if (!FILER_FIELDS.has(key)) fail(`the filer may not carry "${key}".`);
  if (filer.source !== 'form') fail('a submission\'s filer source must be "form".');
  return mutation;
}
