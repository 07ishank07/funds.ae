// The two news category systems: Capital Types (who provides the capital) and Asset
// Classes (what it is invested in). Editors can add, rename, reorder and delete them.
// Published as backend/config/news-taxonomy.json by `npm run cms:pull`, which validates
// them again (backend/src/config.js validateNewsTaxonomy). Stories point at these documents
// by reference, so renaming one keeps every story's tags.

import {defineArrayMember, defineField, defineType} from 'sanity'
import {NEWS_HOME_SECTIONS, NEWS_HOME_SECTION_LABELS, NEWS_LIMITS} from './newsRules.js'
import {ID_PATTERN} from './rules.js'
import {textRule} from './validators.js'

const [minWeight, maxWeight] = NEWS_LIMITS.keywordWeight

const keywordsField = defineField({
  name: 'keywords',
  title: 'Keywords for automatic tagging',
  type: 'array',
  description:
    'When one of these appears in a new story, the story is suggested for this category. A keyword in the headline counts double. ' +
    'Weight 3 = strong signal (a fund name), 1 = weak. Matching ignores case and simple plurals.',
  of: [
    defineArrayMember({
      type: 'object',
      name: 'keyword',
      fields: [
        defineField({
          name: 'term',
          title: 'Keyword',
          type: 'string',
          validation: (rule) =>
            textRule(rule, NEWS_LIMITS.keyword).custom((value) =>
              !value || value === value.toLowerCase() ? true : 'Use lowercase letters.',
            ),
        }),
        defineField({
          name: 'weight',
          title: 'Weight',
          type: 'number',
          initialValue: 2,
          validation: (rule) => rule.required().integer().min(minWeight).max(maxWeight),
        }),
      ],
      preview: {
        select: {term: 'term', weight: 'weight'},
        prepare: ({term, weight}) => ({title: `${term || '(empty)'}  ·  ${weight ?? '?'}`}),
      },
    }),
  ],
  validation: (rule) =>
    rule.max(NEWS_LIMITS.keywords).custom((list) => {
      const terms = (list || []).map((k) => k?.term).filter(Boolean)
      return new Set(terms).size === terms.length ? true : 'Each keyword can be listed once.'
    }),
})

const sharedFields = (example) => [
  defineField({
    name: 'name',
    title: 'Name',
    type: 'string',
    description: `Shown on the website, for example "${example}".`,
    validation: (rule) => textRule(rule, NEWS_LIMITS.categoryName),
  }),
  defineField({
    name: 'id',
    title: 'Web address id',
    type: 'slug',
    options: {source: 'name', maxLength: 61},
    description:
      'Used in website links and filters (?capital=… / ?asset=…). Generate it from the name; changing it later breaks old links, not the tags on stories.',
    validation: (rule) =>
      rule.required().custom((value) => {
        const id = value?.current
        if (!id) return 'Generate an id from the name.'
        return ID_PATTERN.test(id) ? true : 'Use lowercase letters, numbers and dashes (2 to 61 characters).'
      }),
  }),
  defineField({
    name: 'description',
    title: 'Description',
    type: 'text',
    rows: 2,
    validation: (rule) => textRule(rule, NEWS_LIMITS.categoryDescription, {required: false}),
  }),
  defineField({
    name: 'displayOrder',
    title: 'Display order',
    type: 'number',
    description: 'Lower numbers come first, in the Studio, in website filters and in the category bar.',
    initialValue: 500,
    validation: (rule) => rule.required().integer().min(NEWS_LIMITS.displayOrder[0]).max(NEWS_LIMITS.displayOrder[1]),
  }),
]

const byOrder = [{title: 'Display order', name: 'displayOrder', by: [{field: 'displayOrder', direction: 'asc'}, {field: 'name', direction: 'asc'}]}]

export const capitalType = defineType({
  name: 'capitalType',
  title: 'Capital Type',
  type: 'document',
  fields: [
    ...sharedFields('Sovereign Wealth Funds'),
    defineField({
      name: 'showInNav',
      title: 'Show in the category bar',
      type: 'boolean',
      description: `The bar under the masthead on every page. Up to ${NEWS_LIMITS.navItems} types fit.`,
      initialValue: false,
    }),
    defineField({
      name: 'navLabel',
      title: 'Category bar label',
      type: 'string',
      description: 'A short label for the bar, for example "Sovereign".',
      hidden: ({document}) => !document?.showInNav,
      validation: (rule) =>
        rule.custom((value, {document}) => {
          if (!document?.showInNav) return true
          const [min, max] = NEWS_LIMITS.navLabel
          const text = value || ''
          if (text.length < min || text.length > max) return `Write a bar label of ${min}-${max} characters.`
          return text === text.trim() ? true : 'Remove spaces at the start or end.'
        }),
    }),
    keywordsField,
  ],
  orderings: byOrder,
  preview: {
    select: {title: 'name', order: 'displayOrder', nav: 'showInNav', label: 'navLabel'},
    prepare: ({title, order, nav, label}) => ({
      title: title || '(no name)',
      subtitle: `${order ?? '?'}${nav ? ` · category bar: ${label || title}` : ''}`,
    }),
  },
})

export const assetClass = defineType({
  name: 'assetClass',
  title: 'Asset Class',
  type: 'document',
  fields: [
    ...sharedFields('Data Centres'),
    defineField({
      name: 'homeSection',
      title: 'Home page box',
      type: 'string',
      description: 'Stories with this Asset Class also appear in this home page box.',
      options: {
        list: [
          ...NEWS_HOME_SECTIONS.map((value) => ({value, title: NEWS_HOME_SECTION_LABELS[value]})),
          {value: 'none', title: 'None (Real Estate Capital News page only)'},
        ],
        layout: 'radio',
      },
      initialValue: 'none',
      validation: (rule) => rule.required(),
    }),
    keywordsField,
  ],
  orderings: byOrder,
  preview: {
    select: {title: 'name', order: 'displayOrder', section: 'homeSection'},
    prepare: ({title, order, section}) => ({
      title: title || '(no name)',
      subtitle: `${order ?? '?'} · ${NEWS_HOME_SECTION_LABELS[section] || 'no home box'}`,
    }),
  },
})
