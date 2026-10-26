// One story in the News Review Queue. The importer creates it (under a private
// "queue.<articleId>" id) as Pending review; editors work on the Editorial tab; only the
// workflow actions (studio/actions/newsActions.jsx) change its status. The Source,
// Classification and Workflow tabs are read-only provenance. Field ownership:
// newsRules.js (NEWS_INGEST_FIELDS, NEWS_EDITORIAL_FIELDS, NEWS_WORKFLOW_FIELDS).
// How the queue works: docs/NEWS-REVIEW-GUIDE.md.

import {defineArrayMember, defineField, defineType} from 'sanity'
import {
  NEWS_GEOGRAPHIES,
  NEWS_GEOGRAPHY_LABELS,
  NEWS_LIMITS,
  NEWS_SLUG_PATTERN,
  NEWS_STATUS_LABELS,
  NEWS_STATUSES,
  NEWS_SUMMARY_SOURCES,
  NEWS_TRANSACTION_LABELS,
  NEWS_TRANSACTION_TYPES,
} from './newsRules.js'
import {imageRule, textRule} from './validators.js'

const locked = {readOnly: true}
const uniqueRefs = (rule) =>
  rule.custom((list) => {
    const refs = (list || []).map((r) => r?._ref).filter(Boolean)
    return new Set(refs).size === refs.length ? true : 'Each category can be added once.'
  })

/** "Scheduled" is a published story whose time has not come yet. */
export function statusLabel(status, publishedAt) {
  if (status === 'published' && publishedAt && new Date(publishedAt) > new Date()) return 'Scheduled'
  return NEWS_STATUS_LABELS[status] || 'Pending review'
}

const sourceEntry = defineArrayMember({
  type: 'object',
  name: 'otherSource',
  fields: [
    defineField({name: 'sourceName', title: 'Outlet', type: 'string'}),
    defineField({name: 'title', title: 'Their headline', type: 'string'}),
    defineField({name: 'url', title: 'Link', type: 'url'}),
    defineField({name: 'publishedAt', title: 'Published', type: 'datetime'}),
    defineField({name: 'attachedAt', title: 'Found by the importer', type: 'datetime'}),
    defineField({name: 'sourceId', title: 'Source id', type: 'string'}),
    defineField({name: 'articleId', title: 'Article id', type: 'string'}),
    defineField({name: 'canonicalUrl', title: 'Canonical link', type: 'string'}),
    defineField({name: 'guid', title: 'Feed guid', type: 'string'}),
  ],
  preview: {
    select: {title: 'title', outlet: 'sourceName', attachedAt: 'attachedAt'},
    prepare: ({title, outlet, attachedAt}) => ({title: title || '(no headline)', subtitle: `${outlet || ''} · found ${attachedAt?.slice(0, 10) || ''}`}),
  },
})

export const newsArticle = defineType({
  name: 'newsArticle',
  title: 'News story',
  type: 'document',
  groups: [
    {name: 'editorial', title: 'Editorial', default: true},
    {name: 'source', title: 'Source'},
    {name: 'classification', title: 'Classification'},
    {name: 'workflow', title: 'Workflow'},
  ],
  fields: [
    /* ------------------------------- editorial ------------------------------- */
    defineField({
      name: 'headline',
      title: 'Headline',
      type: 'string',
      group: 'editorial',
      description: 'Starts as the publisher\'s headline (kept on the Source tab). Edit for clarity; never add claims the source does not make.',
      validation: (rule) => textRule(rule, NEWS_LIMITS.headline),
    }),
    defineField({
      name: 'summary',
      title: 'Summary',
      type: 'text',
      rows: 4,
      group: 'editorial',
      description: `Up to ${NEWS_LIMITS.summary[1]} characters, from the headline and excerpt only. Starts as the publisher's excerpt; rewriting it in your own words is better.`,
      validation: (rule) =>
        rule.max(NEWS_LIMITS.summary[1]).custom((value) => {
          if (!value) return 'A story needs a summary before it can be approved.'
          return value.length >= NEWS_LIMITS.summary[0] ? true : `Use at least ${NEWS_LIMITS.summary[0]} characters.`
        }).warning(),
    }),
    defineField({
      name: 'capitalTypes',
      title: 'Capital Types',
      type: 'array',
      group: 'editorial',
      description: 'Who provides the capital. Several allowed; leave empty when the story does not say.',
      of: [defineArrayMember({type: 'reference', to: [{type: 'capitalType'}], weak: true})],
      validation: uniqueRefs,
    }),
    defineField({
      name: 'assetClasses',
      title: 'Asset Classes',
      type: 'array',
      group: 'editorial',
      description: 'What the capital is invested in. Stories with at least one appear on the Real Estate Capital News page.',
      of: [defineArrayMember({type: 'reference', to: [{type: 'assetClass'}], weak: true})],
      validation: uniqueRefs,
    }),
    defineField({
      name: 'geography',
      title: 'Geography',
      type: 'array',
      group: 'editorial',
      description: 'Ticking UAE files the story under UAE Stories; otherwise it is a Global story.',
      of: [defineArrayMember({type: 'string'})],
      options: {list: NEWS_GEOGRAPHIES.map((value) => ({value, title: NEWS_GEOGRAPHY_LABELS[value]})), layout: 'grid'},
    }),
    defineField({
      name: 'transactionType',
      title: 'Transaction type',
      type: 'string',
      group: 'editorial',
      options: {list: NEWS_TRANSACTION_TYPES.map((value) => ({value, title: NEWS_TRANSACTION_LABELS[value]}))},
    }),
    defineField({
      name: 'slug',
      title: 'Web address',
      type: 'slug',
      group: 'editorial',
      description: 'The story page is /news/<this>.html. Suggested from the headline; it cannot change once the story has been published.',
      options: {source: 'headline', maxLength: NEWS_LIMITS.slug[1]},
      readOnly: ({document}) => Boolean(document?.firstPublishedAt),
      validation: (rule) =>
        rule.required().custom((value) =>
          NEWS_SLUG_PATTERN.test(value?.current || '') && value.current.length <= NEWS_LIMITS.slug[1]
            ? true
            : 'Use lowercase letters, numbers and single dashes.',
        ),
    }),
    defineField({name: 'featured', title: 'Featured story', type: 'boolean', group: 'editorial', initialValue: false, description: 'Shown first on the Real Estate Capital News page.'}),
    defineField({
      name: 'image',
      title: 'Image (optional, rights-cleared only)',
      type: 'image',
      group: 'editorial',
      description: 'Only a picture you have the rights to (your own, or licensed). Never download the publisher\'s photo. PNG, JPG or WebP up to 500 KB.',
      options: {accept: 'image/png,image/jpeg,image/webp'},
      fields: [
        defineField({name: 'credit', title: 'Credit', type: 'string', description: 'Who owns the picture, e.g. "Photo: Example Ltd".'}),
        defineField({name: 'rightsConfirmed', title: 'I confirm we have the rights to use this image', type: 'boolean', initialValue: false}),
      ],
      validation: (rule) =>
        imageRule(rule).custom((value) => {
          if (!value?.asset) return true
          if (value.rightsConfirmed !== true) return 'Confirm the image rights, or remove the image.'
          const [min, max] = NEWS_LIMITS.imageCredit
          const credit = (value.credit || '').trim()
          return credit.length >= min && credit.length <= max ? true : 'Add an image credit.'
        }),
    }),
    defineField({
      name: 'duplicateOf',
      title: 'Duplicate of',
      type: 'reference',
      group: 'editorial',
      to: [{type: 'newsArticle'}],
      weak: true,
      description: 'If another story already covers this, point to it and reject this one.',
    }),
    defineField({
      name: 'seo',
      title: 'Search engines',
      type: 'object',
      group: 'editorial',
      options: {collapsible: true, collapsed: true},
      fields: [
        defineField({name: 'title', title: 'Page title', type: 'string', description: 'Defaults to the headline.', validation: (rule) => rule.max(NEWS_LIMITS.seoTitle[1])}),
        defineField({name: 'description', title: 'Description', type: 'text', rows: 2, description: 'Defaults to the summary.', validation: (rule) => rule.max(NEWS_LIMITS.seoDescription[1])}),
      ],
    }),
    defineField({name: 'editorNotes', title: 'Notes for editors', type: 'text', rows: 3, group: 'editorial', description: 'Never shown on the site.', validation: (rule) => rule.max(NEWS_LIMITS.editorNotes[1])}),

    /* ------------------------- source (read-only provenance) ------------------------- */
    defineField({name: 'originalHeadline', title: 'Publisher\'s headline', type: 'string', group: 'source', ...locked}),
    defineField({name: 'originalUrl', title: 'Original article', type: 'url', group: 'source', ...locked, description: 'Open it to read the full story at the publisher.'}),
    defineField({name: 'sourceName', title: 'Source', type: 'string', group: 'source', ...locked}),
    defineField({name: 'source', title: 'Source settings', type: 'reference', to: [{type: 'newsSource'}], weak: true, group: 'source', ...locked}),
    defineField({name: 'sourcePublishedAt', title: 'Published by the source', type: 'datetime', group: 'source', ...locked}),
    defineField({name: 'dateEstimated', title: 'Publication date estimated (the feed gave none)', type: 'boolean', group: 'source', ...locked}),
    defineField({name: 'excerpt', title: 'Publisher\'s excerpt', type: 'text', rows: 3, group: 'source', ...locked}),
    defineField({name: 'sourceImageUrl', title: 'Image in the publisher\'s feed', type: 'url', group: 'source', ...locked, description: 'Shown only while the source allows images.'}),
    defineField({name: 'otherSources', title: 'Also reported by', type: 'array', group: 'source', ...locked, of: [sourceEntry], description: 'Outlets found after approval appear on the site only once the story is approved again.'}),
    defineField({name: 'importedAt', title: 'Imported', type: 'datetime', group: 'source', ...locked}),
    defineField({name: 'lastSeenAt', title: 'Last seen in a feed', type: 'datetime', group: 'source', ...locked}),
    defineField({name: 'articleId', title: 'Article id', type: 'string', group: 'source', ...locked}),
    defineField({name: 'storyId', title: 'Story id', type: 'string', group: 'source', ...locked}),
    defineField({name: 'canonicalUrl', title: 'Canonical link', type: 'string', group: 'source', ...locked}),
    defineField({name: 'guid', title: 'Feed guid', type: 'string', group: 'source', ...locked}),
    defineField({name: 'dedupeKey', title: 'Duplicate identifier', type: 'string', group: 'source', ...locked}),

    /* ---------------------- classification (read-only suggestions) ---------------------- */
    defineField({
      name: 'classification',
      title: 'Automatic classification',
      type: 'object',
      group: 'classification',
      ...locked,
      fields: [
        defineField({name: 'confidence', title: 'Confidence (0-1)', type: 'number'}),
        defineField({name: 'needsReview', title: 'Needs attention', type: 'boolean'}),
        defineField({name: 'reasons', title: 'Why', type: 'array', of: [defineArrayMember({type: 'string'})]}),
        defineField({name: 'explanation', title: 'Matched keywords', type: 'text', rows: 3}),
        defineField({name: 'method', title: 'Method', type: 'string'}),
        defineField({name: 'suggestedCapitalTypes', title: 'Suggested Capital Types', type: 'array', of: [defineArrayMember({type: 'string'})]}),
        defineField({name: 'suggestedAssetClasses', title: 'Suggested Asset Classes', type: 'array', of: [defineArrayMember({type: 'string'})]}),
        defineField({name: 'suggestedGeography', title: 'Suggested geography', type: 'array', of: [defineArrayMember({type: 'string'})]}),
        defineField({name: 'suggestedTransactionType', title: 'Suggested transaction type', type: 'string'}),
        defineField({name: 'suggestedSummary', title: 'Suggested summary (AI)', type: 'text', rows: 3}),
      ],
    }),
    defineField({name: 'priority', title: 'Queue priority (0-5)', type: 'number', group: 'classification', ...locked}),
    defineField({name: 'summarySource', title: 'Summary written by', type: 'string', group: 'classification', ...locked, options: {list: NEWS_SUMMARY_SOURCES}}),
    defineField({name: 'topic', title: 'Main topic', type: 'string', group: 'classification', ...locked}),
    defineField({name: 'topics', title: 'Topics', type: 'array', group: 'classification', ...locked, of: [defineArrayMember({type: 'string'})]}),
    defineField({name: 'category', title: 'UAE or world (automatic)', type: 'string', group: 'classification', ...locked}),
    defineField({name: 'uaeScore', title: 'UAE score', type: 'number', group: 'classification', ...locked}),
    defineField({name: 'relevanceScore', title: 'Relevance score', type: 'number', group: 'classification', ...locked}),
    defineField({name: 'isPressRelease', title: 'Press release', type: 'boolean', group: 'classification', ...locked}),

    /* --------------------- workflow (set only by the workflow actions) --------------------- */
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      group: 'workflow',
      ...locked,
      description: 'Changed only with the buttons at the bottom of the story (Approve, Publish, Reject…).',
      options: {list: NEWS_STATUSES.map((value) => ({value, title: NEWS_STATUS_LABELS[value]}))},
      initialValue: 'pending_review',
    }),
    defineField({
      name: 'approval',
      title: 'Approval',
      type: 'object',
      group: 'workflow',
      ...locked,
      fields: [
        defineField({name: 'approvedByName', title: 'Approved by', type: 'string'}),
        defineField({name: 'approvedById', title: 'Approver id', type: 'string'}),
        defineField({name: 'approvedAt', title: 'Approved at', type: 'datetime'}),
        defineField({name: 'contentHash', title: 'Approved content fingerprint', type: 'string'}),
      ],
    }),
    defineField({name: 'publishedAt', title: 'On the site from', type: 'datetime', group: 'workflow', ...locked}),
    defineField({name: 'scheduledAt', title: 'Scheduled for', type: 'datetime', group: 'workflow', ...locked}),
    defineField({name: 'firstPublishedAt', title: 'First published', type: 'datetime', group: 'workflow', ...locked}),
    defineField({name: 'publishedById', title: 'Published by (id)', type: 'string', group: 'workflow', ...locked}),
    defineField({name: 'rejectionReason', title: 'Rejection reason', type: 'text', rows: 2, group: 'workflow', ...locked}),
    defineField({name: 'statusChangedAt', title: 'Status changed', type: 'datetime', group: 'workflow', ...locked}),
    defineField({name: 'statusChangedById', title: 'Status changed by (id)', type: 'string', group: 'workflow', ...locked}),
  ],
  orderings: [
    {title: 'Newest import', name: 'importedDesc', by: [{field: 'importedAt', direction: 'desc'}]},
    {title: 'Priority, then newest', name: 'priorityDesc', by: [{field: 'priority', direction: 'desc'}, {field: 'importedAt', direction: 'desc'}]},
    {title: 'Publication date (source)', name: 'sourceDateDesc', by: [{field: 'sourcePublishedAt', direction: 'desc'}]},
  ],
  preview: {
    select: {
      title: 'headline',
      status: 'status',
      publishedAt: 'publishedAt',
      source: 'sourceName',
      date: 'sourcePublishedAt',
      needsReview: 'classification.needsReview',
      confidence: 'classification.confidence',
    },
    prepare: ({title, status, publishedAt, source, date, needsReview, confidence}) => ({
      title: title || '(no headline)',
      subtitle: [
        statusLabel(status, publishedAt),
        source,
        date?.slice(0, 10),
        status === 'pending_review' && needsReview ? `needs attention (${confidence ?? 0})` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    }),
  },
})
