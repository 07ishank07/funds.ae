// Body copy for the About, Privacy and Terms pages. Rich text is limited to
// what the website can render safely with textContent: headings, paragraphs,
// lists, bold, italic and https/mailto links.
// Published as backend/config/content.json -> api/v1/content.json (pages).

import {defineArrayMember, defineField, defineType} from 'sanity'
import {PAGE_LIMITS, PAGE_SLUGS} from './rules.js'
import {textRule} from './validators.js'

const PAGE_TITLES = {about: 'About', privacy: 'Privacy Policy', terms: 'Terms of Service'}

export const page = defineType({
  name: 'page',
  title: 'Page',
  type: 'document',
  fields: [
    defineField({
      name: 'slug',
      title: 'Page',
      type: 'string',
      options: {list: PAGE_SLUGS.map((value) => ({value, title: PAGE_TITLES[value]})), layout: 'radio'},
      readOnly: ({document}) => Boolean(document?.slug) && document._id.replace(/^drafts\./, '').startsWith('page-'),
      validation: (rule) => rule.required(),
    }),
    defineField({name: 'title', title: 'Title', type: 'string', validation: (rule) => textRule(rule, PAGE_LIMITS.title)}),
    defineField({
      name: 'intro',
      title: 'Introduction',
      type: 'text',
      rows: 3,
      description: 'Optional paragraph under the title.',
      validation: (rule) => textRule(rule, PAGE_LIMITS.intro, {required: false}),
    }),
    defineField({
      name: 'updatedAt',
      title: 'Last updated',
      type: 'date',
      description: 'Shown as "Last updated" on Privacy and Terms. Change it when the meaning changes.',
      options: {dateFormat: 'YYYY-MM-DD'},
    }),
    defineField({
      name: 'body',
      title: 'Body',
      type: 'array',
      validation: (rule) => rule.required().min(1).max(PAGE_LIMITS.blocks),
      of: [
        defineArrayMember({
          type: 'block',
          styles: [
            {title: 'Paragraph', value: 'normal'},
            {title: 'Heading', value: 'h2'},
            {title: 'Subheading', value: 'h3'},
          ],
          lists: [
            {title: 'Bullets', value: 'bullet'},
            {title: 'Numbered', value: 'number'},
          ],
          marks: {
            decorators: [
              {title: 'Bold', value: 'strong'},
              {title: 'Italic', value: 'em'},
            ],
            annotations: [
              defineArrayMember({
                name: 'link',
                type: 'object',
                title: 'Link',
                fields: [
                  defineField({
                    name: 'href',
                    title: 'Address',
                    type: 'url',
                    description: 'https:// or mailto: only.',
                    validation: (rule) => rule.required().uri({scheme: ['https', 'mailto']}),
                  }),
                ],
              }),
            ],
          },
        }),
      ],
    }),
  ],
  preview: {
    select: {title: 'title', slug: 'slug', updatedAt: 'updatedAt'},
    prepare: ({title, slug, updatedAt}) => ({
      title: title || PAGE_TITLES[slug] || '(untitled)',
      subtitle: updatedAt ? `Updated ${updatedAt}` : PAGE_TITLES[slug],
    }),
  },
})

export {PAGE_TITLES}
