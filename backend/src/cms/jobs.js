// Loads the Careers section from Sanity for the jobs pipeline (settings jobs.source "sanity"), read-only:
// published jobs, employers and the Top Employers / Top Jobs lists. The query names every field it needs and
// never the filer (name, email), so contact details cannot leave Sanity. Every job is checked again by
// src/jobs/publicFilter.js; held jobs are logged by id only.

import { querySanity, sanityConfigFromEnv } from './sanity.js';
import { sanityImageUrl } from './mapping.js';
import { publicJobId, selectPublicJobs, toPublicJob } from '../jobs/publicFilter.js';
import { log } from '../lib/logger.js';

const JOB_FIELDS = [
  '_id', 'status', 'approval', 'publishedAt', 'firstPublishedAt', 'title', 'slug', 'company', 'employer', 'companyUrl',
  'location', 'workMode', 'employmentType', 'seniority', 'department', 'regulator', 'url', 'salaryFrom', 'salaryTo',
  'salaryCurrency', 'salaryPeriod', 'visa', 'description', 'requirements', 'expiresAt'
].join(', ');

export const CAREERS_QUERY = `{
  "jobs": *[_type == "jobPosting" && status == "published" && !(_id in path("drafts.**"))] { ${JOB_FIELDS} },
  "employers": *[_type == "employer" && !(_id in path("drafts.**"))] { _id, name, "id": id.current, "logoRef": logo.asset._ref, description, website },
  "careers": *[_id == "careersPage"][0] { "topEmployers": topEmployers[]._ref, "topJobs": topJobs[]._ref }
}`;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {{settings:object, now:Date, env?:object, http?:object, approverIds?:string[]}} o
 *   http: extra querySanity options (tests: baseUrl, retries)
 * @returns {Promise<{listings:object[], employers:object[], top:{employers:string[], jobs:string[]}, held:object[]}>}
 *   listings: manual listings for src/pipeline/jobs.js; employers: {id, name, logoUrl, description, website};
 *   top: employer ids and public job ids in the editors' order.
 */
export async function loadCareersFromSanity({ settings, now, env = process.env, http = {}, approverIds = settings.news.review.approverIds }) {
  const sanity = sanityConfigFromEnv(env);
  const result = await querySanity(sanity, CAREERS_QUERY, { tag: 'fundsae.careers.pull', ...http });
  const employers = (result?.employers || [])
    // The Studio limits these too; the backend checks again before anything is published.
    .filter((e) => text(e.name).length >= 2 && text(e.name).length <= 120 && /^[a-z0-9][a-z0-9-]{1,60}$/.test(e.id || ''))
    .map((e) => ({
      docId: e._id,
      id: e.id,
      name: text(e.name),
      logoUrl: sanityImageUrl(e.logoRef, sanity),
      description: text(e.description).slice(0, 400) || null,
      website: /^https:\/\/[^\s"'<>]+$/.test(text(e.website)) ? text(e.website) : null
    }));
  const byDocId = new Map(employers.map((e) => [e.docId, e]));
  const { jobs, held } = selectPublicJobs(result?.jobs || [], { now, approverIds });
  for (const h of held) log.warn('jobs.held', { job: h.id, reasons: h.reasons.join('; ') });
  const listings = jobs.map((doc) => toPublicJob(doc, byDocId));
  const publicIds = new Set(jobs.map((doc) => doc._id));
  const careers = result?.careers || {};
  const top = {
    employers: (careers.topEmployers || []).map((ref) => byDocId.get(ref)?.id).filter(Boolean),
    // Only jobs that are live now; anything else in the list is skipped.
    jobs: (careers.topJobs || []).filter((ref) => publicIds.has(ref)).map(publicJobId)
  };
  log.info('jobs.cms.loaded', { published: listings.length, held: held.length, employers: employers.length });
  return { listings, employers: employers.map(({ docId, ...e }) => e), top, held };
}
