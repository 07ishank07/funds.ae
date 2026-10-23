// One package card on the Advertise page. Editors add, edit, hide, reorder and delete packages here.
// The package id is the value the enquiry form sends, so "Get started" keeps pre-selecting the right package.
// Published as backend/config/content.json -> api/v1/content.json (slots.advertiseTiers).

import {defineArrayMember, defineField, defineType} from 'sanity'
import {ID_PATTERN, PLACEMENT_LABELS, PLACEMENT_TYPES, TIER_LIMITS} from './rules.js'
import {httpsRule, maxPerGroup, textRule} from './validators.js'

// Names for the default packages and the retired one, used when a card has no title yet.
const TIER_TITLES = {silver: 'Featured Partner', gold: 'Gold Partner', platinum: 'Elite Partner (retired: delete this)', exclusive: 'Elite Exclusive Partner'}

export const advertiseTier = defineType({
  name: 'advertiseTier',
  title: 'Advertise package',
  type: 'document',
  validation: maxPerGroup({
    type: 'advertiseTier',
    field: 'tier',
    max: 1,
    label: (doc) => `The package id "${doc.tier}"`,
  }),
  fields: [
    defineField({
      name: 'tier',
      title: 'Package id',
      type: 'string',
      description:
        'A short id such as "gold" or "silver-plus" (lowercase letters, numbers and dashes). The enquiry form records it, so keep it once the package is live. The built-in packages are silver (Featured Partner), gold (Gold Partner) and exclusive (Elite Exclusive Partner, the dark card the founding banner links to).',
      validation: (rule) =>
        rule.required().custom((value) => (!value || ID_PATTERN.test(value) ? true : 'Use lowercase letters, numbers and dashes (2 to 61 characters).')),
    }),
    defineField({name: 'name', title: 'Card title', type: 'string', validation: (rule) => textRule(rule, TIER_LIMITS.name)}),
    defineField({
      name: 'badge',
      title: 'Badge',
      type: 'string',
      description: 'Small label above the title, for example "Most popular".',
      validation: (rule) => textRule(rule, TIER_LIMITS.badge, {required: false}),
    }),
    defineField({
      name: 'price',
      title: 'Price',
      type: 'string',
      description: 'For example "AED 9,500" or "On request".',
      validation: (rule) => textRule(rule, TIER_LIMITS.price),
    }),
    defineField({
      name: 'priceNote',
      title: 'Price note',
      type: 'string',
      description: 'For example "/ month".',
      validation: (rule) => textRule(rule, TIER_LIMITS.priceNote, {required: false}),
    }),
    defineField({
      name: 'showPrice',
      title: 'Show the price on the card',
      type: 'boolean',
      initialValue: true,
    }),
    defineField({
      name: 'duration',
      title: 'Duration',
      type: 'string',
      description: 'Optional, for example "Minimum term: 3 months".',
      validation: (rule) => textRule(rule, TIER_LIMITS.duration, {required: false}),
    }),
    defineField({
      name: 'placements',
      title: 'Home page placements',
      type: 'array',
      description:
        'The home page boxes this package includes. Add each one once, switch it on or off, and describe what the partner gets. Only placements that are switched on appear on the card, in this order.',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'placement',
          title: 'Placement',
          fields: [
            defineField({
              name: 'placement',
              title: 'Placement',
              type: 'string',
              options: {list: PLACEMENT_TYPES.map((value) => ({value, title: PLACEMENT_LABELS[value]}))},
              validation: (rule) => rule.required(),
            }),
            defineField({name: 'enabled', title: 'Included in this package', type: 'boolean', initialValue: true}),
            defineField({
              name: 'detail',
              title: 'What the partner gets',
              type: 'string',
              description: 'For example "One slot, rotating weekly".',
              validation: (rule) => textRule(rule, TIER_LIMITS.placementDetail),
            }),
          ],
          preview: {
            select: {placement: 'placement', detail: 'detail', enabled: 'enabled'},
            prepare: ({placement, detail, enabled}) => ({
              title: PLACEMENT_LABELS[placement] || '(choose a placement)',
              subtitle: [enabled === false ? 'off' : null, detail].filter(Boolean).join(' · '),
            }),
          },
        }),
      ],
      validation: (rule) =>
        rule.max(PLACEMENT_TYPES.length).custom((list) => {
          const types = (list || []).map((p) => p?.placement).filter(Boolean)
          const twice = types.find((t, i) => types.indexOf(t) !== i)
          return twice ? `${PLACEMENT_LABELS[twice]} is listed twice. Keep one.` : true
        }),
    }),
    defineField({
      name: 'features',
      title: 'Other inclusions',
      type: 'array',
      description: 'Anything else the package includes, one line each.',
      of: [defineArrayMember({type: 'string', validation: (rule) => textRule(rule, TIER_LIMITS.feature)})],
      validation: (rule) =>
        rule.max(TIER_LIMITS.features).custom((features, context) => {
          const placements = context.document?.placements || []
          return (features && features.length) || placements.some((p) => p?.enabled !== false)
            ? true
            : 'Add at least one line, or switch on at least one placement.'
        }),
    }),
    defineField({
      name: 'ctaLabel',
      title: 'Button text',
      type: 'string',
      description: 'Optional. Leave empty for "Get started" ("Enquire" on the Elite Exclusive card).',
      validation: (rule) => textRule(rule, TIER_LIMITS.ctaLabel, {required: false}),
    }),
    defineField({
      name: 'ctaUrl',
      title: 'Button link',
      type: 'url',
      description: 'Optional https link. Leave empty to open the enquiry form with this package selected.',
      validation: (rule) => httpsRule(rule),
    }),
    defineField({
      name: 'featured',
      title: 'Highlight this card',
      type: 'boolean',
      initialValue: false,
    }),
    defineField({name: 'position', title: 'Order', type: 'number', initialValue: 10, validation: (rule) => rule.integer().min(0).max(999)}),
    defineField({name: 'enabled', title: 'Show on the site', type: 'boolean', initialValue: true}),
  ],
  orderings: [{title: 'Order', name: 'position', by: [{field: 'position', direction: 'asc'}]}],
  preview: {
    select: {title: 'name', price: 'price', tier: 'tier', enabled: 'enabled', position: 'position'},
    prepare: ({title, price, tier, enabled, position}) => ({
      title: title || TIER_TITLES[tier] || '(no name)',
      subtitle: [tier, price, Number.isFinite(position) ? `order ${position}` : null, enabled === false ? 'hidden' : null].filter(Boolean).join(' · '),
    }),
  },
})
