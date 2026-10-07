// Writes the public read-only API into api/v1/. GitHub Pages serves these
// files over HTTPS; the optional server (src/server/) serves the same files
// plus filters and paging. The shapes are the contract in src/contracts/.
//
//   api/v1/meta.json                   run info, counts, per-file versions, capabilities
//   api/v1/news.json                   latest stories, all categories
//   api/v1/news/{uae,world}.json       stories for one category
//   api/v1/news/topics/<topic>.json    stories for one topic
//   api/v1/news/sections/<id>.json     stories for one page section (topic group, e.g. the tile grids)
//   api/v1/jobs.json                   open roles
//   api/v1/employers.json              employers derived from open roles
//   api/v1/events.json                 upcoming and recent events
//   api/v1/sponsors.json               sponsor slots
//   api/v1/content.json                Top Tweets, Advertise packages, About/Privacy/Terms copy (from Sanity)
//   api/v1/sources.json                every source and its health
//   api/v1/taxonomy.json               category, topic and section labels

import { readdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { API_DIR } from '../config.js';
import { writeJsonAtomic } from '../store/jsonStore.js';
import { buildClassifier } from '../lib/classify.js';
import { shortHash, employerIdFor } from '../lib/url.js';
import { envelope, listEnvelope, NOTICES } from '../contracts/envelope.js';
import { toStoryDto, toJobDto, toEmployerDto, toEventDto, toSourceDto } from '../contracts/serializers.js';
import { deriveEmployers } from './employers.js';

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

export function storyMatchesSection(story, section) {
  const inTopics = section.topics.includes(story.topic) || story.topics.some((t) => section.topics.includes(t));
  return inTopics && (!section.category || story.category === section.category);
}

export function publishNews(ctx, { articles, stories }) {
  const { taxonomy, settings } = ctx;
  const classifier = buildClassifier(taxonomy);
  const articlesById = new Map(articles.map((a) => [a.articleId, a]));
  const items = stories
    .map((s) => toStoryDto(s, articlesById, classifier.topicLabels, taxonomy.categories))
    .filter(Boolean)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const { maxStories, maxPerCategory } = settings.news.publish;
  const b = base(ctx, NOTICES.news);
  const sections = taxonomy.sections || [];

  write('news.json', listEnvelope(b, items.slice(0, maxStories)));
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
    sections: sections.map(({ id, label, topics, category }) => ({ id, label, topics, category: category || null }))
  }));

  return {
    stories: items.length,
    byCategory: Object.fromEntries(taxonomy.categories.map((c) => [c.id, items.filter((i) => i.category === c.id).length])),
    version: versionOf(items.slice(0, maxStories))
  };
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

  const employers = deriveEmployers(open, ctx.settings.employers).map(toEmployerDto);
  write('employers.json', listEnvelope(base(ctx, NOTICES.employers), employers));

  return { open: items.length, employers: employers.length, versions: { jobs: versionOf(items), employers: versionOf(employers) } };
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
 * The server overrides it in its /api/v1/meta response when forms are enabled.
 */
export function publishMeta(ctx, { versions = {}, counts = {}, lastRun } = {}) {
  const previous = readExistingMeta();
  const doc = envelope(base(ctx, NOTICES.general), {
    buildId: ctx.now.toISOString().replace(/[-:.TZ]/g, ''),
    counts: { ...(previous.counts || {}), ...counts },
    lastRun: lastRun || previous.lastRun || null,
    versions: { ...(previous.versions || {}), ...versions },
    capabilities: { submissions: false },
    endpoints: {
      news: 'news.json',
      newsByCategory: ctx.taxonomy.categories.map((c) => `news/${c.id}.json`),
      newsByTopic: 'news/topics/{topic}.json',
      newsBySection: 'news/sections/{section}.json',
      jobs: 'jobs.json',
      employers: 'employers.json',
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
