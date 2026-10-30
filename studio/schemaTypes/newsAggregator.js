// Three single documents for the news aggregator (fixed ids, created by the seed):
//   newsAggregator       editor-owned: the "Fetch News Now" button records a request here; the
//                        Sanity webhook turns it into a "news-fetch" run of the News ingest action.
//   newsAggregatorState  importer-owned, read-only: last run, per-source health, document count.
//   newsPublishSignal    touched by the workflow actions after every status change; the webhook
//                        turns it into a "cms-publish" run that republishes the site's news.
// None of them holds story content, so they can stay readable on a public dataset.

import {defineArrayMember, defineField, defineType} from 'sanity'

const locked = {readOnly: true}

export const newsAggregator = defineType({
  name: 'newsAggregator',
  title: 'News aggregator',
  type: 'document',
  fields: [
    defineField({
      name: 'help',
      title: 'How it works',
      type: 'text',
      rows: 2,
      ...locked,
      initialValue: 'Sources are fetched once a day at 9:00 am Sydney time. Press "Fetch News Now" (bottom right) to fetch them now; new stories arrive in Pending review within a few minutes.',
    }),
    defineField({name: 'fetchRequestedAt', title: 'Last "Fetch News Now"', type: 'datetime', ...locked}),
    defineField({name: 'fetchRequestedBy', title: 'Requested by', type: 'string', ...locked}),
  ],
  preview: {prepare: () => ({title: 'News aggregator'})},
})

export const newsAggregatorState = defineType({
  name: 'newsAggregatorState',
  title: 'Aggregator status',
  type: 'document',
  ...locked,
  fields: [
    defineField({name: 'updatedAt', title: 'Last run finished', type: 'datetime'}),
    defineField({
      name: 'lastRun',
      title: 'Last run',
      type: 'object',
      fields: [
        defineField({name: 'status', title: 'Result', type: 'string'}),
        defineField({name: 'fetched', title: 'Items fetched', type: 'number'}),
        defineField({name: 'queued', title: 'New stories queued', type: 'number'}),
        defineField({name: 'attached', title: 'Reports attached to queued stories', type: 'number'}),
        defineField({name: 'duplicates', title: 'Duplicates skipped', type: 'number'}),
        defineField({name: 'pruned', title: 'Stale stories removed', type: 'number'}),
        defineField({name: 'failedSources', title: 'Sources that failed', type: 'number'}),
        defineField({name: 'totalSources', title: 'Sources fetched', type: 'number'}),
      ],
    }),
    defineField({
      name: 'documents',
      title: 'Documents in Sanity',
      type: 'object',
      description: 'The Sanity Free plan holds 10,000 documents. New stories stop at the budget below; reject or archive stories to make room.',
      fields: [
        defineField({name: 'count', title: 'Now', type: 'number'}),
        defineField({name: 'warnAt', title: 'Warning at', type: 'number'}),
        defineField({name: 'stopCreatesAt', title: 'New stories stop at', type: 'number'}),
      ],
    }),
    defineField({
      name: 'sources',
      title: 'Source health',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'sourceHealth',
          fields: [
            defineField({name: 'id', title: 'Source', type: 'string'}),
            defineField({name: 'status', title: 'Status', type: 'string'}),
            defineField({name: 'lastSuccessAt', title: 'Last success', type: 'datetime'}),
            defineField({name: 'lastFetchedAt', title: 'Last attempt', type: 'datetime'}),
            defineField({name: 'lastFailureAt', title: 'Last failure', type: 'datetime'}),
            defineField({name: 'lastError', title: 'Last error', type: 'string'}),
            defineField({name: 'consecutiveFailures', title: 'Failures in a row', type: 'number'}),
            defineField({name: 'pausedUntil', title: 'Paused until', type: 'datetime'}),
            defineField({name: 'lastItemCount', title: 'Items last time', type: 'number'}),
            defineField({name: 'etag', title: 'ETag', type: 'string'}),
            defineField({name: 'lastModified', title: 'Last-Modified', type: 'string'}),
            defineField({name: 'format', title: 'Format', type: 'string'}),
          ],
          preview: {
            select: {title: 'id', status: 'status', error: 'lastError'},
            prepare: ({title, status, error}) => ({title, subtitle: `${status || ''}${error ? ` · ${error}` : ''}`}),
          },
        }),
      ],
    }),
  ],
  preview: {
    select: {updatedAt: 'updatedAt', status: 'lastRun.status'},
    prepare: ({updatedAt, status}) => ({title: 'Aggregator status', subtitle: `${status || 'no run yet'} · ${updatedAt?.slice(0, 16) || ''}`}),
  },
})

export const newsPublishSignal = defineType({
  name: 'newsPublishSignal',
  title: 'News publish signal',
  type: 'document',
  ...locked,
  fields: [
    defineField({name: 'changedAt', title: 'Last story status change', type: 'datetime'}),
    defineField({name: 'action', title: 'Action', type: 'string'}),
  ],
})
