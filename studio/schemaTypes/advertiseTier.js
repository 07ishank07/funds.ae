// One package card on the Advertise page. The tier id is the value the
// enquiry form sends, so "Get started" keeps pre-selecting the right package.
// Published as backend/config/content.json -> api/v1/content.json (slots.advertiseTiers).

import {defineArrayMember, defineField, defineType} from 'sanity'
import {TIER_IDS, TIER_LIMITS} from './rules.js'
import {maxPerGroup, textRule} from './validators.js'

const TIER_TITLES = {silver: 'Partner', gold: 'Gold Partner', platinum: 'Elite Partner', exclusive: 'Elite Exclusive Partner'}

export const advertiseTier = defineType({
  name: 'advertiseTier',
  title: 'Advertise package',
  type: 'document',
  validation: maxPerGroup({
    type: 'advertiseTier',
    field: 'tier',
    max: 1,
    label: (doc) => `The ${TIER_TITLES[doc.tier] || doc.tier} package`,
  }),
  fields: [
    defineField({
      name: 'tier',
      title: 'Package',
      type: 'string',
      options: {list: TIER_IDS.map((value) => ({value, title: TIER_TITLES[value]})), layout: 'radio'},
      description: 'One card per package. This is what the enquiry form records.',
      validation: (rule) => rule.required(),
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
      description: 'For example "AED 9,500".',
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
      name: 'features',
      title: 'What is included',
      type: 'array',
      of: [defineArrayMember({type: 'string', validation: (rule) => textRule(rule, TIER_LIMITS.feature)})],
      validation: (rule) => rule.required().min(1).max(TIER_LIMITS.features),
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
    select: {title: 'name', price: 'price', tier: 'tier', enabled: 'enabled'},
    prepare: ({title, price, tier, enabled}) => ({
      title: title || TIER_TITLES[tier] || '(no name)',
      subtitle: [price, enabled === false ? 'hidden' : null].filter(Boolean).join(' · '),
    }),
  },
})
