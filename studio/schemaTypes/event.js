// An event for "Events and Expos" (home page) and the Events page.
// Published as backend/config/events.json -> api/v1/events.json.
// Fields match EventRecord in backend/src/contracts/models.js.

import {defineField, defineType} from 'sanity'
import {EVENT_LIMITS} from './rules.js'
import {httpsRule, idRule, textRule} from './validators.js'

const DAY = 86_400_000

/** YYYY-MM-DD within [today + min, today + max] days, as the backend checks it. */
function dateWindow(rule, [minDays, maxDays], {required}) {
  const r = required ? rule.required() : rule
  return r.custom((value) => {
    if (!value) return true
    const now = new Date()
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const t = Date.parse(`${value}T00:00:00Z`)
    if (t < today + minDays * DAY) return 'This date is too far in the past.'
    if (t > today + maxDays * DAY) return 'This date is too far in the future.'
    return true
  })
}

export const event = defineType({
  name: 'event',
  title: 'Event',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Event name',
      type: 'string',
      validation: (rule) => textRule(rule, EVENT_LIMITS.title),
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
      name: 'eventType',
      title: 'Event type',
      type: 'string',
      description: 'Short label for the "Event Type" column, for example Roundtable or Finance week.',
      validation: (rule) => textRule(rule, EVENT_LIMITS.eventType),
    }),
    defineField({
      name: 'startDate',
      title: 'Start date',
      type: 'date',
      description: 'UAE calendar date.',
      options: {dateFormat: 'YYYY-MM-DD'},
      validation: (rule) => dateWindow(rule, EVENT_LIMITS.startDateDays, {required: true}),
    }),
    defineField({
      name: 'endDate',
      title: 'End date',
      type: 'date',
      description: 'Only for events that run over several days.',
      options: {dateFormat: 'YYYY-MM-DD'},
      validation: (rule) =>
        dateWindow(rule, EVENT_LIMITS.endDateDays, {required: false}).custom((value, context) => {
          const start = context.document?.startDate
          return !value || !start || value >= start ? true : 'The end date must be on or after the start date.'
        }),
    }),
    defineField({
      name: 'city',
      title: 'City',
      type: 'string',
      validation: (rule) => textRule(rule, EVENT_LIMITS.city),
    }),
    defineField({
      name: 'venue',
      title: 'Venue',
      type: 'string',
      validation: (rule) => textRule(rule, EVENT_LIMITS.venue, {required: false}),
    }),
    defineField({
      name: 'organiser',
      title: 'Organiser',
      type: 'string',
      validation: (rule) => textRule(rule, EVENT_LIMITS.organiser, {required: false}),
    }),
    defineField({
      name: 'url',
      title: "Organiser's page",
      type: 'url',
      description: 'https:// only.',
      validation: (rule) => httpsRule(rule),
    }),
    defineField({
      name: 'featured',
      title: 'Featured',
      type: 'boolean',
      initialValue: false,
    }),
  ],
  orderings: [{title: 'Start date', name: 'startDate', by: [{field: 'startDate', direction: 'asc'}]}],
  preview: {
    select: {title: 'title', startDate: 'startDate', city: 'city'},
    prepare: ({title, startDate, city}) => ({title, subtitle: [startDate, city].filter(Boolean).join(' · ')}),
  },
})
