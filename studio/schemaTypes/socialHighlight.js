// One row of the home page "Top Tweets" box. Editors write their own short line
// about the post and link to it; the post's text is never copied here.
// Published as backend/config/content.json -> api/v1/content.json (slots.socialHighlights).

import {defineField, defineType} from 'sanity'
import {HIGHLIGHT_LIMITS} from './rules.js'
import {hexRule, idRule, maxPerGroup, textRule} from './validators.js'

const POST_URL = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,25}(?:[/?#].*)?$/

export const socialHighlight = defineType({
  name: 'socialHighlight',
  title: 'Top Tweets item',
  type: 'document',
  validation: maxPerGroup({
    type: 'socialHighlight',
    field: '_type',
    max: HIGHLIGHT_LIMITS.maxItems,
    label: () => 'The Top Tweets box',
  }),
  fields: [
    defineField({
      name: 'accountName',
      title: 'Account name',
      type: 'string',
      description: 'As shown on the account, for example "Abu Dhabi Finance".',
      validation: (rule) => textRule(rule, HIGHLIGHT_LIMITS.accountName),
    }),
    defineField({
      name: 'handle',
      title: 'Handle',
      type: 'string',
      description: 'Without the @, for example adfinance.',
      validation: (rule) =>
        textRule(rule, HIGHLIGHT_LIMITS.handle).regex(/^[A-Za-z0-9_]+$/, {name: 'handle'}),
    }),
    defineField({
      name: 'id',
      title: 'Id',
      type: 'slug',
      options: {source: 'accountName', maxLength: 61},
      validation: idRule,
    }),
    defineField({
      name: 'text',
      title: 'Our one-line summary',
      type: 'text',
      rows: 2,
      description:
        'Write it in your own words (up to 140 characters). Do not paste the post itself; readers follow the link to read it.',
      validation: (rule) => textRule(rule, HIGHLIGHT_LIMITS.text),
    }),
    defineField({
      name: 'url',
      title: 'Link to the post',
      type: 'url',
      description: 'https://x.com/<handle>/status/<number>',
      validation: (rule) =>
        rule
          .required()
          .uri({scheme: ['https']})
          .custom((value) => (!value || POST_URL.test(value) ? true : 'Use the link to one post on x.com.')),
    }),
    defineField({
      name: 'initials',
      title: 'Avatar initials',
      type: 'string',
      description: 'One to three letters shown in the round avatar.',
      validation: (rule) => textRule(rule, HIGHLIGHT_LIMITS.initials).regex(/^[A-Z0-9]+$/, {name: 'capital letters'}),
    }),
    defineField({
      name: 'color',
      title: 'Avatar colour',
      type: 'string',
      description: 'Hex colour such as #356A78.',
      validation: hexRule,
    }),
    defineField({name: 'position', title: 'Order', type: 'number', initialValue: 10, validation: (rule) => rule.integer().min(0).max(999)}),
    defineField({name: 'enabled', title: 'Show on the site', type: 'boolean', initialValue: true}),
  ],
  orderings: [{title: 'Order', name: 'position', by: [{field: 'position', direction: 'asc'}]}],
  preview: {
    select: {title: 'accountName', handle: 'handle', text: 'text', enabled: 'enabled'},
    prepare: ({title, handle, text, enabled}) => ({
      title: `${title || '(no name)'}${handle ? ` @${handle}` : ''}${enabled === false ? ' (hidden)' : ''}`,
      subtitle: text,
    }),
  },
})
