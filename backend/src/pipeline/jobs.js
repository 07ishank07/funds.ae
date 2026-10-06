// Jobs pipeline: fetch employer boards and job feeds -> keep UAE finance roles
// -> deduplicate -> track open/closed status -> merge manual listings.

import { JOB_ADAPTERS } from '../adapters/index.js';
import { log } from '../lib/logger.js';
import { mapLimit } from '../lib/http.js';
import { htmlToText, normaliseTitle, termRegex } from '../lib/text.js';
import { canonicalizeUrl, jobIdFor, employerIdFor, isHttpUrl } from '../lib/url.js';
import { EMPLOYMENT_TYPES } from '../contracts/models.js';
import { stateFor, isPaused, recordSuccess, recordFailure } from '../lib/sourceHealth.js';

const DAY = 86_400_000;
const MANUAL_SOURCE = { id: 'manual', name: 'Funds.ae' };

export function buildJobRules(taxonomy) {
  const j = taxonomy.jobs || {};
  return {
    uae: (j.uaeLocationTerms || []).map(termRegex),
    remote: (j.remoteTerms || []).map((t) => t.toLowerCase()),
    relevance: (j.relevanceKeywords || []).map(termRegex)
  };
}

export function isUaeLocation(rules, location) {
  const loc = String(location || '').toLowerCase();
  if (!loc) return false;
  return rules.uae.some((re) => re.test(loc)) || rules.remote.some((t) => loc.includes(t));
}

export function isRelevantJob(rules, job) {
  const text = `${job.title} ${job.department || ''}`;
  return rules.relevance.some((re) => re.test(text));
}

// Boards spell these many ways (FullTime, full_time, Full Time...). Anything we
// cannot map confidently becomes null rather than a misleading label.
const EMPLOYMENT_ALIASES = {
  fulltime: 'Full-time', permanent: 'Full-time', parttime: 'Part-time', contract: 'Contract', contractor: 'Contract',
  fixedterm: 'Contract', freelance: 'Contract', intern: 'Internship', internship: 'Internship', temporary: 'Temporary', temp: 'Temporary'
};

export function normaliseEmploymentType(value) {
  const key = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  const mapped = EMPLOYMENT_ALIASES[key] || null;
  return EMPLOYMENT_TYPES.includes(mapped) ? mapped : null;
}

const fingerprintOf = (j) => [j.title, j.company, j.location].map(normaliseTitle).join('|');

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function runJobs(ctx) {
  const { settings, jobSources, taxonomy, repos, now, demo, manualJobs } = ctx;
  const cfg = settings.jobs;
  const rules = buildJobRules(taxonomy);
  const db = repos.jobs.load();
  const feedState = repos.feedState.load();
  const byId = new Map(db.jobs.map((j) => [j.jobId, j]));
  const stats = { sources: {}, fetched: 0, added: 0, updated: 0, closed: 0, filtered: {} };
  const bump = (r) => { stats.filtered[r] = (stats.filtered[r] || 0) + 1; };
  const maxAge = cfg.maxAgeDays * DAY;

  const results = await mapLimit(jobSources, settings.http.concurrency, async (source) => {
    const state = stateFor(feedState, `jobs:${source.id}`);
    const s = (stats.sources[source.id] = { name: source.name, status: 'ok', fetched: 0, kept: 0 });
    if (!demo && isPaused(state, now)) {
      s.status = state.status;
      return { source, items: [], skipped: true };
    }
    try {
      const out = await JOB_ADAPTERS[source.type](source, { settings, demo, now, state });
      recordSuccess(state, now, { lastItemCount: out.items.length });
      s.fetched = out.items.length;
      log.info('jobs.source.fetched', { source: source.id, items: out.items.length });
      return { source, items: out.items };
    } catch (err) {
      recordFailure(state, err, now, settings);
      s.status = state.status;
      s.error = state.lastError;
      log.warn('jobs.source.failed', { source: source.id, error: state.lastError, status: state.status });
      return { source, items: [], failed: true };
    }
  });

  // Manual listings behave like a source that always succeeds.
  results.push({
    source: MANUAL_SOURCE,
    manual: true,
    items: manualJobs.map((m) => ({
      externalId: m.id, title: m.title, company: m.company, location: m.location, url: m.url,
      postedAt: toDate(m.postedAt), expiresAt: toDate(m.expiresAt), department: m.department || '',
      employmentType: m.employmentType || '', featured: Boolean(m.featured)
    }))
  });

  const openFingerprints = new Map();
  for (const j of db.jobs) if (j.status === 'open') openFingerprints.set(fingerprintOf(j), j.jobId);

  for (const { source, items, failed, skipped, manual } of results) {
    const seen = new Set();
    for (const raw of items) {
      stats.fetched++;
      const job = {
        title: htmlToText(raw.title).slice(0, 160),
        company: htmlToText(raw.company).slice(0, 120),
        location: htmlToText(raw.location).slice(0, 160),
        url: String(raw.url || '').trim(),
        department: htmlToText(raw.department).slice(0, 120),
        employmentType: normaliseEmploymentType(htmlToText(raw.employmentType))
      };
      job.employerId = employerIdFor(job.company);
      if (!job.title || !job.company) { bump('missing-fields'); continue; }
      if (!isHttpUrl(job.url)) { bump('invalid-link'); continue; }
      const postedAt = toDate(raw.postedAt) || now;
      if (raw.expiresAt && raw.expiresAt < now) { bump('expired'); continue; }
      if (now - postedAt > maxAge) { bump('too-old'); continue; }
      if (!manual && source.requireUaeLocation !== false && !isUaeLocation(rules, job.location)) { bump('not-uae'); continue; }
      if (!manual && source.relevanceFilter && !isRelevantJob(rules, job)) { bump('not-finance'); continue; }

      const canonical = canonicalizeUrl(job.url);
      const jobId = jobIdFor(manual ? `manual:${raw.externalId}` : canonical);
      seen.add(jobId);
      const fp = fingerprintOf(job);
      const dupOf = openFingerprints.get(fp);
      if (dupOf && dupOf !== jobId) { bump('duplicate'); continue; }

      const existing = byId.get(jobId);
      if (existing) {
        Object.assign(existing, job, {
          status: 'open', closedAt: null, lastSeenAt: now.toISOString(),
          featured: Boolean(raw.featured) || undefined,
          expiresAt: raw.expiresAt ? raw.expiresAt.toISOString() : undefined
        });
        stats.updated++;
      } else {
        const record = {
          jobId,
          sourceId: source.id,
          sourceName: source.name,
          externalId: String(raw.externalId || ''),
          ...job,
          canonicalUrl: canonical,
          postedAt: postedAt.toISOString(),
          expiresAt: raw.expiresAt ? raw.expiresAt.toISOString() : undefined,
          featured: Boolean(raw.featured) || undefined,
          status: 'open',
          firstSeenAt: now.toISOString(),
          lastSeenAt: now.toISOString()
        };
        byId.set(jobId, record);
        openFingerprints.set(fp, jobId);
        stats.added++;
      }
      if (stats.sources[source.id]) stats.sources[source.id].kept++;
    }

    // A role that vanished from a source we fetched successfully has been filled or withdrawn.
    if (!failed && !skipped) {
      for (const j of byId.values()) {
        if (j.sourceId === source.id && j.status === 'open' && !seen.has(j.jobId)) {
          j.status = 'closed';
          j.closedAt = now.toISOString();
          stats.closed++;
        }
      }
    }
  }

  // Age out old open roles and forget closed ones after 90 days.
  for (const [id, j] of byId) {
    if (j.status === 'open' && (now - new Date(j.postedAt) > maxAge || (j.expiresAt && new Date(j.expiresAt) < now))) {
      j.status = 'expired';
      j.closedAt = now.toISOString();
      stats.closed++;
    }
    if (j.status !== 'open' && j.closedAt && now - new Date(j.closedAt) > 90 * DAY) byId.delete(id);
  }

  const jobs = [...byId.values()].sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
  repos.jobs.save({ updatedAt: now.toISOString(), jobs });
  repos.feedState.save(feedState);

  const failedSources = results.filter((r) => r.failed).length;
  const skippedSources = results.filter((r) => r.skipped).length;
  log.info('jobs.done', { fetched: stats.fetched, added: stats.added, updated: stats.updated, closed: stats.closed, open: jobs.filter((j) => j.status === 'open').length, filtered: stats.filtered });
  return { stats, jobs, failedSources, skippedSources, totalSources: jobSources.length };
}
