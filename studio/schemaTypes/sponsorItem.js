// One sponsor placement. Every slot uses the same document type; the slot
// decides which fields are shown and how long they may be (rules.js).
// Published as backend/config/sponsors.json -> api/v1/sponsors.json.

import {defineField, defineType} from 'sanity'
import {SPONSOR_SLOTS} from './rules.js'
import {hexRule, httpsRule, idRule, imageRule, maxPerGroup, textRule, websiteRule} from './validators.js'

const LABELS = {
  title: 'Name or headline',
  blurb: 'One-line message',
  label: 'Small label',
  logoText: 'Logo text (initials)',
  website: 'Website (shown as text)',
}
const HINTS = {
  blurb: 'Hidden on phones.',
  label: 'For example "Sponsored" or "Podcast".',
  logoText: 'Shown on the coloured tile when there is no logo image.',
  website: 'For example www.example.ae. Shown as text only; the link below is what people click.',
}

const rulesFor = (doc) => SPONSOR_SLOTS[doc?.slot]
const uses = (doc, field) => {
  const r = rulesFor(doc)
  return Boolean(r && (field in r.text || r.images.includes(field) || r.colors.includes(field)))
}

function textField(name) {
  return defineField({
    name,
    title: LABELS[name],
    type: 'string',
    description: HINTS[name],
    hidden: ({document}) => !uses(document, name),
    validation: (rule) =>
      rule.custom((value, context) => {
        const r = rulesFor(context.document)
        if (!r || !(name in r.text)) return true
        const max = r.text[name]
        if (r.required.includes(name) && !value) return 'Required for this slot.'
        if (value && value.length > max) return `Use ${max} characters or fewer for this slot.`
        return true
      }),
  })
}

export const sponsorItem = defineType({
  name: 'sponsorItem',
  title: 'Sponsor placement',
  type: 'document',
  validation: maxPerGroup({
    type: 'sponsorItem',
    field: 'slot',
    max: (doc) => rulesFor(doc)?.maxItems ?? Infinity,
    label: (doc) => `"${rulesFor(doc)?.label}"`,
  }),
  fields: [
    defineField({
      name: 'slot',
      title: 'Where it appears',
      type: 'string',
      options: {
        list: Object.entries(SPONSOR_SLOTS).map(([value, r]) => ({value, title: r.label})),
        layout: 'radio',
      },
      description: 'Each area of the site accepts different fields.',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'enabled',
      title: 'Show on the site',
      type: 'boolean',
      initialValue: true,
      description: 'Switch off to take a placement down without deleting it.',
    }),
    defineField({
      name: 'id',
      title: 'Id',
      type: 'slug',
      options: {source: 'title', maxLength: 61},
      description: 'Stable id used by the website. Do not change it once published.',
      validation: idRule,
    }),
    defineField({
      name: 'position',
      title: 'Order',
      type: 'number',
      initialValue: 10,
      description: 'Lower numbers show first.',
      validation: (rule) => rule.integer().min(0).max(999),
    }),
    textField('title'),
    textField('blurb'),
    textField('label'),
    textField('logoText'),
    defineField({
      name: 'website',
      title: LABELS.website,
      type: 'string',
      description: HINTS.website,
      hidden: ({document}) => !uses(document, 'website'),
      validation: (rule) => websiteRule(rule, 80),
    }),
    defineField({
      name: 'url',
      title: 'Link',
      type: 'url',
      description: 'https:// only. Leave empty for a placeholder that is not clickable.',
      validation: (rule) => httpsRule(rule),
    }),
    defineField({
      name: 'image',
      title: 'Logo or image',
      type: 'image',
      description: 'PNG, JPG or WebP up to 500 KB.',
      options: {accept: 'image/png,image/jpeg,image/webp'},
      hidden: ({document}) => !uses(document, 'image'),
      validation: imageRule,
    }),
    defineField({
      name: 'colorFrom',
      title: 'Tile colour (start)',
      type: 'string',
      description: 'Hex colour such as #137A72. Used when there is no image.',
      hidden: ({document}) => !uses(document, 'colorFrom'),
      validation: hexRule,
    }),
    defineField({
      name: 'colorTo',
      title: 'Tile colour (end of gradient)',
      type: 'string',
      hidden: ({document}) => !uses(document, 'colorTo'),
      validation: hexRule,
    }),
  ],
  orderings: [{title: 'Order', name: 'position', by: [{field: 'position', direction: 'asc'}]}],
  preview: {
    select: {title: 'title', slot: 'slot', enabled: 'enabled', media: 'image'},
    prepare: ({title, slot, enabled, media}) => ({
      title: title || '(no name)',
      subtitle: [SPONSOR_SLOTS[slot]?.label || 'No slot', enabled === false ? 'hidden' : null].filter(Boolean).join(' · '),
      media,
    }),
  },
})
