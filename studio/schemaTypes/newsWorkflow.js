// The news workflow as pure functions. The Studio's document actions (studio/actions/) are thin
// wrappers around planAction() and planSave(); backend/test/workflow.test.js tests them directly.
// The backend keeps its own copy of approvalHash() and publishBlockers() in
// backend/src/news/workflow.js, and backend/test/cms.test.js proves both copies agree.
// No imports from 'sanity' here, so Node can load this file.

import {
  NEWS_ACTIONS,
  NEWS_APPROVAL_HASH_FIELDS,
  NEWS_LIMITS,
  NEWS_SLUG_PATTERN,
  NEWS_STATUS_LABELS,
  PUBLISHABLE_LICENSE_STATUSES,
} from './newsRules.js'

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const refIds = (list) => (Array.isArray(list) ? list.map((r) => r?._ref).filter(Boolean).sort() : [])
const isoOrNull = (value) => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}

/** 64-bit FNV-1a over UTF-16 code units, as 16 hex characters. A change detector, not a signature. */
export function fnv1a64(input) {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

/** The approved content in a fixed shape, so equal content always gives an equal hash. */
export function approvalFingerprint(doc = {}) {
  const normalise = {
    headline: () => text(doc.headline),
    slug: () => text(doc.slug?.current),
    summary: () => text(doc.summary),
    // Who wrote the summary: the site holds AI-written summaries from sources that do not allow them.
    summarySource: () => text(doc.summarySource) || null,
    capitalTypes: () => refIds(doc.capitalTypes),
    assetClasses: () => refIds(doc.assetClasses),
    geography: () => (Array.isArray(doc.geography) ? [...doc.geography].map(String).sort() : []),
    transactionType: () => text(doc.transactionType) || null,
    featured: () => doc.featured === true,
    image: () =>
      doc.image?.asset?._ref
        ? {asset: doc.image.asset._ref, credit: text(doc.image.credit), rightsConfirmed: doc.image.rightsConfirmed === true}
        : null,
    seo: () => ({title: text(doc.seo?.title), description: text(doc.seo?.description)}),
    duplicateOf: () => doc.duplicateOf?._ref || null,
    publishedAt: () => isoOrNull(doc.publishedAt),
  }
  return Object.fromEntries(NEWS_APPROVAL_HASH_FIELDS.map((field) => [field, normalise[field]()]))
}

export function approvalHash(doc) {
  return fnv1a64(JSON.stringify(approvalFingerprint(doc)))
}

const between = (value, [min, max]) => value.length >= min && value.length <= max

/**
 * Why a story cannot go on the site yet, in plain language (empty = it can).
 * sourceLicenseStatus is the licenceStatus of the story's source.
 */
export function publishBlockers(doc = {}, {sourceLicenseStatus} = {}) {
  const reasons = []
  const [hMin, hMax] = NEWS_LIMITS.headline
  const [sMin, sMax] = NEWS_LIMITS.summary
  if (!between(text(doc.headline), NEWS_LIMITS.headline)) reasons.push(`The headline must be ${hMin}-${hMax} characters.`)
  if (!between(text(doc.summary), NEWS_LIMITS.summary)) reasons.push(`Write a summary of ${sMin}-${sMax} characters.`)
  if (text(doc.excerpt).length > NEWS_LIMITS.excerpt[1]) reasons.push('The publisher excerpt is longer than 280 characters.')
  const slug = text(doc.slug?.current)
  if (!slug || !NEWS_SLUG_PATTERN.test(slug) || !between(slug, NEWS_LIMITS.slug)) {
    reasons.push('The web address (slug) must be 3-96 lowercase letters, numbers and single dashes.')
  }
  if (!/^https?:\/\//i.test(text(doc.originalUrl))) reasons.push('The link to the original article is missing.')
  if (!text(doc.sourceName)) reasons.push('The source name is missing.')
  if (!PUBLISHABLE_LICENSE_STATUSES.includes(sourceLicenseStatus)) {
    reasons.push(
      `The source's licence status is "${sourceLicenseStatus || 'unknown'}". Stories can only be published from sources ` +
        `whose terms are cleared (${PUBLISHABLE_LICENSE_STATUSES.join(', ')}).`,
    )
  }
  if (doc.image?.asset?._ref) {
    if (doc.image.rightsConfirmed !== true) reasons.push('Confirm that you have the rights to the image, or remove it.')
    if (!between(text(doc.image.credit), NEWS_LIMITS.imageCredit)) reasons.push('Add an image credit (who owns the picture).')
  }
  if (doc.duplicateOf?._ref) reasons.push('This story is marked as a duplicate of another one. Clear "Duplicate of" or reject it.')
  return reasons
}

/** A web address for the story: the headline in lowercase words plus 4 characters of its id, e.g. "adia-buys-...-3f2a". */
export function suggestSlug(doc = {}) {
  const words = text(doc.headline)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  let base = words.slice(0, 80)
  if (words.length > 80 && base.includes('-')) base = base.slice(0, base.lastIndexOf('-'))
  const suffix = /^a_[0-9a-f]{4}/.test(doc.articleId || '') ? doc.articleId.slice(2, 6) : fnv1a64(text(doc.headline)).slice(0, 4)
  return `${base || 'story'}-${suffix}`
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
 * What a workflow action would change, without changing anything.
 * Returns {ok, reasons, set, unset}: the Studio applies `set`/`unset` to the draft and publishes it.
 * ctx: {userId, userName, approverIds, now, scheduleAt, reason, sourceLicenseStatus}
 */
export function planAction(name, doc = {}, ctx = {}) {
  const {userId = null, userName = null, approverIds = [], now = new Date(), scheduleAt, reason, sourceLicenseStatus} = ctx
  const action = NEWS_ACTIONS[name]
  if (!action) return fail(`Unknown action "${name}".`)
  const status = doc.status || 'pending_review'
  if (!action.from.includes(status)) {
    return fail(`"${action.label}" is not available for a story that is ${NEWS_STATUS_LABELS[status] || status}.`)
  }
  if (action.approverOnly) {
    const problem = approverProblem(userId, approverIds)
    if (problem) return fail(problem)
  }
  const at = now.toISOString()
  const set = {status: action.to, statusChangedAt: at, statusChangedById: userId}
  const unset = []

  if (name === 'reject') {
    const why = text(reason)
    const [min, max] = NEWS_LIMITS.rejectionReason
    if (!between(why, NEWS_LIMITS.rejectionReason)) return fail(`Give a reason of ${min}-${max} characters.`)
    set.rejectionReason = why
    return {ok: true, reasons: [], set, unset}
  }
  if (name === 'returnToReview') {
    unset.push('approval', 'publishedAt', 'publishedById', 'scheduledAt', 'rejectionReason')
    return {ok: true, reasons: [], set, unset}
  }
  if (name === 'unpublish') {
    unset.push('publishedAt', 'publishedById', 'scheduledAt')
    return {ok: true, reasons: [], set, unset}
  }
  if (name === 'archive') return {ok: true, reasons: [], set, unset}

  // approve, approvePublish, publish, schedule: the story must pass every publish check.
  if (!NEWS_SLUG_PATTERN.test(text(doc.slug?.current))) set.slug = {_type: 'slug', current: suggestSlug(doc)}
  if (name === 'schedule') {
    const when = scheduleAt ? new Date(scheduleAt) : null
    const earliest = now.getTime() + NEWS_LIMITS.scheduleLeadMinutes * 60_000
    if (!when || Number.isNaN(when.getTime()) || when.getTime() < earliest) {
      return fail(`Pick a date and time at least ${NEWS_LIMITS.scheduleLeadMinutes} minutes from now.`)
    }
    set.publishedAt = when.toISOString()
    set.scheduledAt = set.publishedAt
  } else if (action.to === 'published') {
    set.publishedAt = at
    unset.push('scheduledAt')
  }
  if (action.to === 'published') {
    set.publishedById = userId
    if (!doc.firstPublishedAt) set.firstPublishedAt = set.publishedAt
  }
  unset.push('rejectionReason')

  const next = {...doc, ...set}
  for (const field of unset) delete next[field]
  const blockers = publishBlockers(next, {sourceLicenseStatus})
  if (blockers.length) return fail(...blockers)
  set.approval = {approvedById: userId, approvedByName: userName, approvedAt: at, contentHash: approvalHash(next)}
  return {ok: true, reasons: [], set, unset}
}

/**
 * The Studio's "Save changes" (Sanity's own publish). Pending, rejected and archived stories save freely.
 * Approved and live stories: only an approver may save, the story must still pass every check, and the
 * approval is re-stamped for the new content. Edits by anyone else would change the hash and take it off the site.
 */
export function planSave(doc = {}, ctx = {}) {
  const {userId = null, userName = null, approverIds = [], now = new Date(), sourceLicenseStatus} = ctx
  const status = doc.status || 'pending_review'
  if (status !== 'approved' && status !== 'published') return {ok: true, reasons: [], set: {}, unset: []}
  const problem = approverProblem(userId, approverIds)
  if (problem) return fail(`This story is ${NEWS_STATUS_LABELS[status].toLowerCase()}. ${problem}`)
  const blockers = publishBlockers(doc, {sourceLicenseStatus})
  if (blockers.length) return fail(...blockers)
  const at = now.toISOString()
  return {
    ok: true,
    reasons: [],
    set: {approval: {approvedById: userId, approvedByName: userName, approvedAt: at, contentHash: approvalHash(doc)}},
    unset: [],
  }
}
