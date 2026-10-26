// The news review queue in Sanity (settings.json news.review.store "sanity"): newsArticle
// documents under private queue.* ids. Same methods as the file queue (repositories/newsReview.js).
// Reads use the read token (or the importer's write token); commit() needs SANITY_WRITE_TOKEN and
// accepts nothing but the importer mutations in src/news/importerMutations.js. Every request is
// tagged ("fundsae.news.*") so Sanity's request log, and the tests, can tell them apart.

import { querySanity, mutateSanity } from '../cms/sanity.js';
import {
  AGGREGATOR_STATE_QUERY, DOCUMENT_COUNT_QUERY, NEWS_BY_STORY_QUERY, NEWS_DRAFTS_QUERY, NEWS_PUBLISHED_QUERY, NEWS_RECENT_QUERY
} from '../cms/queries.js';
import { feedStateFromSanity, fromSanityNewsDoc, stateFieldsFromFeedState } from '../cms/mapping.js';
import { assertImporterMutation, stateMutation } from '../news/importerMutations.js';
import { draftIdFor, isReviewId } from '../news/reviewDocs.js';

const docsOf = (result) => (Array.isArray(result) ? result.map(fromSanityNewsDoc).filter((d) => d && isReviewId(d._id)) : []);

/**
 * @param {ReturnType<import('../cms/sanity.js').sanityConfigFromEnv>} sanity
 * @param {{userAgent?:string, http?:object}} options  http: extra request options (tests: baseUrl, retries)
 * @returns {import('./newsReview.js').NewsReviewRepository}
 */
export function createSanityNewsReview(sanity, { userAgent, http = {} } = {}) {
  const query = (groq, tag, params = {}) =>
    querySanity(sanity, groq, { perspective: 'raw', params, tag: `fundsae.news.${tag}`, userAgent, ...http });

  return {
    kind: 'sanity',

    async loadRecent(since) {
      return docsOf(await query(NEWS_RECENT_QUERY, 'recent', { since: since.toISOString() }));
    },

    async existingDraftIds(ids) {
      if (!ids.length) return new Set();
      const found = await query(NEWS_DRAFTS_QUERY, 'drafts', { draftIds: ids.map(draftIdFor) });
      return new Set((Array.isArray(found) ? found : []).map((id) => String(id).replace(/^drafts\./, '')));
    },

    async commit(mutations) {
      mutations.forEach(assertImporterMutation); // nothing is sent unless every mutation is allowed
      if (!mutations.length) return { created: 0, patched: 0, deleted: 0 };
      const results = await mutateSanity(sanity, mutations, { tag: 'fundsae.news.import', userAgent, ...http });
      // createIfNotExists on an existing story reports "update", so only patched ids count as patched.
      const patchTargets = new Set(mutations.filter((m) => m.patch).map((m) => m.patch.id));
      return {
        created: results.filter((r) => r.operation === 'create' && isReviewId(r.id)).length,
        patched: results.filter((r) => r.operation === 'update' && patchTargets.has(r.id)).length,
        deleted: results.filter((r) => r.operation === 'delete' && isReviewId(String(r.id).replace(/^drafts\./, ''))).length
      };
    },

    async listPublishedCandidates(now) {
      return docsOf(await query(NEWS_PUBLISHED_QUERY, 'published', { now: now.toISOString() }));
    },

    async findByStoryIds(storyIds) {
      if (!storyIds.length) return [];
      const found = await query(NEWS_BY_STORY_QUERY, 'by-story', { storyIds });
      return (Array.isArray(found) ? found : []).filter((d) => isReviewId(d?._id)).map(({ _id, storyId, status }) => ({ _id, storyId, status }));
    },

    async count() {
      return Number(await query(DOCUMENT_COUNT_QUERY, 'count')) || 0;
    },

    async loadState() {
      return query(AGGREGATOR_STATE_QUERY, 'state');
    }
  };
}

/**
 * News source health kept in the newsAggregatorState document instead of feed-state.json.
 * runNews loads and saves it like the file; flush() writes it to Sanity once per run, together
 * with the run summary and the document count shown in the Studio's "Aggregator status".
 */
export function createSanityNewsHealth(repo) {
  let state = null;
  return {
    async load() {
      if (!state) state = feedStateFromSanity(await repo.loadState());
      return state;
    },
    save(next) {
      state = next;
    },
    async flush({ now, lastRun, documents }) {
      if (!state) return;
      await repo.commit([stateMutation(stateFieldsFromFeedState(state, { now, lastRun, documents }))]);
    }
  };
}
