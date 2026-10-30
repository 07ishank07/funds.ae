// The Careers section: posted jobs, employers and the Top Employers / Top Jobs lists on the Careers page.
// Jobs come from Post a Job (the funds.ae server creates them as Pending review under a private "jobs.<id>" id)
// or are added here by an editor. Only the workflow actions (studio/actions/jobActions.jsx) change a job's
// status, and only review approvers can publish. Rules: jobRules.js; how it works: docs/SANITY-CMS-GUIDE.md "Careers".

import {defineArrayMember, defineField, defineType} from 'sanity'
import {
  EMPLOYER_ID_PATTERN,
  JOB_EMPLOYMENT_TYPES,
  JOB_FORM_OPTIONS,
  JOB_LIMITS,
  JOB_SLUG_PATTERN,
  JOB_STATUS_LABELS,
  JOB_STATUSES,
} from './jobRules.js'
import {httpsRule, imageRule, textRule} from './validators.js'

const locked = {readOnly: true}
const list = (values) => ({list: values.map((value) => ({value, title: value}))})
const uniqueRefs = (label) => (rule) =>
  rule.custom((items) => {
    const refs = (items || []).map((r) => r?._ref).filter(Boolean)
    return new Set(refs).size === refs.length ? true : `Each ${label} can be added once.`
  })
const wholeAmount = (rule) => rule.integer().min(1).max(JOB_LIMITS.salaryMax)

export const jobPosting = defineType({
  name: 'jobPosting',
  title: 'Job',
  type: 'document',
  groups: [
    {name: 'role', title: 'The role', default: true},
    {name: 'pay', title: 'Pay and visa'},
    {name: 'details', title: 'Description'},
    {name: 'filer', title: 'Submitted by'},
    {name: 'workflow', title: 'Workflow'},
  ],
  fields: [
    /* --------------------------------- the role --------------------------------- */
    defineField({name: 'title', title: 'Role title', type: 'string', group: 'role', validation: (rule) => textRule(rule, JOB_LIMITS.title)}),
    defineField({
      name: 'company',
      title: 'Hiring company',
      type: 'string',
      group: 'role',
      description: 'As it appears on the listing. If an employer is linked below, its name is used instead.',
      validation: (rule) => textRule(rule, JOB_LIMITS.company),
    }),
    defineField({
      name: 'employer',
      title: 'Employer',
      type: 'reference',
      to: [{type: 'employer'}],
      weak: true,
      group: 'role',
      description: 'Link the job to an employer for its logo, and so the employer can appear in Top Employers.',
    }),
    defineField({name: 'companyUrl', title: 'Company website', type: 'url', group: 'role', validation: (rule) => httpsRule(rule)}),
    defineField({name: 'location', title: 'Location', type: 'string', group: 'role', description: 'For example "DIFC, Dubai".', validation: (rule) => textRule(rule, JOB_LIMITS.location)}),
    defineField({name: 'workMode', title: 'Work mode', type: 'string', group: 'role', options: list(JOB_FORM_OPTIONS.workMode)}),
    defineField({name: 'employmentType', title: 'Type', type: 'string', group: 'role', options: list(JOB_EMPLOYMENT_TYPES)}),
    defineField({name: 'seniority', title: 'Level', type: 'string', group: 'role', options: list(JOB_FORM_OPTIONS.seniority)}),
    defineField({name: 'department', title: 'Function', type: 'string', group: 'role', options: list(JOB_FORM_OPTIONS.department)}),
    defineField({name: 'regulator', title: 'Regulator', type: 'string', group: 'role', options: list(JOB_FORM_OPTIONS.regulator)}),
    defineField({
      name: 'url',
      title: 'Apply link',
      type: 'url',
      group: 'role',
      description: "The employer's own careers page or applicant tracking system.",
      validation: (rule) => httpsRule(rule, {required: true}),
    }),
    defineField({
      name: 'slug',
      title: 'Web address',
      type: 'slug',
      group: 'role',
      description: 'The job page address. Filled in on publishing if empty; do not change it once the job is live.',
      options: {source: (doc) => `${doc.title || ''} ${doc.company || ''}`, maxLength: JOB_LIMITS.slug[1]},
      validation: (rule) =>
        rule.custom((value) => (!value?.current || JOB_SLUG_PATTERN.test(value.current) ? true : 'Use lowercase letters, numbers and single dashes.')),
    }),
    defineField({
      name: 'expiresAt',
      title: 'Take down on',
      type: 'datetime',
      group: 'role',
      description: `Leave empty to keep the job up for ${JOB_LIMITS.defaultLiveDays} days after publishing.`,
    }),

    /* -------------------------------- pay and visa -------------------------------- */
    defineField({name: 'salaryFrom', title: 'Salary from', type: 'number', group: 'pay', validation: (rule) => wholeAmount(rule).required()}),
    defineField({
      name: 'salaryTo',
      title: 'Salary to',
      type: 'number',
      group: 'pay',
      validation: (rule) =>
        wholeAmount(rule).custom((value, {document}) =>
          value === undefined || value === null || !document?.salaryFrom || value >= document.salaryFrom ? true : 'Must be at least the starting salary.',
        ),
    }),
    defineField({name: 'salaryCurrency', title: 'Currency', type: 'string', group: 'pay', initialValue: 'AED', options: list(JOB_FORM_OPTIONS.salaryCurrency), validation: (rule) => rule.required()}),
    defineField({name: 'salaryPeriod', title: 'Per', type: 'string', group: 'pay', initialValue: 'month', options: list(JOB_FORM_OPTIONS.salaryPeriod), validation: (rule) => rule.required()}),
    defineField({name: 'visa', title: 'Visa', type: 'string', group: 'pay', options: list(JOB_FORM_OPTIONS.visa), validation: (rule) => rule.required()}),

    /* -------------------------------- description -------------------------------- */
    defineField({
      name: 'description',
      title: 'Role description',
      type: 'text',
      rows: 12,
      group: 'details',
      description: 'Plain paragraphs, separated by an empty line. Shown on the job page.',
      validation: (rule) => textRule(rule, JOB_LIMITS.description),
    }),
    defineField({
      name: 'requirements',
      title: 'Requirements',
      type: 'array',
      group: 'details',
      description: 'One per line, for example "CFA Level II or above". Shown as a list on the job page.',
      of: [defineArrayMember({type: 'string', validation: (rule) => textRule(rule, JOB_LIMITS.requirement)})],
      validation: (rule) => rule.max(JOB_LIMITS.requirements),
    }),

    /* ----------------------- who submitted it (never published) ----------------------- */
    defineField({
      name: 'filer',
      title: 'Submitted by',
      type: 'object',
      group: 'filer',
      ...locked,
      description: 'From the Post a Job form. Never shown on the site; use it to ask about the role.',
      hidden: ({document}) => !document?.filer,
      fields: [
        defineField({name: 'name', title: 'Name', type: 'string'}),
        defineField({name: 'role', title: 'Their role', type: 'string'}),
        defineField({name: 'email', title: 'Work email', type: 'string'}),
        defineField({name: 'submittedAt', title: 'Submitted', type: 'datetime'}),
        defineField({name: 'source', title: 'Came from', type: 'string'}),
      ],
    }),
    defineField({name: 'editorNotes', title: 'Notes for editors', type: 'text', rows: 3, group: 'filer', description: 'Never shown on the site.'}),

    /* --------------------- workflow (set only by the workflow actions) --------------------- */
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      group: 'workflow',
      ...locked,
      description: 'Changed only with the buttons at the bottom of the job (Approve and publish, Reject…).',
      options: {list: JOB_STATUSES.map((value) => ({value, title: JOB_STATUS_LABELS[value]}))},
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
    defineField({name: 'firstPublishedAt', title: 'First published', type: 'datetime', group: 'workflow', ...locked}),
    defineField({name: 'publishedById', title: 'Published by (id)', type: 'string', group: 'workflow', ...locked}),
    defineField({name: 'rejectionReason', title: 'Rejection reason', type: 'text', rows: 2, group: 'workflow', ...locked}),
    defineField({name: 'statusChangedAt', title: 'Status changed', type: 'datetime', group: 'workflow', ...locked}),
    defineField({name: 'statusChangedById', title: 'Status changed by (id)', type: 'string', group: 'workflow', ...locked}),
  ],
  orderings: [
    {title: 'Newest', name: 'createdDesc', by: [{field: '_createdAt', direction: 'desc'}]},
    {title: 'Role title', name: 'titleAsc', by: [{field: 'title', direction: 'asc'}]},
  ],
  preview: {
    select: {title: 'title', company: 'company', employer: 'employer.name', status: 'status', media: 'employer.logo', location: 'location'},
    prepare: ({title, company, employer, status, media, location}) => ({
      title: title || '(no title)',
      subtitle: [JOB_STATUS_LABELS[status] || 'Pending review', employer || company, location].filter(Boolean).join(' · '),
      media,
    }),
  },
})

export const employer = defineType({
  name: 'employer',
  title: 'Employer',
  type: 'document',
  fields: [
    defineField({name: 'name', title: 'Name', type: 'string', validation: (rule) => textRule(rule, JOB_LIMITS.employerName)}),
    defineField({
      name: 'id',
      title: 'Id',
      type: 'slug',
      options: {source: 'name', maxLength: 61},
      readOnly: ({document}) => Boolean(document?._createdAt && document?.id?.current),
      description: 'Used in links (Careers ?employer=…). Fixed once saved.',
      validation: (rule) =>
        rule.required().custom((value) => (EMPLOYER_ID_PATTERN.test(value?.current || '') ? true : 'Use lowercase letters, numbers and dashes.')),
    }),
    defineField({name: 'logo', title: 'Logo', type: 'image', description: 'Square PNG, JPG or WebP up to 500 KB. Shown on job cards and in Top Employers.', options: {accept: 'image/png,image/jpeg,image/webp'}, validation: imageRule}),
    defineField({name: 'description', title: 'About the employer', type: 'text', rows: 4, validation: (rule) => textRule(rule, JOB_LIMITS.employerDescription, {required: false})}),
    defineField({name: 'website', title: 'Website', type: 'url', validation: (rule) => httpsRule(rule)}),
  ],
  orderings: [{title: 'Name', name: 'nameAsc', by: [{field: 'name', direction: 'asc'}]}],
  preview: {select: {title: 'name', subtitle: 'website', media: 'logo'}},
})

export const careersPage = defineType({
  name: 'careersPage',
  title: 'Top Employers and Top Jobs',
  type: 'document',
  fields: [
    defineField({
      name: 'topEmployers',
      title: 'Top Employers',
      type: 'array',
      description: `Up to ${JOB_LIMITS.topEmployers}, in the order shown on the Careers page (drag to reorder). Empty: employers with the most open roles.`,
      of: [defineArrayMember({type: 'reference', to: [{type: 'employer'}], weak: true})],
      validation: (rule) => uniqueRefs('employer')(rule.max(JOB_LIMITS.topEmployers)),
    }),
    defineField({
      name: 'topJobs',
      title: 'Top Jobs',
      type: 'array',
      description: `Up to ${JOB_LIMITS.topJobs} published jobs, in the order shown (drag to reorder). Jobs that are not live are skipped. Empty: newest jobs.`,
      of: [defineArrayMember({type: 'reference', to: [{type: 'jobPosting'}], weak: true, options: {filter: 'status == "published"'}})],
      validation: (rule) => uniqueRefs('job')(rule.max(JOB_LIMITS.topJobs)),
    }),
  ],
  preview: {prepare: () => ({title: 'Top Employers and Top Jobs'})},
})
