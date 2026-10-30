// The backend's copy of the parts of studio/schemaTypes/jobWorkflow.js the publisher needs: the approval
// hash, the publish checks and the slug suggestion. backend/test/cms.test.js runs both copies over the same
// jobs and fails if they ever disagree, so change them together. The workflow actions live only in the Studio.

import { fnv1a64 } from '../news/workflow.js';
import {
  JOB_APPROVAL_HASH_FIELDS, JOB_EMPLOYMENT_TYPES, JOB_FORM_OPTIONS, JOB_LIMITS, JOB_SLUG_PATTERN
} from './rules.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const whole = (value) => (Number.isInteger(value) ? value : null)
const isoOrNull = (value) => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}
const between = (value, [min, max]) => value.length >= min && value.length <= max
const lines = (list) => (Array.isArray(list) ? list.map(text).filter(Boolean) : [])

/** The approved content in a fixed shape, so equal content always gives an equal hash. */
export function jobApprovalFingerprint(doc = {}) {
  const normalise = {
    title: () => text(doc.title),
    slug: () => text(doc.slug?.current),
    company: () => text(doc.company),
    employer: () => doc.employer?._ref || null,
    companyUrl: () => text(doc.companyUrl) || null,
    location: () => text(doc.location),
    workMode: () => text(doc.workMode) || null,
    employmentType: () => text(doc.employmentType) || null,
    seniority: () => text(doc.seniority) || null,
    department: () => text(doc.department) || null,
    regulator: () => text(doc.regulator) || null,
    url: () => text(doc.url),
    salaryFrom: () => whole(doc.salaryFrom),
    salaryTo: () => whole(doc.salaryTo),
    salaryCurrency: () => text(doc.salaryCurrency) || null,
    salaryPeriod: () => text(doc.salaryPeriod) || null,
    visa: () => text(doc.visa) || null,
    description: () => text(doc.description),
    requirements: () => lines(doc.requirements),
    expiresAt: () => isoOrNull(doc.expiresAt),
  }
  return Object.fromEntries(JOB_APPROVAL_HASH_FIELDS.map((field) => [field, normalise[field]()]))
}

export function jobApprovalHash(doc) {
  return fnv1a64(JSON.stringify(jobApprovalFingerprint(doc)))
}

const optionProblem = (doc, field, list, label) =>
  doc[field] !== undefined && doc[field] !== null && doc[field] !== '' && !list.includes(doc[field]) ? `Choose a ${label} from the list.` : null

/** Why a job cannot go on the site, in plain language (empty = it can). */
export function jobPublishBlockers(doc = {}, {now = new Date()} = {}) {
  const reasons = []
  const L = JOB_LIMITS
  if (!between(text(doc.title), L.title)) reasons.push(`The role title must be ${L.title[0]}-${L.title[1]} characters.`)
  if (!between(text(doc.company), L.company)) reasons.push(`The hiring company must be ${L.company[0]}-${L.company[1]} characters.`)
  if (!between(text(doc.location), L.location)) reasons.push('Add a location, for example "DIFC, Dubai".')
  const slug = text(doc.slug?.current)
  if (!slug || !JOB_SLUG_PATTERN.test(slug) || !between(slug, L.slug)) {
    reasons.push('The web address (slug) must be 3-96 lowercase letters, numbers and single dashes.')
  }
  if (!/^https:\/\/\S+$/.test(text(doc.url))) reasons.push('Add an apply link that starts with https://.')
  if (doc.companyUrl && !/^https:\/\/\S+$/.test(text(doc.companyUrl))) reasons.push('The company website must start with https://.')
  const from = whole(doc.salaryFrom)
  const to = whole(doc.salaryTo)
  if (from === null || from < 1 || from > L.salaryMax) reasons.push('Add the starting salary as a whole number.')
  if (doc.salaryTo !== undefined && doc.salaryTo !== null && (to === null || to < 1 || to > L.salaryMax)) reasons.push('The top of the salary range must be a whole number.')
  if (from !== null && to !== null && to < from) reasons.push('The top of the salary range must be at least the starting salary.')
  if (!JOB_FORM_OPTIONS.salaryCurrency.includes(doc.salaryCurrency)) reasons.push('Choose the salary currency.')
  if (!JOB_FORM_OPTIONS.salaryPeriod.includes(doc.salaryPeriod)) reasons.push('Choose whether the salary is per month or per year.')
  if (!JOB_FORM_OPTIONS.visa.includes(doc.visa)) reasons.push('Choose the visa line.')
  for (const problem of [
    optionProblem(doc, 'workMode', JOB_FORM_OPTIONS.workMode, 'work mode'),
    optionProblem(doc, 'employmentType', JOB_EMPLOYMENT_TYPES, 'job type'),
    optionProblem(doc, 'seniority', JOB_FORM_OPTIONS.seniority, 'level'),
    optionProblem(doc, 'department', JOB_FORM_OPTIONS.department, 'function'),
    optionProblem(doc, 'regulator', JOB_FORM_OPTIONS.regulator, 'regulator'),
  ]) {
    if (problem) reasons.push(problem)
  }
  if (!between(text(doc.description), L.description)) reasons.push(`Write a description of ${L.description[0]}-${L.description[1]} characters.`)
  const requirements = lines(doc.requirements)
  if (requirements.length > L.requirements) reasons.push(`List at most ${L.requirements} requirements.`)
  if (requirements.some((r) => !between(r, L.requirement))) reasons.push(`Each requirement must be ${L.requirement[0]}-${L.requirement[1]} characters.`)
  const expires = isoOrNull(doc.expiresAt)
  if (doc.expiresAt && !expires) reasons.push('The expiry date is not a valid date.')
  if (expires && new Date(expires) <= now) reasons.push('The expiry date has passed. Set a later date or archive the job.')
  return reasons
}

/** A web address for the job: role and company in lowercase words plus 4 characters of its id, e.g. "associate-private-credit-example-capital-3f2a". */
export function suggestJobSlug(doc = {}) {
  const words = `${text(doc.title)} ${text(doc.company)}`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  let base = words.slice(0, 80)
  if (words.length > 80 && base.includes('-')) base = base.slice(0, base.lastIndexOf('-'))
  const id = text(doc._id).replace(/^drafts\./, '')
  return `${base || 'job'}-${fnv1a64(id || text(doc.title)).slice(0, 4)}`
}
