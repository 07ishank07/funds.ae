// The only rule for which posted jobs reach the public site. The Sanity query already asks for published jobs,
// but every job is checked again here, in code the submissions server and the Studio cannot change:
//   - a "jobs.<id>" document with status "published";
//   - approved by a Sanity user id listed in settings.json news.review.approverIds (the review approvers);
//   - the content still matches the approval (approval.contentHash);
//   - every publish check passes and the expiry date has not passed (src/jobs/workflow.js).
// A job that fails is held back and reported by id only (the reasons end up in public run history).
// toPublicJob() keeps only public fields: the filer's name and email never leave Sanity.

import { jobApprovalHash, jobPublishBlockers } from './workflow.js';
import { JOB_ID_PATH } from './rules.js';

// Form submissions use private ids "jobs.<id>" (they hold the filer's email); jobs an editor creates in the
// Studio get Sanity's normal ids. Drafts ("drafts.…") are never public.
const JOB_ID_RE = new RegExp(`^(${JOB_ID_PATH}\\.)?[A-Za-z0-9_-]{4,64}$`);
export const isJobId = (id) => typeof id === 'string' && JOB_ID_RE.test(id);
export const publicJobId = (id) => (id.startsWith(`${JOB_ID_PATH}.`) ? id.slice(JOB_ID_PATH.length + 1) : id);

/** @returns {string[]} why the job is not public (empty = public) */
export function jobHoldReasons(doc, { now, approverIds }) {
  if (!doc || !isJobId(doc._id)) return ['not a published job document'];
  if (doc.status !== 'published') return [`status is ${doc.status || 'missing'}`];
  const reasons = [];
  const approval = doc.approval || {};
  if (!approval.approvedById || !approval.approvedAt) reasons.push('no approval');
  else if (!approverIds?.length) reasons.push('no approvers are configured (news.review.approverIds)');
  else if (!approverIds.includes(approval.approvedById)) reasons.push('approved by someone who is not a listed approver');
  if (approval.contentHash !== jobApprovalHash(doc)) reasons.push('changed since it was approved');
  reasons.push(...jobPublishBlockers(doc, { now }));
  return reasons;
}

/** Splits candidates into public jobs and held ones ({id, reasons}). */
export function selectPublicJobs(docs, ctx) {
  const jobs = [];
  const held = [];
  for (const doc of docs) {
    const reasons = jobHoldReasons(doc, ctx);
    if (reasons.length) held.push({ id: doc?._id || '(no id)', reasons });
    else jobs.push(doc);
  }
  return { jobs, held };
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const orNull = (value) => (value === undefined || value === null || value === '' ? null : value);

/**
 * A published job as a manual listing for src/pipeline/jobs.js, public fields only.
 * employers: Map of employer document id -> employer ({id, name, logoUrl, description, website}).
 */
export function toPublicJob(doc, employers = new Map()) {
  const employer = doc.employer?._ref ? employers.get(doc.employer._ref) : null;
  return {
    id: publicJobId(doc._id),
    title: text(doc.title),
    company: employer?.name || text(doc.company),
    employerKey: employer?.id || null,
    location: text(doc.location),
    url: text(doc.url),
    postedAt: (doc.firstPublishedAt || doc.publishedAt || '').slice(0, 10),
    expiresAt: doc.expiresAt ? String(doc.expiresAt).slice(0, 10) : undefined,
    department: orNull(doc.department),
    employmentType: orNull(doc.employmentType),
    slug: text(doc.slug?.current),
    companyUrl: orNull(doc.companyUrl) || employer?.website || null,
    workMode: orNull(doc.workMode),
    seniority: orNull(doc.seniority),
    regulator: orNull(doc.regulator),
    salary: { from: doc.salaryFrom, to: orNull(doc.salaryTo), currency: doc.salaryCurrency, period: doc.salaryPeriod },
    visa: orNull(doc.visa),
    description: text(doc.description),
    requirements: (Array.isArray(doc.requirements) ? doc.requirements : []).map(text).filter(Boolean),
    logoUrl: employer?.logoUrl || null
  };
}
