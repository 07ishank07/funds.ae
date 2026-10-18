// funds.ae content studio. Editors manage sponsors, events, the Top Tweets box,
// Advertise packages and the About/Privacy/Terms copy here. Publishing triggers
// the "Publish content" GitHub Action, which validates everything again and
// updates the site. See docs/SANITY-CMS-GUIDE.md.

import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes/index.js'
import {pageTemplates, sponsorTemplates, structure} from './structure.js'

const projectId = process.env.SANITY_STUDIO_PROJECT_ID
const dataset = process.env.SANITY_STUDIO_DATASET || 'production'
const SINGLETON_TYPES = new Set(['page'])

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
      ...previous.filter((t) => t.schemaType !== 'page' && t.schemaType !== 'sponsorItem'),
      ...sponsorTemplates,
      ...pageTemplates,
    ],
  },

  document: {
    // Pages are fixed documents (one per page): no "duplicate" and no "create new" from the global menu.
    actions: (previous, {schemaType}) =>
      SINGLETON_TYPES.has(schemaType) ? previous.filter(({action}) => action !== 'duplicate') : previous,
    newDocumentOptions: (previous) => previous.filter((item) => !item.templateId.startsWith('page-')),
  },
})
