// Record -> API DTO mapping. This is the ONLY place that decides what the
// public API exposes, so internal fields (scores, canonical URLs, feed state,
// submitter data) can never leak into api/v1 by accident.
//
// Rule: every DTO key in models.js DTO_FIELDS is always present; optional
// values are null, never "".

import { ADVERTISE_PLACEMENT_LABELS } from './models.js';
import { PUBLISHABLE_LICENSE_STATUSES } from '../news/rules.js';

/** Trimmed non-empty string, or null. */
export function nullable(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

/**
 * UAE or Rest of the World for a review document: the editor's geography decides when set,
 * otherwise the importer's UAE score (doc.category).
 */
export function storyCategory(doc) {
  if (Array.isArray(doc.geography) && doc.geography.length) return doc.geography.includes('uae') ? 'uae' : 'world';
  return doc.category === 'uae' ? 'uae' : 'world';
}

/**
 * A published review document (src/news/publicFilter.js has already passed it) as a public story.
 * Other outlets are listed only if they were attached before the approval (anything the importer
 * added later stays private until an approver approves the story again) and only if their own
 * source's licence is cleared: an outlet's headline and link are publisher content too.
 * @param {object} doc
 * @param {{topicLabels:Record<string,string>, categories:object[], allowsImages:(sourceId:string)=>boolean,
 *          licenseOf:(sourceId:string)=>string|undefined}} ctx
 */
export function toStoryDto(doc, { topicLabels, categories, allowsImages, licenseOf }) {
  if (!doc?.storyId || !doc.originalUrl || !doc.sourceName) return null;
  const approvedAt = doc.approval?.approvedAt ? new Date(doc.approval.approvedAt).getTime() : 0;
  const lead = {
    articleId: doc.articleId,
    source: doc.sourceName,
    sourceId: doc.sourceId,
    title: doc.originalHeadline,
    url: doc.originalUrl,
    publishedAt: doc.sourcePublishedAt
  };
  const others = (doc.otherSources || [])
    .filter((o) => o.attachedAt && new Date(o.attachedAt).getTime() <= approvedAt && o.url && o.sourceName)
    .filter((o) => PUBLISHABLE_LICENSE_STATUSES.includes(licenseOf(o.sourceId)))
    .map((o) => ({ articleId: o.articleId, source: o.sourceName, sourceId: o.sourceId, title: o.title, url: o.url, publishedAt: o.publishedAt }));
  const sources = [lead, ...others];
  const times = sources.map((s) => new Date(s.publishedAt).getTime()).filter(Number.isFinite);
  const category = storyCategory(doc);
  const cat = categories.find((c) => c.id === category);
  const topic = doc.topic || 'general-investment';
  return {
    id: doc.storyId,
    headline: String(doc.headline).trim(),
    summary: nullable(doc.summary),
    url: doc.originalUrl,
    source: doc.sourceName,
    sourceId: doc.sourceId,
    publishedAt: new Date(Math.min(...times)).toISOString(),
    updatedAt: new Date(Math.max(...times)).toISOString(),
    category,
    categoryLabel: cat?.label || category,
    uiLabel: cat?.uiLabel || cat?.label || category,
    topic,
    topicLabel: topicLabels[topic] || topic,
    topics: doc.topics || [],
    // Publisher images are hot-linked only while the source allows it (checked at publish time).
    imageUrl: allowsImages(doc.sourceId) ? nullable(doc.sourceImageUrl) : null,
    sourceCount: new Set(sources.map((s) => s.sourceId)).size,
    sources
  };
}

export function toJobDto(job) {
  return {
    id: job.jobId,
    title: job.title,
    company: job.company,
    employerId: job.employerId,
    location: nullable(job.location),
    url: job.url,
    postedAt: job.postedAt,
    department: nullable(job.department),
    employmentType: nullable(job.employmentType),
    featured: Boolean(job.featured),
    source: job.sourceName,
    sourceId: job.sourceId
  };
}

export function toEmployerDto(employer) {
  return {
    id: employer.id,
    name: employer.name,
    initials: employer.initials,
    openJobs: employer.openJobs,
    featured: Boolean(employer.featured)
  };
}

export function toEventDto(event) {
  return {
    id: event.id,
    title: event.title,
    eventType: event.eventType,
    startDate: event.startDate,
    endDate: nullable(event.endDate),
    city: event.city,
    venue: nullable(event.venue),
    url: nullable(event.url),
    organiser: nullable(event.organiser),
    featured: Boolean(event.featured)
  };
}

export function toSponsorItemDto(item, { sponsored }) {
  return {
    id: item.id,
    title: nullable(item.title),
    blurb: nullable(item.blurb),
    label: nullable(item.label),
    logoText: nullable(item.logoText),
    website: nullable(item.website),
    url: nullable(item.url),
    image: nullable(item.image),
    colorFrom: nullable(item.colorFrom),
    colorTo: nullable(item.colorTo),
    sponsored: Boolean(sponsored)
  };
}

export function toSocialHighlightDto(item) {
  return {
    id: item.id,
    accountName: item.accountName,
    handle: item.handle,
    text: item.text,
    url: item.url,
    initials: item.initials,
    color: nullable(item.color)
  };
}

export function toAdvertiseTierDto(tier) {
  return {
    id: tier.id,
    name: tier.name,
    badge: nullable(tier.badge),
    price: tier.price,
    priceNote: nullable(tier.priceNote),
    showPrice: tier.showPrice !== false,
    duration: nullable(tier.duration),
    // Only the placements switched on for this package, in the order the editor listed them.
    placements: (tier.placements || []).filter((p) => p.enabled !== false).map((p) => ({
      type: p.placement,
      label: ADVERTISE_PLACEMENT_LABELS[p.placement],
      detail: p.detail
    })),
    features: [...(tier.features || [])],
    ctaLabel: nullable(tier.ctaLabel),
    ctaUrl: nullable(tier.ctaUrl),
    featured: Boolean(tier.featured)
  };
}

export function toPageDto(page) {
  return {
    slug: page.slug,
    title: page.title,
    intro: nullable(page.intro),
    updatedAt: nullable(page.updatedAt),
    blocks: page.blocks.map((b) => ({
      type: b.type,
      list: b.type === 'li' ? b.list : null,
      spans: b.spans.map((s) => ({ text: s.text, bold: Boolean(s.bold), italic: Boolean(s.italic), href: nullable(s.href) }))
    }))
  };
}

export function toSourceDto(source, kind, health = {}) {
  return {
    id: source.id,
    kind,
    name: source.name,
    homepage: nullable(source.homepage),
    type: source.type,
    enabled: source.enabled !== false,
    verified: typeof source.verified === 'boolean' ? source.verified : null,
    region: nullable(source.region),
    status: source.enabled === false ? 'disabled' : health.status || 'not-run-yet',
    lastSuccessAt: health.lastSuccessAt || null,
    lastError: health.lastError || null,
    lastItemCount: health.lastItemCount ?? null,
    pausedUntil: health.pausedUntil || null
  };
}
