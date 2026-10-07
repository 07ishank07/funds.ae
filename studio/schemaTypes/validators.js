// Validation helpers shared by the schema types. The Studio checks are for the
// editor's convenience; the backend validates everything again before
// publishing (backend/src/cms/), so a rule missed here can never reach the site.

import { HEX_COLOR, ID_PATTERN, IMAGE_MAX_BYTES, IMAGE_TYPES } from './rules.js'

const API_VERSION = '2025-02-19'
const WEBSITE = /^(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i

/** Text with a [min, max] length; required when min > 0. */
export function textRule(rule, [min, max], {required = min > 0} = {}) {
  const r = required ? rule.required().min(min) : rule
  return r.max(max).custom((value) => {
    if (!value) return true
    if (value !== value.trim()) return 'Remove spaces at the start or end.'
    if (!required && min > 0 && value.length < min) return `Use at least ${min} characters, or leave it empty.`
    return true
  })
}

/** An id the website can use: a slug of lowercase letters, numbers and dashes. */
export function idRule(rule) {
  return rule.required().custom((value) => {
    const id = value?.current
    if (!id) return 'Generate an id from the title.'
    return ID_PATTERN.test(id) ? true : 'Use lowercase letters, numbers and dashes (2 to 61 characters).'
  })
}

/** Links on the public site are https only. */
export function httpsRule(rule, {required = false} = {}) {
  const r = rule.uri({scheme: ['https'], allowRelative: false})
  return required ? r.required() : r
}

export function hexRule(rule) {
  return rule.custom((value) => (!value || HEX_COLOR.test(value) ? true : 'Use a hex colour such as #137A72.'))
}

export function websiteRule(rule, max) {
  return rule.max(max).custom((value) =>
    !value || WEBSITE.test(value) ? true : 'Write it like www.example.ae (it is shown as text, not a link).',
  )
}

/** PNG, JPG or WebP up to 500 KB. SVG is refused because it can carry scripts. */
export function imageRule(rule) {
  return rule.custom(async (value, context) => {
    const ref = value?.asset?._ref
    if (!ref) return true
    const client = context.getClient({apiVersion: API_VERSION})
    const asset = await client.fetch('*[_id == $ref][0]{mimeType, size}', {ref})
    if (!asset) return true
    if (!IMAGE_TYPES.includes(asset.mimeType)) return 'Use a PNG, JPG or WebP image (not SVG or GIF).'
    if (asset.size > IMAGE_MAX_BYTES) return `This image is ${Math.round(asset.size / 1024)} KB; the limit is 500 KB.`
    return true
  })
}

/**
 * Document-level check: no more than `max` enabled, published documents of this
 * type share the same value of `field` (for example sponsors in one slot).
 * `max` is a number or a function of the document.
 */
export function maxPerGroup({type, field, max: maxOf, label}) {
  return (rule) =>
    rule.custom(async (doc, context) => {
      if (!doc || doc.enabled === false) return true
      const max = typeof maxOf === 'function' ? maxOf(doc) : maxOf
      if (!Number.isFinite(max)) return true
      const id = doc._id.replace(/^drafts\./, '')
      const client = context.getClient({apiVersion: API_VERSION})
      const others = await client.fetch(
        `count(*[_type == $type && ${field} == $value && enabled != false && !(_id in [$id, $draftId]) && !(_id in path("drafts.**"))])`,
        {type, value: doc[field] ?? null, id, draftId: `drafts.${id}`},
      )
      return others + 1 <= max
        ? true
        : `${label(doc)} has room for ${max}. Disable or delete one before publishing another.`
    })
}

export {API_VERSION}
