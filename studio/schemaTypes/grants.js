// Grants & Funding page: the funding types (the twelve tiles) and the programmes (the opportunity cards).
// Published as backend/config/content.json -> api/v1/content.json (grants), which js/fundsae-connector.js puts into
// the Grants & Funding page and the home page's funding tiles. With nothing published the pages keep their built-in
// content. Limits and lists: GRANTS_LIMITS, FUNDING_TYPES, FUNDING_KINDS and FUNDING_PLACES in rules.js (equal to
// the backend's; test/cms.test.js checks).
//
// Privacy: everything here is public (the dataset is public and these documents have no dot in their id). Describe
// programmes and organisations only; never enter a person's name, phone number or personal email.

import {defineField, defineType} from 'sanity'
import {FUNDING_KINDS, FUNDING_PLACES, FUNDING_TYPES, GRANTS_LIMITS} from './rules.js'
import {httpsRule, idRule, maxPerGroup, textRule} from './validators.js'

const PUBLIC_NOTE = 'Shown on the public website and readable by anyone: describe organisations only, no personal details.'
const label = (list, value) => (list.find((o) => o.value === value) || {}).title || value

export const fundingType = defineType({
  name: 'fundingType',
  title: 'Type of funding',
  type: 'document',
  description: `One of the twelve type tiles on the Grants & Funding page and the home page. ${PUBLIC_NOTE}`,
  validation: maxPerGroup({
    type: 'fundingType',
    field: 'typeId',
    max: 1,
    label: (doc) => `The "${label(FUNDING_TYPES, doc.typeId)}" tile`,
  }),
  fields: [
    defineField({
      name: 'typeId',
      title: 'Which tile',
      type: 'string',
      description: 'Each tile keeps its icon; this only changes its words, order and whether it shows.',
      options: {list: FUNDING_TYPES},
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (rule) => textRule(rule, GRANTS_LIMITS.typeTitle),
    }),
    defineField({
      name: 'description',
      title: 'One-line description',
      type: 'string',
      validation: (rule) => textRule(rule, GRANTS_LIMITS.typeDescription),
    }),
    defineField({name: 'position', title: 'Order', type: 'number', initialValue: 10, validation: (rule) => rule.integer().min(0).max(999)}),
    defineField({name: 'enabled', title: 'Show on the site', type: 'boolean', initialValue: true}),
  ],
  orderings: [{title: 'Order', name: 'position', by: [{field: 'position', direction: 'asc'}]}],
  preview: {
    select: {title: 'title', typeId: 'typeId', description: 'description', enabled: 'enabled'},
    prepare: ({title, typeId, description, enabled}) => ({
      title: `${title || label(FUNDING_TYPES, typeId) || '(no title)'}${enabled === false ? ' (hidden)' : ''}`,
      subtitle: description,
    }),
  },
})

export const fundingProgramme = defineType({
  name: 'fundingProgramme',
  title: 'Funding programme',
  type: 'document',
  description: `One opportunity card on the Grants & Funding page. ${PUBLIC_NOTE}`,
  fields: [
    defineField({
      name: 'provider',
      title: 'Programme or provider name',
      type: 'string',
      description: 'The organisation or programme, for example "Crescent Innovation Fund". Not a person.',
      validation: (rule) => textRule(rule, GRANTS_LIMITS.provider),
    }),
    defineField({
      name: 'id',
      title: 'Id',
      type: 'slug',
      options: {source: 'provider', maxLength: 61},
      validation: idRule,
    }),
    defineField({
      name: 'kind',
      title: 'What it offers',
      type: 'string',
      options: {list: FUNDING_KINDS, layout: 'radio', direction: 'horizontal'},
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'place',
      title: 'Where it applies',
      type: 'string',
      options: {list: FUNDING_PLACES},
      initialValue: 'uae',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'types',
      title: 'Types of funding',
      type: 'array',
      of: [{type: 'string'}],
      description: `The tiles this programme is counted under (${GRANTS_LIMITS.types[0]} to ${GRANTS_LIMITS.types[1]}).`,
      options: {list: FUNDING_TYPES},
      validation: (rule) => rule.required().min(GRANTS_LIMITS.types[0]).max(GRANTS_LIMITS.types[1]).unique(),
    }),
    defineField({
      name: 'description',
      title: 'Short description',
      type: 'text',
      rows: 3,
      description: `What it offers and to whom, in your own words (${GRANTS_LIMITS.description[0]} to ${GRANTS_LIMITS.description[1]} characters).`,
      validation: (rule) => textRule(rule, GRANTS_LIMITS.description),
    }),
    defineField({
      name: 'url',
      title: 'Link to the programme',
      type: 'url',
      description: 'The provider\'s https page. Leave empty to show "View details" as coming soon.',
      validation: (rule) => httpsRule(rule),
    }),
    defineField({name: 'featured', title: 'Featured', type: 'boolean', initialValue: false, description: 'Highlighted at the top of the list.'}),
    defineField({name: 'position', title: 'Order', type: 'number', initialValue: 10, validation: (rule) => rule.integer().min(0).max(999)}),
    defineField({name: 'enabled', title: 'Show on the site', type: 'boolean', initialValue: true}),
  ],
  orderings: [{title: 'Order', name: 'position', by: [{field: 'position', direction: 'asc'}]}],
  preview: {
    select: {title: 'provider', kind: 'kind', place: 'place', featured: 'featured', enabled: 'enabled'},
    prepare: ({title, kind, place, featured, enabled}) => ({
      title: `${title || '(no name)'}${featured ? ' ★' : ''}${enabled === false ? ' (hidden)' : ''}`,
      subtitle: [label(FUNDING_KINDS, kind), label(FUNDING_PLACES, place)].filter(Boolean).join(' · '),
    }),
  },
})
