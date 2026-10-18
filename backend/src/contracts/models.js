// The data contract, in one place.
//
// Two kinds of shapes live here:
//   1. DB records: what the JSON store in backend/data/ holds today and what
//      schema/schema.sql holds once you move to PostgreSQL. Field names map
//      one-to-one (camelCase here, snake_case in SQL); test/contract.test.js
//      fails if a field has no column.
//   2. API DTOs: exactly what the public API (static api/v1/*.json and the
//      optional server) returns. The website scripts in js/ read only these
//      fields. src/contracts/serializers.js is the only code that builds them.
//
// Change a field here, in schema.sql, in serializers.js and in the js/ scripts
// together. The contract test catches drift between the first three.

export const API_VERSION = 1;

/* ------------------------------- enumerations ------------------------------ */

export const CATEGORY_IDS = ['uae', 'world'];
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'];
export const JOB_STATUSES = ['open', 'closed', 'expired'];
export const SPONSOR_SLOTS = ['founding', 'platinum', 'gold', 'sponsoredPosts', 'sponsoredMedia', 'professionalServices', 'careerResources'];
export const SUBMISSION_KINDS = ['contact', 'newsletter', 'advertise', 'event', 'job'];
export const SUBMISSION_STATUSES = ['new', 'pending-review', 'approved', 'rejected', 'spam'];
export const ADVERTISING_TIERS = ['silver', 'gold', 'platinum', 'exclusive'];
// Editorial content managed in Sanity (studio/) and published as api/v1/content.json.
export const CONTENT_SLOTS = ['socialHighlights', 'advertiseTiers'];
export const PAGE_SLUGS = ['about', 'privacy', 'terms'];
export const PAGE_BLOCK_TYPES = ['p', 'h2', 'h3', 'li'];
export const PAGE_LIST_TYPES = ['bullet', 'number'];

/* -------------------------------- DB records ------------------------------- */

/**
 * @typedef {Object} ArticleRecord  one publisher article (news-db.json "articles")
 * @property {string} articleId     'a_' + sha256(canonicalUrl), 16 hex
 * @property {string} title
 * @property {string} sourceId
 * @property {string} sourceName
 * @property {string} originalUrl   always links to the publisher
 * @property {string} canonicalUrl  used for de-duplication
 * @property {string} guid
 * @property {string} publishedAt   ISO
 * @property {boolean} [dateEstimated]
 * @property {'uae'|'world'} category
 * @property {string} topic
 * @property {string[]} topics
 * @property {Record<string,number>} topicScores
 * @property {number} uaeScore
 * @property {number} relevanceScore
 * @property {string} summary       publisher excerpt, <= 280 chars
 * @property {string|null} imageUrl
 * @property {boolean} [isPressRelease]
 * @property {string|null} storyId
 * @property {string} ingestedAt
 * @property {string} lastSeenAt
 */

/**
 * @typedef {Object} StoryRecord    one event covered by 1+ articles (news-db.json "stories")
 * @property {string} storyId       's_' + hash
 * @property {string[]} articleIds  maps to articles.story_id in SQL (no column of its own)
 * @property {string} leadArticleId
 * @property {string} headline
 * @property {string} summary
 * @property {string|null} imageUrl
 * @property {'uae'|'world'} category
 * @property {string} topic
 * @property {string[]} topics
 * @property {string[]} sourceIds
 * @property {string} firstPublishedAt
 * @property {string} lastPublishedAt
 * @property {string} createdAt
 * @property {string} [updatedAt]
 */

/**
 * @typedef {Object} JobRecord      (jobs-db.json "jobs")
 * @property {string} jobId         'j_' + hash
 * @property {string} employerId    'emp_' + hash of the normalised company name
 * @property {string} sourceId
 * @property {string} sourceName
 * @property {string} externalId
 * @property {string} title
 * @property {string} company
 * @property {string} location
 * @property {string} url
 * @property {string|null} canonicalUrl
 * @property {string} department
 * @property {string|null} employmentType  one of EMPLOYMENT_TYPES or null
 * @property {boolean} [featured]
 * @property {'open'|'closed'|'expired'} status
 * @property {string} postedAt
 * @property {string} [expiresAt]
 * @property {string} firstSeenAt
 * @property {string} lastSeenAt
 * @property {string|null} [closedAt]
 */

/**
 * @typedef {Object} EventRecord    (config/events.json, or the demo fixture)
 * @property {string} id
 * @property {string} title
 * @property {string} eventType     short label shown in the "Event Type" column, e.g. "Roundtable"
 * @property {string} startDate     YYYY-MM-DD (Asia/Dubai calendar date)
 * @property {string|null} endDate  YYYY-MM-DD, >= startDate
 * @property {string} city
 * @property {string|null} venue
 * @property {string|null} url      https only
 * @property {string|null} organiser
 * @property {boolean} featured
 */

/**
 * @typedef {Object} SponsorItemRecord  (config/sponsors.json, one array per slot)
 * @property {string} id
 * @property {boolean} [enabled]
 * @property {string|null} title
 * @property {string|null} blurb
 * @property {string|null} label
 * @property {string|null} logoText
 * @property {string|null} website   display text such as "www.example.ae", never a link
 * @property {string|null} url       https only; null renders as a non-link placeholder
 * @property {string|null} image     assets/sponsors/*.png|jpg|webp or https URL
 * @property {string|null} colorFrom #RRGGBB
 * @property {string|null} colorTo   #RRGGBB
 */

/**
 * @typedef {Object} SocialHighlightRecord  (config/content.json "socialHighlights"; home "Top Tweets")
 * @property {string} id
 * @property {boolean} [enabled]
 * @property {string} accountName
 * @property {string} handle        without the @
 * @property {string} text          editor-written line about the post, never the post itself
 * @property {string} url           https link to one post on x.com / twitter.com
 * @property {string} initials      avatar text, 1-3 capitals
 * @property {string|null} color    avatar #RRGGBB
 */

/**
 * @typedef {Object} AdvertiseTierRecord  (config/content.json "advertiseTiers"; Advertise page cards)
 * @property {string} id            one of ADVERTISING_TIERS (the value the enquiry form sends)
 * @property {boolean} [enabled]
 * @property {string} name
 * @property {string|null} badge
 * @property {string} price         display text, e.g. "AED 9,500"
 * @property {string|null} priceNote
 * @property {string[]} features
 * @property {boolean} featured
 */

/**
 * @typedef {Object} PageRecord     (config/content.json "pages"; About, Privacy, Terms body copy)
 * @property {string} slug          one of PAGE_SLUGS
 * @property {string} title
 * @property {string|null} intro
 * @property {string|null} updatedAt  YYYY-MM-DD
 * @property {PageBlock[]} blocks
 *
 * @typedef {Object} PageBlock      safe subset of Sanity Portable Text, rendered with textContent
 * @property {'p'|'h2'|'h3'|'li'} type
 * @property {'bullet'|'number'|null} list   set for 'li' only
 * @property {{text:string, bold:boolean, italic:boolean, href:string|null}[]} spans
 */

/**
 * @typedef {Object} SubmissionRecord (data/submissions/<kind>.jsonl, never committed)
 * @property {string} id            'sub_' + 20 hex
 * @property {string} kind          one of SUBMISSION_KINDS
 * @property {string} status        one of SUBMISSION_STATUSES
 * @property {Object} payload       the validated fields, plain text
 * @property {string|null} email    copied out of payload for lookups
 * @property {string} ipHash        HMAC-SHA256 of the client IP, never the IP itself
 * @property {string} userAgent     truncated to 200 chars
 * @property {string} createdAt
 */

// Field lists used by the contract test to prove schema.sql covers every model.
// "sources" merges config (sources.*.json) with health (feed-state.json).
export const DB_MODELS = {
  sources: {
    table: 'sources',
    fields: [
      'id', 'kind', 'name', 'type', 'url', 'board', 'company', 'homepage', 'region', 'focus', 'priority',
      'allowImages', 'enabled', 'verified', 'requireUaeLocation', 'relevanceFilter', 'titlePattern',
      'status', 'etag', 'lastModified', 'format', 'consecutiveFailures', 'lastError',
      'lastFetchedAt', 'lastSuccessAt', 'lastFailureAt', 'pausedUntil', 'lastItemCount'
    ]
  },
  articles: {
    table: 'articles',
    fields: [
      'articleId', 'title', 'sourceId', 'sourceName', 'originalUrl', 'canonicalUrl', 'guid', 'publishedAt',
      'dateEstimated', 'category', 'topic', 'topics', 'topicScores', 'uaeScore', 'relevanceScore', 'summary',
      'imageUrl', 'isPressRelease', 'storyId', 'ingestedAt', 'lastSeenAt'
    ]
  },
  stories: {
    table: 'stories',
    fields: [
      'storyId', 'leadArticleId', 'headline', 'summary', 'imageUrl', 'category', 'topic', 'topics',
      'sourceIds', 'firstPublishedAt', 'lastPublishedAt', 'createdAt', 'updatedAt'
    ],
    // Held on the other side of a relationship instead of a column of its own.
    derived: { articleIds: 'articles.story_id' }
  },
  jobs: {
    table: 'jobs',
    fields: [
      'jobId', 'employerId', 'sourceId', 'sourceName', 'externalId', 'title', 'company', 'location', 'url',
      'canonicalUrl', 'department', 'employmentType', 'featured', 'status', 'postedAt', 'expiresAt',
      'firstSeenAt', 'lastSeenAt', 'closedAt'
    ]
  },
  events: {
    table: 'events',
    fields: ['id', 'title', 'eventType', 'startDate', 'endDate', 'city', 'venue', 'url', 'organiser', 'featured']
  },
  sponsorItems: {
    table: 'sponsor_items',
    fields: ['id', 'slot', 'position', 'enabled', 'title', 'blurb', 'label', 'logoText', 'website', 'url', 'image', 'colorFrom', 'colorTo']
  },
  socialHighlights: {
    table: 'social_highlights',
    fields: ['id', 'position', 'enabled', 'accountName', 'handle', 'text', 'url', 'initials', 'color']
  },
  advertiseTiers: {
    table: 'advertise_tiers',
    fields: ['id', 'position', 'enabled', 'name', 'badge', 'price', 'priceNote', 'features', 'featured']
  },
  pages: {
    table: 'pages',
    fields: ['slug', 'title', 'intro', 'updatedAt', 'blocks']
  },
  submissions: {
    table: 'submissions',
    fields: ['id', 'kind', 'status', 'payload', 'email', 'ipHash', 'userAgent', 'createdAt']
  },
  ingestionRuns: {
    table: 'ingestion_runs',
    fields: ['command', 'mode', 'status', 'startedAt', 'finishedAt', 'durationMs', 'steps', 'warnings', 'errors', 'error']
  }
};

/* --------------------------------- API DTOs -------------------------------- */
// Every key listed here is always present in the output. Optional values are
// null, never "" (the website treats null as "not provided").

export const DTO_FIELDS = {
  story: [
    'id', 'headline', 'summary', 'url', 'source', 'sourceId', 'publishedAt', 'updatedAt', 'category',
    'categoryLabel', 'uiLabel', 'topic', 'topicLabel', 'topics', 'imageUrl', 'sourceCount', 'sources'
  ],
  storySource: ['articleId', 'source', 'sourceId', 'title', 'url', 'publishedAt'],
  job: [
    'id', 'title', 'company', 'employerId', 'location', 'url', 'postedAt', 'department', 'employmentType',
    'featured', 'source', 'sourceId'
  ],
  employer: ['id', 'name', 'initials', 'openJobs', 'featured'],
  event: ['id', 'title', 'eventType', 'startDate', 'endDate', 'city', 'venue', 'url', 'organiser', 'featured'],
  sponsorItem: ['id', 'title', 'blurb', 'label', 'logoText', 'website', 'url', 'image', 'colorFrom', 'colorTo', 'sponsored'],
  socialHighlight: ['id', 'accountName', 'handle', 'text', 'url', 'initials', 'color'],
  advertiseTier: ['id', 'name', 'badge', 'price', 'priceNote', 'features', 'featured'],
  page: ['slug', 'title', 'intro', 'updatedAt', 'blocks'],
  pageBlock: ['type', 'list', 'spans'],
  pageSpan: ['text', 'bold', 'italic', 'href'],
  source: [
    'id', 'kind', 'name', 'homepage', 'type', 'enabled', 'verified', 'region', 'status', 'lastSuccessAt',
    'lastError', 'lastItemCount', 'pausedUntil'
  ]
};

// Top-level keys of every public API document.
export const ENVELOPE_FIELDS = ['apiVersion', 'mode', 'generatedAt', 'notice'];
