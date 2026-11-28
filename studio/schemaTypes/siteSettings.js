// Site settings: one fixed document ("siteSettings") for things that are not tied to one page.
//   - Top UAE Story: pin a published UAE story to the home page's "Top UAE Story". Empty: the site shows the
//     featured UAE story, or else the newest.
//   - Footer tagline: the short line beside the logo in every page's footer.
// Published as backend/config/content.json -> api/v1/content.json (settings). Limits: SETTINGS_LIMITS in rules.js.
//
// Privacy: public content (readable by anyone). The story pin stores only the story's reference; no personal details.

import {defineField, defineType} from 'sanity'
import {SETTINGS_LIMITS} from './rules.js'
import {textRule} from './validators.js'

export const siteSettings = defineType({
  name: 'siteSettings',
  title: 'Site settings',
  type: 'document',
  description: 'Readable by anyone: no personal details.',
  fields: [
    defineField({
      name: 'topUaeStory',
      title: 'Top UAE Story (home page)',
      type: 'reference',
      to: [{type: 'newsArticle'}],
      weak: true,
      description: 'Optional. Pick a published UAE story to show as the home page\'s Top UAE Story. Leave empty to show the featured UAE story, or else the newest.',
      options: {filter: 'status == "published" && defined(storyId)', disableNew: true},
    }),
    defineField({
      name: 'footerTagline',
      title: 'Footer tagline',
      type: 'string',
      description: 'The short line beside the logo in the footer of every page, for example "Discover. Connect. Grow."',
      validation: (rule) => textRule(rule, SETTINGS_LIMITS.footerTagline, {required: false}),
    }),
  ],
  preview: {prepare: () => ({title: 'Site settings'})},
})
