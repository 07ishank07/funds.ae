// Record -> API DTO mapping. This is the ONLY place that decides what the
// public API exposes, so internal fields (scores, canonical URLs, feed state,
// submitter data) can never leak into api/v1 by accident.
//
// Rule: every DTO key in models.js DTO_FIELDS is always present; optional
// values are null, never "".

/** Trimmed non-empty string, or null. */
export function nullable(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

export function toStoryDto(story, articlesById, topicLabels, categories) {
  const members = story.articleIds.map((id) => articlesById.get(id)).filter(Boolean);
  const lead = articlesById.get(story.leadArticleId) || members[0];
  if (!lead) return null;
  const cat = categories.find((c) => c.id === story.category);
  const sources = members
    .sort((a, b) => (a.articleId === lead.articleId ? -1 : b.articleId === lead.articleId ? 1 : 0))
    .map((m) => ({
      articleId: m.articleId,
      source: m.sourceName,
      sourceId: m.sourceId,
      title: m.title,
      url: m.originalUrl,
      publishedAt: m.publishedAt
    }));
  return {
    id: story.storyId,
    headline: story.headline,
    summary: nullable(story.summary),
    url: lead.originalUrl,
    source: lead.sourceName,
    sourceId: lead.sourceId,
    publishedAt: story.firstPublishedAt,
    updatedAt: story.lastPublishedAt,
    category: story.category,
    categoryLabel: cat?.label || story.category,
    uiLabel: cat?.uiLabel || cat?.label || story.category,
    topic: story.topic,
    topicLabel: topicLabels[story.topic] || story.topic,
    topics: story.topics || [],
    imageUrl: nullable(story.imageUrl),
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
    features: [...tier.features],
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
