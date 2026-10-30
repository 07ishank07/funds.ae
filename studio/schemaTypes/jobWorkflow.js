// The jobs workflow as pure functions, like newsWorkflow.js. The Studio's job actions (studio/actions/jobActions.jsx)
// are thin wrappers around planJobAction() and planJobSave(). The backend keeps its own copy of jobApprovalHash(),
// jobPublishBlockers() and suggestJobSlug() in backend/src/jobs/workflow.js; backend/test/cms.test.js proves both
// copies agree. No imports from 'sanity' here, so Node can load this file.

import {fnv1a64} from './newsWorkflow.js'
import {
  JOB_ACTIONS,
  JOB_APPROVAL_HASH_FIELDS,
  JOB_EMPLOYMENT_TYPES,
  JOB_FORM_OPTIONS,
  JOB_LIMITS,
  JOB_SLUG_PATTERN,
  JOB_STATUS_LABELS,
} from './jobRules.js'

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

function approverProblem(userId, approverIds) {
  if (!approverIds?.length) {
    return 'No approvers are set up yet, so nobody can publish. Ask the developer to add approvers (docs/NEWS-REVIEW-GUIDE.md, "Approvers").'
  }
  if (!userId || !approverIds.includes(userId)) {
    return 'Only approvers can do this. Ask an approver, or ask the developer to add you (docs/NEWS-REVIEW-GUIDE.md, "Approvers").'
  }
  return null
}

const fail = (...reasons) => ({ok: false, reasons, set: {}, unset: []})

/**
 * What a job workflow action would change, without changing anything.
 * Returns {ok, reasons, set, unset}: the Studio applies `set`/`unset` to the draft and publishes it.
 * ctx: {userId, userName, approverIds, now, reason}
 */
export function planJobAction(name, doc = {}, ctx = {}) {
  const {userId = null, userName = null, approverIds = [], now = new Date(), reason} = ctx
  const action = JOB_ACTIONS[name]
  if (!action) return fail(`Unknown action "${name}".`)
  const status = doc.status || 'pending_review'
  if (!action.from.includes(status)) return fail(`"${action.label}" is not available for a job that is ${JOB_STATUS_LABELS[status] || status}.`)
  if (action.approverOnly) {
    const problem = approverProblem(userId, approverIds)
    if (problem) return fail(problem)
  }
  const at = now.toISOString()
  const set = {status: action.to, statusChangedAt: at, statusChangedById: userId}
  const unset = []

  if (name === 'reject') {
    const why = text(reason)
    const [min, max] = JOB_LIMITS.rejectionReason
    if (!between(why, JOB_LIMITS.rejectionReason)) return fail(`Give a reason of ${min}-${max} characters.`)
    set.rejectionReason = why
    unset.push('approval', 'publishedAt', 'publishedById')
    return {ok: true, reasons: [], set, unset}
  }
  if (name === 'unpublish') {
    unset.push('approval', 'publishedAt', 'publishedById')
    return {ok: true, reasons: [], set, unset}
  }
  if (name === 'archive') {
    unset.push('approval')
    return {ok: true, reasons: [], set, unset}
  }

  // approvePublish: the job must pass every publish check.
  if (!JOB_SLUG_PATTERN.test(text(doc.slug?.current))) set.slug = {_type: 'slug', current: suggestJobSlug(doc)}
  if (!doc.expiresAt) set.expiresAt = new Date(now.getTime() + JOB_LIMITS.defaultLiveDays * 86_400_000).toISOString()
  set.publishedAt = at
  set.publishedById = userId
  if (!doc.firstPublishedAt) set.firstPublishedAt = at
  unset.push('rejectionReason')
  const next = {...doc, ...set}
  for (const field of unset) delete next[field]
  const blockers = jobPublishBlockers(next, {now})
  if (blockers.length) return fail(...blockers)
  set.approval = {approvedById: userId, approvedByName: userName, approvedAt: at, contentHash: jobApprovalHash(next)}
  return {ok: true, reasons: [], set, unset}
}

/**
 * "Save changes" (Sanity's own publish) on a job. Pending, rejected and archived jobs save freely. A published job:
 * only an approver may save, it must still pass every check, and the approval is re-stamped for the new content.
 */
export function planJobSave(doc = {}, ctx = {}) {
  const {userId = null, userName = null, approverIds = [], now = new Date()} = ctx
  if ((doc.status || 'pending_review') !== 'published') return {ok: true, reasons: [], set: {}, unset: []}
  const problem = approverProblem(userId, approverIds)
  if (problem) return fail(`This job is live. ${problem}`)
  const blockers = jobPublishBlockers(doc, {now})
  if (blockers.length) return fail(...blockers)
  return {
    ok: true,
    reasons: [],
    set: {approval: {approvedById: userId, approvedByName: userName, approvedAt: now.toISOString(), contentHash: jobApprovalHash(doc)}},
    unset: [],
  }
}
