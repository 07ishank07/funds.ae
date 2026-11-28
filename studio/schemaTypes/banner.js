// Reusable banners: the Finance Careers banner (home page under the funding tiles, top of the Careers page, Events
// page column 2) and the Grants & Funding card (home page column 2, Careers page column 2). One document per
// placement. Published as backend/config/content.json -> api/v1/content.json (banners), which js/fundsae-connector.js
// puts into each banner. Unpublished, hidden or outside its dates, the built-in banner shows.
// Limits: BANNER_LIMITS, BANNER_PLACEMENTS and BANNER_TARGETS in rules.js (equal to the backend's).
//
// Privacy: public content (readable by anyone). No personal details; a photo needs its credit and licence.

import {defineField, defineType} from 'sanity'
import {BANNER_LIMITS, BANNER_PLACEMENTS, BANNER_TARGETS, IMAGE_TYPES} from './rules.js'
import {API_VERSION, maxPerGroup, textRule} from './validators.js'

/** PNG, JPG or WebP up to BANNER_LIMITS.imageMaxBytes. */
const bannerImageRule = (rule) =>
  rule.custom(async (value, context) => {
    const ref = value?.asset?._ref
    if (!ref) return true
    const asset = await context.getClient({apiVersion: API_VERSION}).fetch('*[_id == $ref][0]{mimeType, size}', {ref})
    if (!asset) return true
    if (!IMAGE_TYPES.includes(asset.mimeType)) return 'Use a PNG, JPG or WebP image (not SVG or GIF).'
    if (asset.size > BANNER_LIMITS.imageMaxBytes) return `This image is ${Math.round(asset.size / 1024)} KB; the limit is ${BANNER_LIMITS.imageMaxBytes / 1024} KB.`
    return true
  })

const placementLabel = (value) => (BANNER_PLACEMENTS.find((p) => p.value === value) || {}).title || value

export const banner = defineType({
  name: 'banner',
  title: 'Banner',
  type: 'document',
  description: 'Shown on the public website and readable by anyone: no personal details. A photo needs its credit and licence.',
  validation: (rule) => [
    maxPerGroup({type: 'banner', field: 'placement', max: 1, label: (doc) => `The ${placementLabel(doc.placement)}`})(rule),
    rule.custom((doc) => {
      if (!doc) return true
      if (doc.image?.asset && !doc.credit) return 'Add the photo credit and licence before publishing.'
      if (doc.image?.asset && !doc.imageAlt) return 'Describe the photo for people who cannot see it.'
      if (Boolean(doc.buttonLabel) !== Boolean(doc.buttonTarget)) return 'Set the button text and the page it opens together, or neither.'
      if (doc.startDate && doc.endDate && doc.endDate < doc.startDate) return 'The end date is before the start date.'
      return true
    }),
  ],
  fields: [
    defineField({
      name: 'placement',
      title: 'Which banner',
      type: 'string',
      options: {list: BANNER_PLACEMENTS, layout: 'radio'},
      validation: (rule) => rule.required(),
    }),
    defineField({name: 'eyebrow', title: 'Small label', type: 'string', description: 'For example "Finance Careers".', validation: (rule) => textRule(rule, BANNER_LIMITS.eyebrow)}),
    defineField({name: 'title', title: 'Heading', type: 'string', validation: (rule) => textRule(rule, BANNER_LIMITS.title)}),
    defineField({
      name: 'text',
      title: 'One line of text',
      type: 'text',
      rows: 2,
      description: 'Optional (the Grants & Funding card does not show it).',
      validation: (rule) => textRule(rule, BANNER_LIMITS.text, {required: false}),
    }),
    defineField({name: 'buttonLabel', title: 'Button text', type: 'string', validation: (rule) => textRule(rule, BANNER_LIMITS.buttonLabel, {required: false})}),
    defineField({
      name: 'buttonTarget',
      title: 'Button opens',
      type: 'string',
      options: {list: Object.entries(BANNER_TARGETS).map(([value, t]) => ({value, title: t.title}))},
    }),
    defineField({
      name: 'image',
      title: 'Photo',
      type: 'image',
      description: `PNG, JPG or WebP up to ${BANNER_LIMITS.imageMaxBytes / 1024} KB. Leave empty to keep the built-in photo. Only use photos you are licensed to use.`,
      options: {hotspot: true},
      validation: bannerImageRule,
    }),
    defineField({name: 'imageAlt', title: 'Photo description', type: 'string', validation: (rule) => textRule(rule, BANNER_LIMITS.imageAlt, {required: false})}),
    defineField({
      name: 'credit',
      title: 'Photo credit and licence',
      type: 'string',
      description: 'For example "Photo: Jane Smith, Unsplash Licence". Kept with the banner for the licence record.',
      validation: (rule) => textRule(rule, BANNER_LIMITS.credit, {required: false}),
    }),
    defineField({name: 'startDate', title: 'Show from', type: 'date', description: 'Optional. Leave empty to show straight away.'}),
    defineField({name: 'endDate', title: 'Show until', type: 'date', description: 'Optional. After this date the built-in banner shows again.'}),
    defineField({name: 'enabled', title: 'Show on the site', type: 'boolean', initialValue: true}),
  ],
  preview: {
    select: {placement: 'placement', title: 'title', enabled: 'enabled', media: 'image'},
    prepare: ({placement, title, enabled, media}) => ({
      title: `${placementLabel(placement) || '(choose the banner)'}${enabled === false ? ' (hidden)' : ''}`,
      subtitle: title,
      media,
    }),
  },
})
