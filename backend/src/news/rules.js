// News review queue rules: the backend's copy of studio/schemaTypes/newsRules.js.
// backend/test/cms.test.js proves the two are equal (and that the Studio's
// NEWS_APPROVER_IDS equals settings.json news.review.approverIds); change a value
// in both places. The approver list itself lives in settings.json, not here.
// How the queue works: docs/NEWS-REVIEW-GUIDE.md.

/** Editorial status of a story. Only the workflow actions (newsWorkflow.js) change it, never the importer. */
export const NEWS_STATUSES = ['pending_review', 'approved', 'rejected', 'published', 'archived'];
export const NEWS_STATUS_LABELS = {
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  published: 'Published',
  archived: 'Archived'
};

/** Queue documents use the private ID path "queue.<articleId>": a public dataset never shows them to anonymous readers. */
export const NEWS_ID_PATH = 'queue';

/** Geography of a story (optional, several allowed). Fixed list: the website filter offers exactly these. */
export const NEWS_GEOGRAPHIES = ['uae', 'saudi-arabia', 'gcc', 'mena', 'uk', 'europe', 'north-america', 'asia-pacific', 'global'];
export const NEWS_GEOGRAPHY_LABELS = {
  uae: 'UAE',
  'saudi-arabia': 'Saudi Arabia',
  gcc: 'Other GCC',
  mena: 'Middle East and Africa',
  uk: 'United Kingdom',
  europe: 'Europe',
  'north-america': 'North America',
  'asia-pacific': 'Asia-Pacific',
  global: 'Global'
};

/** Transaction type of a story (optional, one). */
export const NEWS_TRANSACTION_TYPES = [
  'capital-raising', 'fund-launch', 'fund-close', 'acquisition', 'disposal', 'investment', 'debt-financing',
  'refinancing', 'joint-venture', 'institutional-allocation', 'reit-activity', 'valuation', 'merger-acquisition',
  'development', 'other'
];
export const NEWS_TRANSACTION_LABELS = {
  'capital-raising': 'Capital raising',
  'fund-launch': 'Fund launch',
  'fund-close': 'Fund close',
  acquisition: 'Acquisition',
  disposal: 'Disposal',
  investment: 'Investment',
  'debt-financing': 'Debt financing',
  refinancing: 'Refinancing',
  'joint-venture': 'Joint venture or co-investment',
  'institutional-allocation': 'Institutional allocation',
  'reit-activity': 'REIT activity',
  valuation: 'Valuation',
  'merger-acquisition': 'Merger or corporate M&A',
  development: 'Development',
  other: 'Other'
};

/** Home page boxes an Asset Class can feed (api/v1/news/sections/<id>.json). */
export const NEWS_HOME_SECTIONS = ['residential-real-estate', 'commercial-real-estate', 'infrastructure'];
export const NEWS_HOME_SECTION_LABELS = {
  'residential-real-estate': 'Residential Estate News',
  'commercial-real-estate': 'Commercial Real Estate News',
  infrastructure: 'Infrastructure Real Estate News'
};

/** Text lengths [min, max] and list sizes. Summaries and excerpts stay <= 280 characters (CLAUDE.md legal rules). */
export const NEWS_LIMITS = {
  headline: [12, 160],
  summary: [20, 280],
  excerpt: [0, 280],
  slug: [3, 96],
  seoTitle: [0, 70],
  seoDescription: [0, 160],
  rejectionReason: [5, 300],
  editorNotes: [0, 1000],
  imageCredit: [2, 120],
  categoryName: [2, 60],
  categoryDescription: [0, 300],
  navLabel: [2, 24],
  keyword: [2, 60],
  keywords: 80,
  keywordWeight: [1, 5],
  navItems: 12,
  displayOrder: [0, 999],
  // Earliest a story can be scheduled: a few minutes ahead, so the hourly publisher never misses it.
  scheduleLeadMinutes: 5
};
export const NEWS_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Source licence statuses (backend/src/config.js LICENSE_STATUSES) and the ones a story may be published from. */
export const NEWS_LICENSE_STATUSES = ['public_sector', 'wire', 'terms_reviewed', 'permission_granted', 'pending_review', 'blocked'];
export const PUBLISHABLE_LICENSE_STATUSES = ['public_sector', 'wire', 'terms_reviewed', 'permission_granted'];
/** AI summaries need someone to have read the terms: public-sector or wire status alone is not enough. */
export const AI_SUMMARY_LICENSE_STATUSES = ['terms_reviewed', 'permission_granted'];

/** News source registry values (backend/src/config.js validates every source with these). */
export const NEWS_SOURCE_TYPES = ['rss', 'api'];
export const NEWS_SOURCE_REGIONS = ['uae', 'global'];
export const NEWS_SOURCE_FOCUSES = ['private-markets', 'general-business'];
export const NEWS_SOURCE_TIERS = ['L1', 'L2', 'L3', 'L4', 'L5'];

/**
 * Workflow actions: the statuses each one starts from, the status it sets, and whether only an approver may run it.
 * Taking a story off the site (reject, unpublish, archive) is open to every editor; putting one on it is not.
 */
export const NEWS_ACTIONS = {
  approve: { label: 'Approve', from: ['pending_review', 'rejected'], to: 'approved', approverOnly: true },
  approvePublish: { label: 'Approve and publish', from: ['pending_review', 'rejected'], to: 'published', approverOnly: true },
  publish: { label: 'Publish now', from: ['approved'], to: 'published', approverOnly: true },
  schedule: { label: 'Schedule', from: ['pending_review', 'approved'], to: 'published', approverOnly: true },
  reject: { label: 'Reject', from: ['pending_review', 'approved'], to: 'rejected', approverOnly: false },
  unpublish: { label: 'Unpublish', from: ['published'], to: 'approved', approverOnly: false },
  archive: { label: 'Archive', from: ['pending_review', 'approved', 'rejected', 'published'], to: 'archived', approverOnly: false },
  returnToReview: { label: 'Return to review', from: ['approved', 'rejected', 'archived'], to: 'pending_review', approverOnly: false }
};

/** Fields the importer writes when it creates a story. Everything else on the document belongs to editors. */
export const NEWS_INGEST_FIELDS = [
  'articleId', 'storyId', 'originalHeadline', 'originalUrl', 'canonicalUrl', 'guid', 'source', 'sourceId', 'sourceName',
  'sourcePublishedAt', 'dateEstimated', 'importedAt', 'lastSeenAt', 'excerpt', 'sourceImageUrl', 'topic', 'topics',
  'category', 'uaeScore', 'relevanceScore', 'isPressRelease', 'classification', 'priority', 'dedupeKey', 'otherSources'
];
/** The only fields the importer may change on an existing story (never editorial or workflow fields). */
export const NEWS_INGEST_PATCH_FIELDS = ['lastSeenAt', 'excerpt', 'sourceImageUrl', 'otherSources'];
/** Editorial fields the importer pre-fills once, on create, from the publisher's data and the classifier. */
export const NEWS_PREFILL_FIELDS = ['headline', 'slug', 'summary', 'summarySource', 'capitalTypes', 'assetClasses', 'geography', 'transactionType'];
export const NEWS_EDITORIAL_FIELDS = [
  'headline', 'slug', 'summary', 'summarySource', 'capitalTypes', 'assetClasses', 'geography', 'transactionType',
  'featured', 'image', 'duplicateOf', 'seo', 'editorNotes'
];
/** Set only by the workflow actions. */
export const NEWS_WORKFLOW_FIELDS = [
  'status', 'approval', 'publishedAt', 'publishedById', 'firstPublishedAt', 'scheduledAt', 'rejectionReason',
  'statusChangedAt', 'statusChangedById'
];
/** What an approval vouches for: changing any of these after approval keeps the story off the site until re-approved. */
export const NEWS_APPROVAL_HASH_FIELDS = [
  'headline', 'slug', 'summary', 'summarySource', 'capitalTypes', 'assetClasses', 'geography', 'transactionType', 'featured',
  'image', 'seo', 'duplicateOf', 'publishedAt'
];
export const NEWS_SUMMARY_SOURCES = ['excerpt', 'editor', 'ai'];
