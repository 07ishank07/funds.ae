#!/usr/bin/env node
// Command-line entry point.
//
//   node src/cli.js all               news + jobs + events + sponsors + content, then publish (used by the daily job)
//   node src/cli.js news              news only (republishes news, jobs, sources and meta)
//   node src/cli.js jobs              jobs only (same publishing as above)
//   node src/cli.js sponsors          validate and publish sponsors only
//   node src/cli.js events            validate and publish events only
//   node src/cli.js content           sponsors + events + content.json (used when an editor changes any of them)
//   node src/cli.js cms:pull          copy published Sanity content into config/ (needs content.source "sanity")
//   node src/cli.js validate          check every config file, change nothing
//   node src/cli.js reset-feed ID     un-pause a source after you fix its URL
//   node src/cli.js submissions:prune delete form submissions older than settings.submissions.retentionDays
//
// Exit codes: 0 = success (including partial source failures),
//             1 = configuration or code error (invalid sponsors/events/content keep the previous file live),
//             2 = every enabled source failed (the daily job is marked failed so you get an email).

import path from 'node:path';
import { rmSync } from 'node:fs';
import { loadAll, loadSponsorsConfig, DATA_DIR } from './config.js';
import { JsonStore } from './store/jsonStore.js';
import { createRepositories, createSubmissionsRepository, DEMO_RESETTABLE } from './repositories/index.js';
import { log } from './lib/logger.js';
import { resetState } from './lib/sourceHealth.js';
import { runNews } from './pipeline/news.js';
import { runJobs } from './pipeline/jobs.js';
import { runEvents } from './pipeline/events.js';
import { publishableSponsors } from './pipeline/sponsors.js';
import { runContent } from './pipeline/content.js';
import { pullFromSanity } from './cms/pull.js';
import { publishNews, publishJobs, publishEvents, publishSponsors, publishContent, publishSources, publishMeta } from './pipeline/publish.js';

const COMMANDS = ['all', 'news', 'jobs', 'sponsors', 'events', 'content', 'validate', 'reset-feed', 'submissions:prune', 'cms:pull'];

/** Republishes everything derived from the news and jobs databases. */
function publishData(ctx) {
  const news = publishNews(ctx, ctx.repos.news.load());
  const jobs = publishJobs(ctx, ctx.repos.jobs.load().jobs);
  publishSources(ctx, ctx.repos.feedState.load());
  return {
    counts: { stories: news.stories, ...news.byCategory, jobs: jobs.open, employers: jobs.employers },
    versions: { news: news.version, ...jobs.versions }
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
  const [command = 'all', arg] = process.argv.slice(2);
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
  const repos = createRepositories(new JsonStore(dataDir));
  const ctx = { ...cfg, repos, now: startedAt };

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
    const found = resetState(state, arg) || resetState(state, `jobs:${arg}`);
    repos.feedState.save(state);
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
      const data = publishData(ctx);
      Object.assign(versions, data.versions);
      Object.assign(counts, data.counts);
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
