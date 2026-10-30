// The home page hero banner: one fixed document ("homeHero"). Published as backend/config/content.json ->
// api/v1/content.json (hero), which js/fundsae-connector.js puts into the banner at the top of the home page.
// With nothing published the page keeps its built-in banner. Limits: HERO_LIMITS in rules.js.

import {defineField, defineType} from 'sanity'
import {HERO_LIMITS, IMAGE_TYPES} from './rules.js'
import {textRule} from './validators.js'

const API_VERSION = '2025-02-19'

/** PNG, JPG or WebP up to HERO_LIMITS.imageMaxBytes (a wide banner image is larger than a sponsor logo). */
const heroImageRule = (rule) =>
  rule.custom(async (value, context) => {
    const ref = value?.asset?._ref
    if (!ref) return true
    const asset = await context.getClient({apiVersion: API_VERSION}).fetch('*[_id == $ref][0]{mimeType, size}', {ref})
    if (!asset) return true
    if (!IMAGE_TYPES.includes(asset.mimeType)) return 'Use a PNG, JPG or WebP image (not SVG or GIF).'
    if (asset.size > HERO_LIMITS.imageMaxBytes) return `This image is ${Math.round(asset.size / 1024)} KB; the limit is ${HERO_LIMITS.imageMaxBytes / 1024} KB.`
    return true
  })

export const homeHero = defineType({
  name: 'homeHero',
  title: 'Home page hero banner',
  type: 'document',
  fields: [
    defineField({
      name: 'eyebrow',
      title: 'Small line above the headline',
      type: 'string',
      initialValue: 'Real estate · Infrastructure · Private capital',
      validation: (rule) => textRule(rule, HERO_LIMITS.eyebrow),
    }),
    defineField({
      name: 'title',
      title: 'Headline',
      type: 'string',
      initialValue: 'Know where the capital is moving.',
      validation: (rule) => textRule(rule, HERO_LIMITS.title),
    }),
    defineField({
      name: 'highlight',
      title: 'Word to show in gold',
      type: 'string',
      description: 'A word or phrase from the headline, shown in gold. Leave empty for none.',
      initialValue: 'capital',
      validation: (rule) =>
        textRule(rule, HERO_LIMITS.highlight, {required: false}).custom((value, {document}) =>
          !value || (document?.title || '').includes(value) ? true : 'Use a word or phrase that appears in the headline.',
        ),
    }),
    defineField({
      name: 'subtitle',
      title: 'Subtitle',
      type: 'text',
      rows: 3,
      initialValue:
        'Real estate investment, private equity, sovereign wealth and the funds behind them, from the UAE and around the world. Every story is checked by an editor and links to its publisher.',
      validation: (rule) => textRule(rule, HERO_LIMITS.subtitle, {required: false}),
    }),
    defineField({
      name: 'image',
      title: 'Image',
      type: 'image',
      description: `Wide image on the right of the banner (about 16:10), PNG, JPG or WebP up to ${HERO_LIMITS.imageMaxBytes / 1024 / 1024} MB. Leave empty to keep the built-in skyline illustration.`,
      options: {accept: 'image/png,image/jpeg,image/webp'},
      validation: heroImageRule,
    }),
    defineField({
      name: 'imageAlt',
      title: 'Image description',
      type: 'string',
      description: 'What the image shows, for people who cannot see it. Required with an image.',
      hidden: ({document}) => !document?.image,
      validation: (rule) =>
        textRule(rule, HERO_LIMITS.imageAlt, {required: false}).custom((value, {document}) =>
          !document?.image?.asset || (value && value.trim()) ? true : 'Describe the image.',
        ),
    }),
  ],
  preview: {select: {title: 'title', media: 'image'}, prepare: ({title, media}) => ({title: 'Home page hero banner', subtitle: title, media})},
})
