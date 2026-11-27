// The hero banner: one fixed document ("homeHero"). Published as backend/config/content.json ->
// api/v1/content.json (hero), which js/fundsae-connector.js puts into the banner under the header bar on the home,
// Videos & Podcasts, Partner with us, Careers and Events pages. With nothing published the pages keep their built-in
// banner. Limits: HERO_LIMITS in rules.js; styles and button pages: HERO_STYLES and HERO_BUTTON_TARGETS.

import {defineField, defineType} from 'sanity'
import {HERO_BUTTON_TARGETS, HERO_LIMITS, HERO_STYLES, IMAGE_TYPES} from './rules.js'
import {textRule} from './validators.js'

const API_VERSION = '2025-02-19'
const isClassic = (document) => document?.style === 'classic'

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
      name: 'style',
      title: 'Banner style',
      type: 'string',
      description: 'Applies on every page that shows the banner.',
      options: {list: HERO_STYLES, layout: 'radio'},
      initialValue: HERO_STYLES[0].value,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'eyebrow',
      title: 'Small line above the headline',
      type: 'string',
      initialValue: 'The future of capital',
      validation: (rule) => textRule(rule, HERO_LIMITS.eyebrow),
    }),
    defineField({
      name: 'title',
      title: 'Headline',
      type: 'string',
      initialValue: 'Capital. Markets. Opportunity.',
      validation: (rule) => textRule(rule, HERO_LIMITS.title),
    }),
    defineField({
      name: 'highlight',
      title: 'Word to highlight',
      type: 'string',
      description: 'A word or phrase from the headline, shown in colour (gold in Photo and Classic, teal in Minimal). Leave empty for none.',
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
      initialValue: 'Daily intelligence on the deals, funds and investors shaping Dubai and the Gulf.',
      validation: (rule) => textRule(rule, HERO_LIMITS.subtitle, {required: false}),
    }),
    defineField({
      name: 'buttonLabel',
      title: 'Button text',
      type: 'string',
      description: 'The main button (Photo and Minimal styles). Leave empty for no button.',
      initialValue: 'Explore the latest news',
      hidden: ({document}) => isClassic(document),
      validation: (rule) =>
        textRule(rule, HERO_LIMITS.buttonLabel, {required: false}).custom((value, {document}) =>
          !value || document?.buttonTarget ? true : 'Choose the page the button opens.',
        ),
    }),
    defineField({
      name: 'buttonTarget',
      title: 'Button opens',
      type: 'string',
      options: {list: Object.entries(HERO_BUTTON_TARGETS).map(([value, t]) => ({value, title: t.title}))},
      initialValue: 'news',
      hidden: ({document}) => isClassic(document) || !document?.buttonLabel,
      validation: (rule) => rule.custom((value, {document}) => (value || !document?.buttonLabel ? true : 'Choose the page the button opens.')),
    }),
    defineField({
      name: 'button2Label',
      title: 'Second button text',
      type: 'string',
      description: 'An outlined button next to the main one (Photo and Minimal styles). Leave empty for none.',
      initialValue: 'Watch the videos',
      hidden: ({document}) => isClassic(document),
      validation: (rule) =>
        textRule(rule, HERO_LIMITS.button2Label, {required: false}).custom((value, {document}) =>
          !value || document?.button2Target ? true : 'Choose the page the second button opens.',
        ),
    }),
    defineField({
      name: 'button2Target',
      title: 'Second button opens',
      type: 'string',
      options: {list: Object.entries(HERO_BUTTON_TARGETS).map(([value, t]) => ({value, title: t.title}))},
      initialValue: 'videos',
      hidden: ({document}) => isClassic(document) || !document?.button2Label,
      validation: (rule) => rule.custom((value, {document}) => (value || !document?.button2Label ? true : 'Choose the page the second button opens.')),
    }),
    defineField({
      name: 'image',
      title: 'Image',
      type: 'image',
      description: `A photo you have the rights to, PNG, JPG or WebP up to ${HERO_LIMITS.imageMaxBytes / 1024 / 1024} MB. Photo: it fills the whole banner behind the text (landscape, at least 1920 px wide; the left side is darkened for the text). Minimal: a wide photo under the text (about 21:9, cropped to fit). Classic: on the right of the banner (about 16:10). Leave empty to keep the built-in picture.`,
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
  preview: {
    select: {title: 'title', style: 'style', media: 'image'},
    prepare: ({title, style, media}) => ({
      title: 'Home page hero banner',
      subtitle: `${(HERO_STYLES.find((s) => s.value === (style || HERO_STYLES[0].value))?.title || '').split(' (')[0]} · ${title || ''}`,
      media,
    }),
  },
})
