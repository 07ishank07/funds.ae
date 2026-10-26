// One news source (an RSS feed). Editors switch sources on and off, set their priority
// and record licence decisions here. Published as backend/config/sources.news.json by
// `npm run cms:pull`, which validates every source again with the backend's rules
// (backend/src/config.js); the git history of that file is the audit trail.
// Fetch health (last success, last error) is written by the importer to the
// newsAggregatorState document and shown read-only on each source.

import {defineField, defineType} from 'sanity'
import {SourceHealthInput} from '../components/SourceHealth.jsx'
import {
  NEWS_LICENSE_STATUSES,
  NEWS_SOURCE_FOCUSES,
  NEWS_SOURCE_REGIONS,
  NEWS_SOURCE_TIERS,
  NEWS_SOURCE_TYPES,
  PUBLISHABLE_LICENSE_STATUSES,
} from './newsRules.js'
import {ID_PATTERN} from './rules.js'
import {httpsRule, textRule} from './validators.js'

const LICENSE_TITLES = {
  public_sector: 'Public sector (government or regulator)',
  wire: 'Press-release wire',
  terms_reviewed: 'Terms reviewed and allow this use',
  permission_granted: 'Permission granted by the publisher',
  pending_review: 'Pending review (stories cannot be published)',
  blocked: 'Blocked (must be switched off)',
}
const TIER_TITLES = {L1: 'L1 official / regulator', L2: 'L2 press-release wire', L3: 'L3 publisher RSS', L4: 'L4 licensed API', L5: 'L5 paid syndication'}
const today = () => new Date().toISOString().slice(0, 10)

export const newsSource = defineType({
  name: 'newsSource',
  title: 'News source',
  type: 'document',
  groups: [
    {name: 'feed', title: 'Feed', default: true},
    {name: 'licence', title: 'Licence'},
    {name: 'health', title: 'Health'},
  ],
  validation: (rule) =>
    rule.custom((doc) => {
      if (!doc) return true
      if (doc.licenseStatus === 'blocked' && doc.enabled !== false) return 'A blocked source must be switched off.'
      if (doc.type === 'api' && doc.enabled !== false) return 'API sources have no importer yet; keep them switched off.'
      return true
    }),
  fields: [
    defineField({name: 'name', title: 'Name', type: 'string', group: 'feed', validation: (rule) => textRule(rule, [2, 80])}),
    defineField({
      name: 'id',
      title: 'Id',
      type: 'slug',
      group: 'feed',
      options: {source: 'name', maxLength: 61},
      description: 'Stories record which source they came from by this id. Keep it once the source is in use.',
      validation: (rule) =>
        rule.required().custom((value) => (ID_PATTERN.test(value?.current || '') ? true : 'Use lowercase letters, numbers and dashes.')),
    }),
    defineField({
      name: 'enabled',
      title: 'Fetch this source',
      type: 'boolean',
      group: 'feed',
      initialValue: false,
      description: 'Switch off to stop fetching (its history is kept). Say why in the notes.',
    }),
    defineField({name: 'homepage', title: 'Website', type: 'url', group: 'feed', validation: (rule) => httpsRule(rule, {required: true})}),
    defineField({
      name: 'url',
      title: 'Feed address',
      type: 'url',
      group: 'feed',
      description: 'The RSS or Atom feed (https). Never a page that has to be scraped.',
      validation: (rule) => httpsRule(rule, {required: true}),
    }),
    defineField({
      name: 'type',
      title: 'Type',
      type: 'string',
      group: 'feed',
      options: {list: NEWS_SOURCE_TYPES.map((value) => ({value, title: value === 'rss' ? 'RSS or Atom feed' : 'Licensed API (no importer yet)'})), layout: 'radio'},
      initialValue: 'rss',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'priority',
      title: 'Priority',
      type: 'number',
      group: 'feed',
      description: '1 = most authoritative. When several outlets cover a story, the lowest number leads (original reporting first).',
      initialValue: 2,
      validation: (rule) => rule.required().integer().min(1).max(9),
    }),
    defineField({
      name: 'region',
      title: 'Default region',
      type: 'string',
      group: 'feed',
      description: '"UAE" nudges unclear stories towards UAE news.',
      options: {list: NEWS_SOURCE_REGIONS.map((value) => ({value, title: value === 'uae' ? 'UAE' : 'Global'})), layout: 'radio'},
      initialValue: 'global',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'focus',
      title: 'Focus',
      type: 'string',
      group: 'feed',
      description: 'Specialist outlets pass a looser relevance filter than general business news.',
      options: {list: NEWS_SOURCE_FOCUSES.map((value) => ({value, title: value === 'private-markets' ? 'Private markets specialist' : 'General business'})), layout: 'radio'},
      initialValue: 'general-business',
      validation: (rule) => rule.required(),
    }),
    defineField({name: 'verified', title: 'Feed checked', type: 'boolean', group: 'feed', initialValue: false}),
    defineField({
      name: 'language',
      title: 'Language',
      type: 'string',
      group: 'feed',
      initialValue: 'en',
      validation: (rule) => rule.required().regex(/^[a-z]{2}$/, {name: 'two-letter code'}),
    }),
    defineField({
      name: 'pollEveryHours',
      title: 'Check every (hours)',
      type: 'number',
      group: 'feed',
      initialValue: 24,
      validation: (rule) => rule.integer().min(1).max(168),
    }),
    defineField({name: 'section', title: 'Registry section (note)', type: 'string', group: 'feed', description: 'A note for people, e.g. "C. UAE/GCC".'}),
    defineField({name: 'notes', title: 'Notes', type: 'text', rows: 3, group: 'feed'}),

    defineField({
      name: 'tier',
      title: 'Tier',
      type: 'string',
      group: 'licence',
      options: {list: NEWS_SOURCE_TIERS.map((value) => ({value, title: TIER_TITLES[value]}))},
      initialValue: 'L3',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'licenseStatus',
      title: 'Licence status',
      type: 'string',
      group: 'licence',
      description: `Stories can be published only from: ${PUBLISHABLE_LICENSE_STATUSES.join(', ')}. Keep "pending review" until you have read the publisher's terms.`,
      options: {list: NEWS_LICENSE_STATUSES.map((value) => ({value, title: LICENSE_TITLES[value]}))},
      initialValue: 'pending_review',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'termsUrl',
      title: 'Terms read (link)',
      type: 'url',
      group: 'licence',
      validation: (rule) =>
        httpsRule(rule).custom((value, {document}) =>
          document?.licenseStatus === 'terms_reviewed' && !value ? 'Link the terms you read.' : true,
        ),
    }),
    defineField({
      name: 'termsReviewedAt',
      title: 'Terms reviewed on',
      type: 'date',
      group: 'licence',
      validation: (rule) =>
        rule.custom((value, {document}) => {
          if (['terms_reviewed', 'permission_granted'].includes(document?.licenseStatus) && !value) return 'Give the date you checked.'
          return !value || value <= today() ? true : 'The date cannot be in the future.'
        }),
    }),
    defineField({
      name: 'allowExcerpt',
      title: "Show the publisher's excerpt",
      type: 'boolean',
      group: 'licence',
      initialValue: true,
      description: 'Off: headline and link only.',
    }),
    defineField({
      name: 'allowImages',
      title: "Show images from the publisher's feed",
      type: 'boolean',
      group: 'licence',
      initialValue: false,
      description: 'Only when the terms allow it. Images are linked from the publisher, never copied.',
    }),
    defineField({
      name: 'allowAiSummary',
      title: 'Allow AI summaries',
      type: 'boolean',
      group: 'licence',
      initialValue: false,
      description: 'Many publishers forbid AI summarisation of their content. Switch on only when the terms allow it.',
    }),

    defineField({
      name: 'health',
      title: 'Fetch health',
      type: 'string',
      group: 'health',
      readOnly: true,
      description: 'Written by the importer after each run. Nothing to edit here.',
      components: {input: SourceHealthInput},
    }),
  ],
  orderings: [{title: 'Name', name: 'name', by: [{field: 'name', direction: 'asc'}]}],
  preview: {
    select: {title: 'name', enabled: 'enabled', licence: 'licenseStatus', priority: 'priority'},
    prepare: ({title, enabled, licence, priority}) => ({
      title: `${title || '(no name)'}${enabled === false ? ' (off)' : ''}`,
      subtitle: `${licence || 'no licence status'} · priority ${priority ?? '?'}`,
    }),
  },
})
