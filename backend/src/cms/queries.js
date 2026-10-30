// The one GROQ query `npm run cms:pull` runs. It asks for exactly the fields
// the mapping uses, so nothing else in Sanity (drafts, hidden placements,
// editor notes) is ever downloaded. Hidden sponsors, Top Tweets items and
// packages (enabled == false) stay in Sanity and never reach the repository.

const published = '!(_id in path("drafts.**"))';

export const CONTENT_QUERY = `{
  "sponsors": *[_type == "sponsorItem" && enabled != false && ${published}] | order(slot asc, position asc, title asc) {
    "id": id.current, slot, title, blurb, label, logoText, website, url, colorFrom, colorTo, resourceType,
    "image": image.asset->{url, mimeType, size}
  },
  "events": *[_type == "event" && ${published}] | order(startDate asc, title asc) {
    "id": id.current, title, eventType, startDate, endDate, city, venue, url, organiser, featured
  },
  "highlights": *[_type == "socialHighlight" && enabled != false && ${published}] | order(position asc, accountName asc) {
    "id": id.current, accountName, handle, text, url, initials, color
  },
  "tiers": *[_type == "advertiseTier" && enabled != false && ${published}] | order(position asc, tier asc) {
    tier, name, badge, price, priceNote, showPrice, duration, placements[]{ placement, enabled, detail }, features,
    ctaLabel, ctaUrl, featured
  },
  "pages": *[_type == "page" && ${published}] | order(slug asc) {
    slug, title, intro, updatedAt, body
  },
  "hero": *[_id == "homeHero"][0] {
    eyebrow, title, highlight, subtitle, imageAlt, "image": image.asset->{url, mimeType, size}
  }
}`;

/* ------------------------------ news review queue ------------------------------ */
// Run with perspective "raw": queue stories live under private queue.* ids, and
// path("queue.*") matches the published copy only (never drafts.queue.*).

const QUEUE = '_type == "newsArticle" && _id in path("queue.*")';

/** What the importer needs to deduplicate and group: recent stories of any status. */
export const NEWS_RECENT_QUERY = `*[${QUEUE} && (dateTime(lastSeenAt) >= dateTime($since) || dateTime(importedAt) >= dateTime($since))] {
  _id, _type, articleId, storyId, originalHeadline, sourceId, guid, sourcePublishedAt, canonicalUrl, importedAt, lastSeenAt,
  status, excerpt, sourceImageUrl, otherSources
}`;

/** Which of these stories an editor has an open draft of (the importer patches the draft too). */
export const NEWS_DRAFTS_QUERY = '*[_id in $draftIds]._id';

/** Candidates for the site: published and due. src/news/publicFilter.js checks each one again. */
export const NEWS_PUBLISHED_QUERY = `*[${QUEUE} && status == "published" && dateTime(publishedAt) <= dateTime($now)]`;

/** The safety stop: do these live stories still exist in the queue, in any status? */
export const NEWS_BY_STORY_QUERY = `*[${QUEUE} && storyId in $storyIds] { _id, storyId, status }`;

/** Documents held in the dataset (the Free plan allows 10,000), excluding Sanity's own system documents. */
export const DOCUMENT_COUNT_QUERY = 'count(*[!(_id in path("_.**"))])';

/** The importer's own state: per-source health and the last run. */
export const AGGREGATOR_STATE_QUERY = '*[_id == "newsAggregatorState"][0]';

/**
 * `npm run cms:pull` with news.registry.source "sanity": the news source registry and both category
 * systems, published documents only. Fetch health lives elsewhere (newsAggregatorState) and is not pulled.
 */
export const REGISTRY_QUERY = `{
  "sources": *[_type == "newsSource" && ${published}] | order(section asc, name asc) {
    "id": id.current, name, homepage, type, url, enabled, verified, region, focus, priority, tier, licenseStatus,
    termsUrl, termsReviewedAt, allowImages, allowExcerpt, allowAiSummary, language, pollEveryHours, notes, section
  },
  "capitalTypes": *[_type == "capitalType" && ${published}] | order(displayOrder asc, name asc) {
    _id, "id": id.current, name, description, displayOrder, showInNav, navLabel, keywords[]{ term, weight }
  },
  "assetClasses": *[_type == "assetClass" && ${published}] | order(displayOrder asc, name asc) {
    _id, "id": id.current, name, description, displayOrder, homeSection, keywords[]{ term, weight }
  }
}`;
