// The Studio's left-hand menu: the News Review Queue first, then everything else
// arranged by where it appears on funds.ae.

import {PAGE_TITLES} from './schemaTypes/page.js'
import {PAGE_SLUGS, SPONSOR_SLOTS} from './schemaTypes/rules.js'

const byPosition = [{field: 'position', direction: 'asc'}]
const byOrder = [{field: 'displayOrder', direction: 'asc'}, {field: 'name', direction: 'asc'}]
const newest = [{field: 'importedAt', direction: 'desc'}]
const STORY = '_type == "newsArticle"'

/** One queue view: a filtered list of stories. Stories are never created by hand, so no "create" button. */
const storyList = (S, id, title, filter, ordering = newest) =>
  S.listItem()
    .id(id)
    .title(title)
    .child(S.documentTypeList('newsArticle').title(title).filter(`${STORY} && ${filter}`).defaultOrdering(ordering).initialValueTemplates([]))

/** Stories tagged with one category or from one source. */
const storiesFor = (S, type, title) =>
  S.listItem()
    .id(`by-${type}`)
    .title(title)
    .child(
      S.documentTypeList(type)
        .title(title)
        .defaultOrdering(type === 'newsSource' ? [{field: 'name', direction: 'asc'}] : byOrder)
        .child((refId) =>
          S.documentTypeList('newsArticle').title('Stories').filter(`${STORY} && references($refId)`).params({refId}).defaultOrdering(newest).initialValueTemplates([]),
        ),
    )

const newsQueue = (S) =>
  S.listItem()
    .id('news-review-queue')
    .title('News Review Queue')
    .child(
      S.list()
        .title('News Review Queue')
        .items([
          storyList(S, 'pending', 'Pending review', 'status == "pending_review"', [{field: 'priority', direction: 'desc'}, ...newest]),
          storyList(S, 'attention', 'Needs attention (unclassified or low confidence)', 'status == "pending_review" && classification.needsReview == true'),
          storyList(S, 'approved', 'Approved, not live yet', 'status == "approved"'),
          storyList(S, 'scheduled', 'Scheduled', 'status == "published" && dateTime(publishedAt) > dateTime(now())', [{field: 'publishedAt', direction: 'asc'}]),
          storyList(S, 'published', 'Published', 'status == "published" && dateTime(publishedAt) <= dateTime(now())', [{field: 'publishedAt', direction: 'desc'}]),
          storyList(S, 'rejected', 'Rejected', 'status == "rejected"', [{field: 'statusChangedAt', direction: 'desc'}]),
          storyList(S, 'archived', 'Archived', 'status == "archived"', [{field: 'statusChangedAt', direction: 'desc'}]),
          S.divider(),
          storiesFor(S, 'capitalType', 'By Capital Type'),
          storiesFor(S, 'assetClass', 'By Asset Class'),
          storiesFor(S, 'newsSource', 'By source'),
          storyList(S, 'all', 'All stories', 'defined(status)'),
        ]),
    )

const newsSettings = (S) =>
  S.listItem()
    .id('news-settings')
    .title('News sources and categories')
    .child(
      S.list()
        .title('News sources and categories')
        .items([
          S.listItem().id('sources').title('News sources').child(S.documentTypeList('newsSource').title('News sources').defaultOrdering([{field: 'name', direction: 'asc'}])),
          S.listItem().id('capital-types').title('Capital Types').child(S.documentTypeList('capitalType').title('Capital Types').defaultOrdering(byOrder)),
          S.listItem().id('asset-classes').title('Asset Classes').child(S.documentTypeList('assetClass').title('Asset Classes').defaultOrdering(byOrder)),
          S.divider(),
          S.listItem().id('aggregator').title('Fetch News Now').child(S.document().schemaType('newsAggregator').documentId('newsAggregator')),
          S.listItem().id('aggregator-status').title('Aggregator status').child(S.document().schemaType('newsAggregatorState').documentId('newsAggregatorState')),
        ]),
    )

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
      newsQueue(S),
      newsSettings(S),
      S.divider(),
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
