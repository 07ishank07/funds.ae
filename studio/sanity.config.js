// funds.ae content studio. Editors review news in the News Review Queue, review and publish jobs in
// Careers (posted jobs, employers, Top Employers and Top Jobs), and manage news
// sources, Capital Types, Asset Classes, sponsors, events, the Top Tweets box, Advertise
// packages and the About/Privacy/Terms copy here. Publishing triggers the "Publish content"
// GitHub Action, which validates everything again and updates the site.
// See docs/SANITY-CMS-GUIDE.md and docs/NEWS-REVIEW-GUIDE.md.

import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes/index.js'
import {pageTemplates, sponsorTemplates, structure} from './structure.js'
import {FetchNewsNowAction, newsWorkflowActions, withNewsSave} from './actions/newsActions.jsx'
import {jobWorkflowActions, withJobSave} from './actions/jobActions.jsx'

const projectId = process.env.SANITY_STUDIO_PROJECT_ID
const dataset = process.env.SANITY_STUDIO_DATASET || 'production'
const SINGLETON_TYPES = new Set(['page', 'careersPage'])
// Created by the importer, the submissions server or the seed, never from the "create" menu.
// Jobs are created only with Careers > "Add a job", which gives them a private "jobs.<id>" id.
const NO_CREATE_TYPES = new Set(['newsArticle', 'newsAggregator', 'newsAggregatorState', 'newsPublishSignal', 'careersPage', 'jobPosting'])
// Written only by the importer or by the workflow actions.
const READ_ONLY_TYPES = new Set(['newsAggregatorState', 'newsPublishSignal'])

if (!projectId) {
  throw new Error('Set SANITY_STUDIO_PROJECT_ID in studio/.env (copy studio/.env.example).')
}

export default defineConfig({
  name: 'default',
  title: 'funds.ae',
  projectId,
  dataset,

  plugins: [
    structureTool({structure}),
    // The GROQ playground is for developers; it is left out of the deployed Studio.
    ...(process.env.NODE_ENV === 'development' ? [visionTool({defaultApiVersion: '2025-02-19'})] : []),
  ],

  schema: {
    types: schemaTypes,
    templates: (previous) => [
      ...previous.filter((t) => t.schemaType !== 'page' && t.schemaType !== 'sponsorItem' && !NO_CREATE_TYPES.has(t.schemaType)),
      ...sponsorTemplates,
      ...pageTemplates,
    ],
  },

  document: {
    // Stories: "Save changes" (Sanity's publish, guarded), the workflow actions and "Discard changes".
    // No delete, duplicate or unpublish: provenance is kept, and taking a story down is Unpublish or Archive.
    // Pages are fixed documents (one per page): no "duplicate" and no "create new" from the global menu.
    actions: (previous, {schemaType}) => {
      if (schemaType === 'newsArticle') {
        const publish = previous.find(({action}) => action === 'publish')
        const discard = previous.find(({action}) => action === 'discardChanges')
        return [publish && withNewsSave(publish), ...newsWorkflowActions, discard].filter(Boolean)
      }
      // Jobs: "Save changes" (guarded), the job workflow actions, "Discard changes" and Delete.
      if (schemaType === 'jobPosting') {
        const publish = previous.find(({action}) => action === 'publish')
        const keep = previous.filter(({action}) => action === 'discardChanges' || action === 'delete')
        return [publish && withJobSave(publish), ...jobWorkflowActions, ...keep].filter(Boolean)
      }
      if (schemaType === 'careersPage') return previous.filter(({action}) => !['duplicate', 'delete', 'unpublish'].includes(action))
      if (schemaType === 'newsAggregator') return [FetchNewsNowAction]
      if (READ_ONLY_TYPES.has(schemaType)) return []
      return SINGLETON_TYPES.has(schemaType) ? previous.filter(({action}) => action !== 'duplicate') : previous
    },
    newDocumentOptions: (previous) =>
      previous.filter((item) => !item.templateId.startsWith('page-') && !NO_CREATE_TYPES.has(item.templateId)),
  },
})
