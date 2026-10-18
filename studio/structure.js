// The Studio's left-hand menu, arranged by where things appear on funds.ae.

import {PAGE_TITLES} from './schemaTypes/page.js'
import {PAGE_SLUGS, SPONSOR_SLOTS} from './schemaTypes/rules.js'

const byPosition = [{field: 'position', direction: 'asc'}]

/** "New document" templates that pre-fill a sponsor's slot. */
export const sponsorTemplates = Object.keys(SPONSOR_SLOTS).map((slot) => ({
  id: `sponsorItem-${slot}`,
  title: `Sponsor: ${SPONSOR_SLOTS[slot].label}`,
  schemaType: 'sponsorItem',
  value: {slot, enabled: true, position: 10},
}))

export const structure = (S) =>
  S.list()
    .title('funds.ae')
    .items([
      S.listItem()
        .title('Sponsors')
        .child(
          S.list()
            .title('Sponsor areas')
            .items(
              Object.entries(SPONSOR_SLOTS).map(([slot, rules]) =>
                S.listItem()
                  .id(slot)
                  .title(`${rules.label} (max ${rules.maxItems})`)
                  .child(
                    S.documentTypeList('sponsorItem')
                      .title(rules.label)
                      .filter('_type == "sponsorItem" && slot == $slot')
                      .params({slot})
                      .defaultOrdering(byPosition)
                      .initialValueTemplates([S.initialValueTemplateItem(`sponsorItem-${slot}`)]),
                  ),
              ),
            ),
        ),
      S.listItem()
        .title('Events')
        .child(S.documentTypeList('event').title('Events').defaultOrdering([{field: 'startDate', direction: 'desc'}])),
      S.divider(),
      S.listItem()
        .title('Top Tweets (home)')
        .child(S.documentTypeList('socialHighlight').title('Top Tweets').defaultOrdering(byPosition)),
      S.listItem()
        .title('Advertise packages')
        .child(S.documentTypeList('advertiseTier').title('Advertise packages').defaultOrdering(byPosition)),
      S.listItem()
        .title('Pages')
        .child(
          S.list()
            .title('Pages')
            .items(
              // One fixed document per page, so there is never a second "Privacy Policy".
              PAGE_SLUGS.map((slug) =>
                S.listItem()
                  .id(slug)
                  .title(PAGE_TITLES[slug])
                  .child(S.document().schemaType('page').documentId(`page-${slug}`).initialValueTemplate(`page-${slug}`)),
              ),
            ),
        ),
    ])

export const pageTemplates = PAGE_SLUGS.map((slug) => ({
  id: `page-${slug}`,
  title: PAGE_TITLES[slug],
  schemaType: 'page',
  value: {slug, title: PAGE_TITLES[slug]},
}))
