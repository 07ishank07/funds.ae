#!/usr/bin/env node
// Command-line entry point.
//
//   node src/cli.js all               news + jobs + events + sponsors + content, then publish (used by the daily job)
//   node src/cli.js news              fetch news into the review queue, then republish approved news, jobs, sources, meta
//   node src/cli.js jobs              jobs only (republishes jobs, sources and meta; never news)
//   node src/cli.js news:publish      publish the stories approvers published in the review queue (--allow-drop: skip the safety stop)
//   node src/cli.js news:prune        delete stale pending and rejected stories from the review queue
//   node src/cli.js sponsors          validate and publish sponsors only
//   node src/cli.js events            validate and publish events only
//   node src/cli.js content           sponsors + events + content.json (used when an editor changes any of them)
//   node src/cli.js cms:pull          copy published Sanity content into config/ (needs content.source "sanity")
//   node src/cli.js validate          check every config file, change nothing
//   node src/cli.js reset-feed ID     un-pause a source after you fix its URL
//   node src/cli.js submissions:prune delete form submissions older than settings.submissions.retentionDays
//
// Exit codes: 0 = success (including partial source failures),
//             1 = configuration or code error (invalid sponsors/events/content keep the previous file live;
//                 a refused news publish keeps the previous news files live),
//             2 = every enabled source failed (the daily job is marked failed so you get an email).

import path from 'node:path';
import { rmSync } from 'node:fs';
import { loadAll, loadSponsorsConfig, DATA_DIR } from './config.js';
import { JsonStore } from './store/jsonStore.js';
import { createRepositories, createSubmissionsRepository, DEMO_RESETTABLE } from './repositories/index.js';
import { createNewsReviewRepository } from './repositories/newsReview.js';
import { createSanityNewsHealth } from './repositories/newsReview.sanity.js';
import { applyDemoDecisions } from './news/demoDecisions.js';
import { pruneMutation } from './news/importerMutations.js';
import { log } from './lib/logger.js';
import { resetState } from './lib/sourceHealth.js';
import { runNews } from './pipeline/news.js';
import { runJobs } from './pipeline/jobs.js';
import { runEvents } from './pipeline/events.js';
import { publishableSponsors } from './pipeline/sponsors.js';
import { runContent } from './pipeline/content.js';
import { pullFromSanity } from './cms/pull.js';
import { publishApprovedNews, publishJobs, publishEvents, publishSponsors, publishContent, publishSources, publishMeta } from './pipeline/publish.js';

const COMMANDS = ['all', 'news', 'jobs', 'sponsors', 'events', 'content', 'validate', 'reset-feed', 'submissions:prune', 'cms:pull', 'news:publish', 'news:prune'];

/** News part of a publish: approved stories only. Empty counts and versions when the safety stop refused. */
async function newsStep(ctx, options) {
  const news = await publishApprovedNews(ctx, options);
  if (news.refused) return { refused: true, counts: {}, versions: {} };
  return { refused: false, counts: { stories: news.stories, ...news.byCategory }, versions: { news: news.version } };
}

/** News source health (feed-state.json, or the Sanity queue's state document) plus jobs health (feed-state.json). */
async function sourceHealth(ctx) {
  const jobs = Object.entries(ctx.repos.feedState.load().sources || {}).filter(([id]) => id.startsWith('jobs:'));
  return { sources: { ...(await ctx.newsHealth.load()).sources, ...Object.fromEntries(jobs) } };
}

/** Republishes jobs and source health, and news when `withNews` (never for a jobs-only run). */
async function publishData(ctx, { withNews, allowDrop }) {
  const news = withNews ? await newsStep(ctx, { allowDrop }) : { refused: false, counts: {}, versions: {} };
  const jobs = publishJobs(ctx, ctx.repos.jobs.load().jobs);
  publishSources(ctx, await sourceHealth(ctx));
  return {
    newsRefused: news.refused,
    counts: { ...news.counts, jobs: jobs.open, employers: jobs.employers },
    versions: { ...news.versions, ...jobs.versions }
  };
}

function sponsorsStep(ctx) {
  const result = publishableSponsors(loadSponsorsConfig());
  if (!result.ok) return { ok: false, errors: result.errors };
  const published = publishSponsors(ctx, result.slots);
  log.info('sponsors.published', published.counts);
  return { ok: true, counts: published.counts, version: published.version };
}

function eventsStep(ctx) {
  const result = runEvents(ctx);
  if (!result.ok) return { ok: false, errors: result.errors };
  const published = publishEvents(ctx, result.events);
  log.info('events.published', { events: published.events });
  return { ok: true, events: published.events, version: published.version };
}

function contentStep(ctx) {
  const result = runContent(ctx);
  if (!result.ok) return { ok: false, errors: result.errors };
  const published = publishContent(ctx, result.content);
  log.info('content.published', published.counts);
  return { ok: true, counts: published.counts, version: published.version };
}

async function main() {
  const args = process.argv.slice(2);
  const allowDrop = args.includes('--allow-drop');
  const [command = 'all', arg] = args.filter((a) => a !== '--allow-drop');
  if (!COMMANDS.includes(command)) {
    log.error('cli.unknown-command', { command, detail: `Use one of: ${COMMANDS.join(', ')}` });
    process.exitCode = 1;
    return;
  }
  const startedAt = new Date();
  let cfg;
  try {
    cfg = loadAll();
  } catch (err) {
    log.error('config.invalid', { detail: err.message });
    process.exitCode = 1;
    return;
  }
  for (const detail of cfg.warnings) log.warn('config.warning', { detail });
  // Demo data lives in its own folder so fictional stories never mix with the
  // live database. It is rebuilt on every full run so demo dates stay current.
  const dataDir = cfg.demo ? path.join(DATA_DIR, 'demo') : DATA_DIR;
  if (cfg.demo && command === 'all') {
    for (const f of DEMO_RESETTABLE) rmSync(path.join(dataDir, f), { force: true });
  }
  const store = new JsonStore(dataDir);
  const repos = createRepositories(store);
  let review;
  try {
    review = createNewsReviewRepository(cfg, store);
  } catch (err) {
    log.error('config.invalid', { detail: err.message });
    process.exitCode = 1;
    return;
  }
  // Source health for news: feed-state.json, shared with jobs; the Sanity queue keeps it in its state document.
  const newsHealth = review.kind === 'sanity'
    ? createSanityNewsHealth(review)
    : { load: () => repos.feedState.load(), save: (state) => repos.feedState.save(state) };
  const ctx = { ...cfg, repos, review, newsHealth, now: startedAt };

  if (command === 'validate') {
    const sponsors = publishableSponsors(loadSponsorsConfig());
    const events = runEvents(ctx);
    const content = runContent(ctx);
    if (!sponsors.ok || !events.ok || !content.ok) { process.exitCode = 1; return; }
    log.info('config.valid', { mode: cfg.settings.mode, newsSources: cfg.newsSources.length, jobSources: cfg.jobSources.length, events: events.events.length });
    return;
  }

  if (command === 'reset-feed') {
    if (!arg) { log.error('reset-feed.usage', { detail: 'Give the source id, e.g. npm run reset-feed -- gulf-business' }); process.exitCode = 1; return; }
    const state = repos.feedState.load();
    let found = resetState(state, `jobs:${arg}`);
    if (found) repos.feedState.save(state);
    else {
      // News sources: feed-state.json, or the Sanity queue's state document (needs SANITY_WRITE_TOKEN).
      try {
        const news = await newsHealth.load();
        found = resetState(news, arg);
        if (found) {
          newsHealth.save(news);
          if (newsHealth.flush) await newsHealth.flush({ now: startedAt, lastRun: (await review.loadState())?.lastRun });
        }
      } catch (err) {
        log.error('reset-feed.failed', { detail: err?.message || String(err) });
        process.exitCode = 1;
        return;
      }
    }
    log.info(found ? 'reset-feed.done' : 'reset-feed.not-found', { source: arg });
    return;
  }

  if (command === 'cms:pull') {
    if (cfg.settings.content.source !== 'sanity') {
      log.error('cms.disabled', { detail: 'settings.json content.source is "file", so config/ is edited by hand and nothing is pulled. Import the content into Sanity first (docs/SANITY-CMS-GUIDE.md), then set it to "sanity".' });
      process.exitCode = 1;
      return;
    }
    try {
      const r = await pullFromSanity({ settings: cfg.settings, now: startedAt });
      if (!r.ok) {
        for (const detail of r.errors) log.error('cms.invalid', { detail });
        log.error('cms.not-written', { detail: 'Nothing was written; the site keeps its current content. Fix the items above in the Studio and publish again.' });
        process.exitCode = 1;
        return;
      }
      log.info('cms.pulled', r.counts);
    } catch (err) {
      log.error('cms.failed', { detail: err?.message || String(err) });
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'news:publish') {
    try {
      const news = await newsStep(ctx, { allowDrop });
      if (news.refused) { process.exitCode = 1; return; }
      publishSources(ctx, await sourceHealth(ctx));
      publishMeta(ctx, { versions: news.versions, counts: news.counts });
    } catch (err) {
      log.error('news.publish-failed', { detail: err?.message || String(err) });
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'news:prune') {
    const { pendingTtlDays, rejectedTtlDays } = cfg.settings.news.review;
    try {
      const written = await review.commit([pruneMutation({ now: startedAt, pendingTtlDays, rejectedTtlDays })]);
      log.info('news.pruned', { deleted: written.deleted, pendingTtlDays, rejectedTtlDays });
    } catch (err) {
      log.error('news.prune-failed', { detail: err?.message || String(err) });
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'submissions:prune') {
    const submissions = createSubmissionsRepository(dataDir);
    const removed = await submissions.prune(cfg.settings.submissions.retentionDays, startedAt);
    log.info('submissions.pruned', { removed, retentionDays: cfg.settings.submissions.retentionDays });
    return;
  }

  log.info('run.start', { command, mode: cfg.settings.mode });
  const run = { command, mode: cfg.settings.mode, startedAt: startedAt.toISOString(), steps: {} };
  const runsData = ['all', 'news', 'jobs'].includes(command);
  let totalSources = 0;
  let failedSources = 0;
  let skippedSources = 0;
  let contentFailed = false;
  const versions = {};
  const counts = {};

  try {
    if (command === 'all' || command === 'news') {
      const r = await runNews(ctx);
      run.steps.news = r.stats;
      if (newsHealth.flush) {
        const { fetched, queue, attached, duplicates } = r.stats;
        await newsHealth.flush({
          now: startedAt,
          lastRun: {
            status: r.failedSources && r.failedSources === r.totalSources ? 'all-sources-failed' : r.failedSources ? 'partial' : 'ok',
            fetched, queued: queue.created, attached, duplicates, pruned: queue.deleted, failedSources: r.failedSources, totalSources: r.totalSources
          },
          documents: { count: queue.documents, ...cfg.settings.news.review.documentBudget }
        });
      }
      if (cfg.demo) run.steps.demoDecisions = await applyDemoDecisions(ctx);
      totalSources += r.totalSources;
      failedSources += r.failedSources;
      skippedSources += r.skippedSources;
    }
    if (command === 'all' || command === 'jobs') {
      const r = await runJobs(ctx);
      run.steps.jobs = r.stats;
      totalSources += r.totalSources;
      failedSources += r.failedSources;
      skippedSources += r.skippedSources;
    }
    if (['all', 'events', 'content'].includes(command)) {
      const r = eventsStep(ctx);
      run.steps.events = r;
      if (r.ok) { versions.events = r.version; counts.events = r.events; } else contentFailed = true;
    }
    if (['all', 'sponsors', 'content'].includes(command)) {
      const r = sponsorsStep(ctx);
      run.steps.sponsors = r;
      if (r.ok) versions.sponsors = r.version; else contentFailed = true;
    }
    if (['all', 'content'].includes(command)) {
      const r = contentStep(ctx);
      run.steps.content = r;
      if (r.ok) versions.content = r.version; else contentFailed = true;
    }

    run.finishedAt = new Date().toISOString();
    if (runsData) {
      run.status = totalSources > 0 && failedSources === totalSources ? 'all-sources-failed'
        : failedSources || skippedSources ? 'partial' : 'ok';
      if (contentFailed && run.status !== 'all-sources-failed') run.status = 'invalid-content';
      // With the Sanity queue, news reaches the site only through `news:publish` (the publish workflow,
      // read-only token); the importer's run only fills the queue.
      const data = await publishData(ctx, { withNews: command !== 'jobs' && review.kind === 'file', allowDrop });
      Object.assign(versions, data.versions);
      Object.assign(counts, data.counts);
      if (data.newsRefused) process.exitCode = 1; // the previous news files stay live
      publishMeta(ctx, { versions, counts, lastRun: { at: run.finishedAt, status: run.status, failedSources, skippedSources, totalSources } });
    } else {
      run.status = contentFailed ? 'invalid-content' : 'ok';
      // Bump only the versions of what was republished so browsers refetch it.
      publishMeta(ctx, { versions, counts });
    }
    if (contentFailed) process.exitCode = 1; // the previous sponsors/events/content files stay live
  } catch (err) {
    run.status = 'crashed';
    run.error = String(err?.stack || err).slice(0, 2000);
    log.error('run.crashed', { detail: err?.message || String(err) });
    process.exitCode = 1;
  }

  const { warnings, errors } = log.collected();
  run.warnings = warnings.slice(0, 50);
  run.errors = errors.slice(0, 50);
  run.durationMs = Date.now() - startedAt.getTime();
  repos.runs.record(run, cfg.settings.runHistoryLength || 30);

  if (run.status === 'all-sources-failed') process.exitCode = 2;
  log.info('run.finished', { status: run.status, durationMs: run.durationMs, warnings: warnings.length, errors: errors.length });
}

main().catch((err) => {
  log.error('run.fatal', { detail: err?.stack || String(err) });
  process.exitCode = 1;
});
