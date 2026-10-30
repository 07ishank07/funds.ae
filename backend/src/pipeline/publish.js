// Writes the public read-only API into api/v1/. GitHub Pages serves these
// files over HTTPS; the optional server (src/server/) serves the same files
// plus filters and paging. The shapes are the contract in src/contracts/.
//
//   api/v1/meta.json                   run info, counts, per-file versions, capabilities
//   api/v1/news.json                   latest stories, all categories
//   api/v1/news/{uae,world}.json       stories for one category
//   api/v1/news/topics/<topic>.json    stories for one topic
//   api/v1/news/sections/<id>.json     stories for one page section (a topic group, or the Asset Classes of a home box)
//   api/v1/news/real-estate.json       Real Estate Capital News page: published stories with an Asset Class
//   frontend_demo/news/<slug>.html     one static page per published story (pipeline/storyPages.js)
//   api/v1/jobs.json                   open roles
//   api/v1/employers.json              employers derived from open roles (logo and description from Sanity)
//   api/v1/careers.json                Top Employers and Top Jobs in the editors' order (Sanity careersPage)
//   frontend_demo/jobs/<slug>.html     one static page per job posted through Sanity (pipeline/jobPages.js)
//   api/v1/events.json                 upcoming and recent events
//   api/v1/sponsors.json               sponsor slots
//   api/v1/content.json                Top Tweets, Advertise packages, About/Privacy/Terms copy (from Sanity)
//   api/v1/sources.json                every source and its health
//   api/v1/taxonomy.json               category, topic and section labels, Capital Types, Asset Classes,
//                                      geographies and transaction types
//
// News comes only from the review queue: publishApprovedNews() takes the stories an approver
// published (src/news/publicFilter.js decides) and nothing else.

import { readdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { API_DIR } from '../config.js';
import { writeJsonAtomic } from '../store/jsonStore.js';
import { buildClassifier } from '../lib/classify.js';
import { shortHash, employerIdFor, jobIdFor } from '../lib/url.js';
import { envelope, listEnvelope, NOTICES } from '../contracts/envelope.js';
import { log } from '../lib/logger.js';
import { selectPublic, licenseLookup, excerptLookup, aiSummaryLookup } from '../news/publicFilter.js';
import { DEMO_APPROVER_ID } from '../news/demoDecisions.js';
import { buildTaxonomyIndex } from '../news/reviewDocs.js';
import { NEWS_GEOGRAPHIES, NEWS_GEOGRAPHY_LABELS, NEWS_TRANSACTION_LABELS, NEWS_TRANSACTION_TYPES } from '../news/rules.js';
import { sanityImageConfigFromEnv, sanityImageUrl } from '../cms/mapping.js';
import { writeStoryPages } from './storyPages.js';
import { toStoryDto, toJobDto, toEmployerDto, toEventDto, toSourceDto } from '../contracts/serializers.js';
import { deriveEmployers, initialsFor } from './employers.js';
import { writeJobPages } from './jobPages.js';

const base = (ctx, notice) => ({ mode: ctx.settings.mode, generatedAt: ctx.now.toISOString(), notice });
// Changes only when the content changes (not on every run), so browsers can cache between runs.
const versionOf = (content) => shortHash(JSON.stringify(content), 12);
const write = (rel, doc) => writeJsonAtomic(path.join(API_DIR, rel), doc);

function removeStale(dir, keep) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json') && !keep.has(f)) unlinkSync(path.join(dir, f));
  }
}

/**
 * The page sections with their membership spelled out: topic sections keep their topics; a home box
 * ("homeSection": true) lists the Asset Classes that point at it (news-taxonomy.json homeSection).
 */
export function resolveSections(taxonomy, newsTaxonomy) {
  return (taxonomy.sections || []).map((s) => ({
    id: s.id,
    label: s.label,
    topics: s.homeSection ? [] : s.topics,
    assetClasses: s.homeSection ? (newsTaxonomy.assetClasses || []).filter((a) => a.homeSection === s.id).map((a) => a.id) : [],
    category: s.category || null
  }));
}

/** A story DTO belongs to a resolved section by topic or by Asset Class. */
export function storyMatchesSection(story, section) {
  const inTopics = section.topics.includes(story.topic) || story.topics.some((t) => section.topics.includes(t));
  const inAssets = (story.assetClasses || []).some((a) => section.assetClasses.includes(a.id));
  return (inTopics || inAssets) && (!section.category || story.category === section.category);
}

/** Writes every news file from published review documents (already passed by selectPublic). */
export function publishNews(ctx, docs) {
  const { taxonomy, newsTaxonomy, settings, allNewsSources } = ctx;
  const classifier = buildClassifier(taxonomy);
  const index = buildTaxonomyIndex(newsTaxonomy);
  const imagesAllowed = new Set(allNewsSources.filter((s) => s.allowImages === true).map((s) => s.id));
  const imageConfig = ctx.sanityImages === undefined ? sanityImageConfigFromEnv() : ctx.sanityImages;
  const dtoCtx = {
    topicLabels: classifier.topicLabels,
    categories: taxonomy.categories,
    allowsImages: (id) => imagesAllowed.has(id),
    licenseOf: licenseLookup(allNewsSources),
    index,
    imageOf: (doc) => sanityImageUrl(doc.image?.asset?._ref, imageConfig)
  };
  const items = docs
    .map((doc) => toStoryDto(doc, dtoCtx))
    .filter(Boolean)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  // Each story page needs its own address: on a clash (the Studio normally prevents it) the newer story
  // keeps the slug and the older one gets four characters of its id appended.
  const slugs = new Set();
  for (const item of items) {
    if (slugs.has(item.slug)) item.slug = `${item.slug}-${item.id.slice(2, 6)}`;
    slugs.add(item.slug);
  }
  const seoById = new Map(docs.map((d) => [d.storyId, d.seo || {}]));
  const pages = writeStoryPages(items, { publicBaseUrl: settings.publicBaseUrl, seoById });

  const { maxStories, maxPerCategory, maxArchive } = settings.news.publish;
  const b = base(ctx, NOTICES.news);
  const sections = resolveSections(taxonomy, newsTaxonomy);

  write('news.json', listEnvelope(b, items.slice(0, maxStories)));
  write('news/real-estate.json', listEnvelope(b, items.filter((i) => i.assetClasses.length).slice(0, maxArchive), { label: 'Real Estate Capital News' }));
  for (const c of taxonomy.categories) {
    write(`news/${c.id}.json`, listEnvelope(b, items.filter((i) => i.category === c.id).slice(0, maxPerCategory), { category: c.id, label: c.label }));
  }

  const topicFiles = new Set();
  for (const [topicId, label] of Object.entries(classifier.topicLabels)) {
    topicFiles.add(`${topicId}.json`);
    const list = items.filter((i) => i.topics.includes(topicId) || i.topic === topicId).slice(0, maxPerCategory);
    write(`news/topics/${topicId}.json`, listEnvelope(b, list, { topic: topicId, label }));
  }
  removeStale(path.join(API_DIR, 'news', 'topics'), topicFiles);

  const sectionFiles = new Set();
  for (const section of sections) {
    sectionFiles.add(`${section.id}.json`);
    const list = items.filter((i) => storyMatchesSection(i, section)).slice(0, maxPerCategory);
    write(`news/sections/${section.id}.json`, listEnvelope(b, list, { section: section.id, label: section.label }));
  }
  removeStale(path.join(API_DIR, 'news', 'sections'), sectionFiles);

  write('taxonomy.json', envelope(base(ctx, NOTICES.general), {
    categories: taxonomy.categories.map(({ id, label, uiLabel }) => ({ id, label, uiLabel: uiLabel || label })),
    topics: Object.entries(classifier.topicLabels).map(([id, label]) => ({ id, label })),
    sections,
    capitalTypes: index.capital.list
      .map((c) => ({ id: c.id, label: c.name, navLabel: c.showInNav ? c.navLabel : null, showInNav: c.showInNav === true, order: c.displayOrder, description: c.description || null }))
      .sort((x, y) => x.order - y.order),
    assetClasses: index.asset.list
      .map((a) => ({ id: a.id, label: a.name, homeSection: a.homeSection || null, order: a.displayOrder, description: a.description || null }))
      .sort((x, y) => x.order - y.order),
    geographies: NEWS_GEOGRAPHIES.map((id) => ({ id, label: NEWS_GEOGRAPHY_LABELS[id] })),
    transactionTypes: NEWS_TRANSACTION_TYPES.map((id) => ({ id, label: NEWS_TRANSACTION_LABELS[id] }))
  }));

  return {
    stories: items.length,
    byCategory: Object.fromEntries(taxonomy.categories.map((c) => [c.id, items.filter((i) => i.category === c.id).length])),
    pages,
    version: versionOf(items.slice(0, maxStories))
  };
}

/** Story ids in the news.json that is live now (empty if there is none). */
function readLiveStoryIds() {
  try {
    const doc = JSON.parse(readFileSync(path.join(API_DIR, 'news.json'), 'utf8'));
    return (doc.items || []).map((s) => s.id).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The only way news reaches api/v1: published stories from the review queue that pass every
 * check in src/news/publicFilter.js. Stories held back are logged by id, never by headline.
 *
 * Safety stop: a story that is live now but missing from the new set is "explained" when the
 * queue still has it (an editor unpublished or archived it, its licence changed, ...) and is
 * taken down. If the queue cannot find live stories at all (a wrong dataset, a revoked token),
 * and more than news.publish.maxDropPercent of them would vanish, nothing is written unless
 * allowDrop is set (`npm run news:publish -- --allow-drop`).
 * @returns {Promise<{refused:true, previous:number, missing:number} | ReturnType<typeof publishNews>>}
 */
export async function publishApprovedNews(ctx, { allowDrop = false } = {}) {
  const { review, settings, now, demo, allNewsSources } = ctx;
  const candidates = await review.listPublishedCandidates(now);
  const approverIds = demo ? [...settings.news.review.approverIds, DEMO_APPROVER_ID] : settings.news.review.approverIds;
  const { stories, held } = selectPublic(candidates, {
    now, approverIds, licenseOf: licenseLookup(allNewsSources), allowsExcerpt: excerptLookup(allNewsSources),
    allowsAi: aiSummaryLookup(allNewsSources)
  });
  for (const h of held) log.warn('news.story.held', { story: h.id, reasons: h.reasons.join('; ') });

  const liveIds = readLiveStoryIds();
  const publicIds = new Set(stories.map((s) => s.storyId));
  const dropped = liveIds.filter((id) => !publicIds.has(id));
  const known = dropped.length ? new Set((await review.findByStoryIds(dropped)).map((d) => d.storyId)) : new Set();
  const missing = dropped.filter((id) => !known.has(id)).length;
  const missingPercent = liveIds.length ? (missing / liveIds.length) * 100 : 0;
  if (!allowDrop && missing && (missing === liveIds.length || missingPercent > settings.news.publish.maxDropPercent)) {
    log.error('news.publish.refused', {
      live: liveIds.length, missing, maxDropPercent: settings.news.publish.maxDropPercent,
      detail: 'Live stories are missing from the review queue, so the news files were left as they are. Check the dataset and token; if the stories really were deleted, run npm run news:publish -- --allow-drop.'
    });
    return { refused: true, previous: liveIds.length, missing };
  }
  const result = publishNews(ctx, stories);
  log.info('news.published', { stories: result.stories, held: held.length, pagesWritten: result.pages.written, pagesRemoved: result.pages.removed });
  return { ...result, held: held.length };
}

export function publishJobs(ctx, jobs) {
  // Records written before employer ids existed get one on the fly.
  const withIds = jobs.map((j) => (j.employerId ? j : { ...j, employerId: employerIdFor(j.company) }));
  const open = withIds
    .filter((j) => j.status === 'open')
    .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || new Date(b.postedAt) - new Date(a.postedAt))
    .slice(0, ctx.settings.jobs.maxPublished);
  const items = open.map(toJobDto);
  write('jobs.json', listEnvelope(base(ctx, NOTICES.jobs), items));

  // Employers with a document in Sanity get their logo, description and website. Hand-picked Top Employers
  // without open roles are listed too, so the Top Employers box can show them.
  const cms = ctx.careers || { employers: [], top: { employers: [], jobs: [] } };
  // An employer document is matched through the jobs that link to it (employerKey), or else by name.
  const cmsById = new Map(cms.employers.map((e) => [employerIdFor(e.name), e]));
  const keyToId = new Map();
  for (const job of open) {
    const doc = job.employerKey && cms.employers.find((e) => e.id === job.employerKey);
    if (doc) { cmsById.set(job.employerId, doc); keyToId.set(doc.id, job.employerId); }
  }
  const enrich = (e) => {
    const doc = cmsById.get(e.id);
    return doc ? { ...e, logoUrl: doc.logoUrl, description: doc.description, website: doc.website } : e;
  };
  const derived = deriveEmployers(open, ctx.settings.employers).map(enrich);
  const topEmployerIds = [];
  for (const key of cms.top.employers) {
    const doc = cms.employers.find((e) => e.id === key);
    if (!doc) continue;
    const id = keyToId.get(doc.id) || employerIdFor(doc.name);
    topEmployerIds.push(id);
    if (!derived.some((e) => e.id === id)) derived.push(enrich({ id, name: doc.name, initials: initialsFor(doc.name), openJobs: 0, featured: false }));
  }
  const employers = derived.map(toEmployerDto);
  write('employers.json', listEnvelope(base(ctx, NOTICES.employers), employers));

  // Top Jobs: the editors' picks that are live now, in their order. Empty lists mean "automatic" on the page.
  const liveIds = new Set(items.map((j) => j.id));
  const careers = {
    topEmployers: topEmployerIds,
    topJobs: cms.top.jobs.map((id) => jobIdFor(`manual:${id}`)).filter((id) => liveIds.has(id))
  };
  write('careers.json', envelope(base(ctx, NOTICES.careers), careers));

  const pages = writeJobPages(open, { employers: cmsById, publicBaseUrl: ctx.settings.publicBaseUrl });
  log.info('jobs.published', { open: items.length, employers: employers.length, pagesWritten: pages.written, pagesRemoved: pages.removed });
  return {
    open: items.length,
    employers: employers.length,
    versions: { jobs: versionOf(items), employers: versionOf(employers), careers: versionOf([careers]) }
  };
}

export function publishEvents(ctx, events) {
  const items = events.map(toEventDto);
  write('events.json', listEnvelope(base(ctx, NOTICES.events), items));
  return { events: items.length, version: versionOf(items) };
}

export function publishSponsors(ctx, slots) {
  write('sponsors.json', envelope(base(ctx, NOTICES.sponsors), { slots }));
  return {
    counts: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, v.length])),
    version: versionOf(slots)
  };
}

/** content: the validated output of pipeline/content.js, { slots, pages }. */
export function publishContent(ctx, content) {
  write('content.json', envelope(base(ctx, NOTICES.content), content));
  return {
    counts: { ...Object.fromEntries(Object.entries(content.slots).map(([k, v]) => [k, v.length])), pages: Object.keys(content.pages).length },
    version: versionOf(content)
  };
}

export function publishSources(ctx, feedState) {
  const health = (id) => feedState?.sources?.[id] || {};
  const items = [
    ...ctx.allNewsSources.map((s) => toSourceDto(s, 'news', health(s.id))),
    ...ctx.allJobSources.map((s) => toSourceDto(s, 'jobs', health(`jobs:${s.id}`)))
  ];
  write('sources.json', listEnvelope(base(ctx, NOTICES.general), items));
}

function readExistingMeta() {
  try {
    return JSON.parse(readFileSync(path.join(API_DIR, 'meta.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Merges into the existing meta.json so a partial publish (e.g. sponsors only)
 * keeps the other counts and bumps only its own version.
 * capabilities.submissions is false here: GitHub Pages cannot accept forms.
 * The server overrides it in its /api/v1/meta response when forms are enabled, and
 * capabilities.submissionsEndpoint names that server when it lives at another address.
 */
export function publishMeta(ctx, { versions = {}, counts = {}, lastRun } = {}) {
  const previous = readExistingMeta();
  const doc = envelope(base(ctx, NOTICES.general), {
    buildId: ctx.now.toISOString().replace(/[-:.TZ]/g, ''),
    counts: { ...(previous.counts || {}), ...counts },
    lastRun: lastRun || previous.lastRun || null,
    versions: { ...(previous.versions || {}), ...versions },
    // A site hosted without the server (GitHub Pages) can still send forms to the funds.ae server named in
    // settings submissions.endpoint; js/fundsae-api.js asks that server whether it accepts them.
    capabilities: ctx.settings.submissions?.endpoint
      ? { submissions: false, submissionsEndpoint: ctx.settings.submissions.endpoint }
      : { submissions: false },
    endpoints: {
      news: 'news.json',
      newsByCategory: ctx.taxonomy.categories.map((c) => `news/${c.id}.json`),
      newsByTopic: 'news/topics/{topic}.json',
      newsBySection: 'news/sections/{section}.json',
      realEstate: 'news/real-estate.json',
      jobs: 'jobs.json',
      employers: 'employers.json',
      careers: 'careers.json',
      events: 'events.json',
      sponsors: 'sponsors.json',
      content: 'content.json',
      sources: 'sources.json',
      taxonomy: 'taxonomy.json'
    }
  });
  write('meta.json', doc);
  return doc;
}
