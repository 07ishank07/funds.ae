// The news review queue. Two implementations with the same methods:
//   file   - data/demo/news-review.json (demo mode) or data/news-review.json (tests, local runs)
//   sanity - newsArticle documents under queue.* ids in the Sanity Studio (live; repositories/newsReview.sanity.js)
// settings.json news.review.store picks one. The importer only writes through commit(), which
// accepts nothing but the mutations in src/news/importerMutations.js.

import { ConfigError } from '../config.js';
import { assertImporterMutation, pruneMatches, STATE_DOC_ID } from '../news/importerMutations.js';
import { isReviewId } from '../news/reviewDocs.js';

export const REVIEW_FILE = 'news-review.json';
const DEFAULTS = { docs: [], state: null };

/**
 * @typedef {Object} NewsReviewRepository
 * @property {'file'|'sanity'} kind
 * @property {(since:Date) => Promise<object[]>} loadRecent    stories imported or seen since `since`, any status
 * @property {(ids:string[]) => Promise<Set<string>>} existingDraftIds  which of these stories have an open draft
 * @property {(mutations:object[]) => Promise<{created:number, patched:number, deleted:number}>} commit
 * @property {(now:Date) => Promise<object[]>} listPublishedCandidates  status published, due; checked again by selectPublic()
 * @property {(storyIds:string[]) => Promise<{_id:string, storyId:string, status:string}[]>} findByStoryIds  any status (the safety stop)
 * @property {() => Promise<number>} count                     documents held (the Sanity plan's budget)
 * @property {() => Promise<object|null>} loadState            the importer's own state (source health, last run)
 */

const time = (value) => (value ? new Date(value).getTime() : 0);

function applyPatch(doc, patch) {
  for (const [field, value] of Object.entries(patch.setIfMissing || {})) if (doc[field] === undefined) doc[field] = structuredClone(value);
  for (const [field, value] of Object.entries(patch.set || {})) doc[field] = structuredClone(value);
}

/**
 * The queue settings.json news.review.store asks for.
 * Live mode refuses the file queue: GitHub Pages serves backend/data, so pending stories in a
 * committed file would be public. Tests and local experiments can allow it with
 * FUNDSAE_ALLOW_FILE_QUEUE=1 (the live file is git-ignored too).
 */
export function createNewsReviewRepository({ settings, demo }, store) {
  const kind = settings.news.review.store;
  if (kind === 'sanity') {
    throw new ConfigError('settings.json news.review.store "sanity" needs the Sanity queue, which is not built yet. Use "file".');
  }
  if (!demo && process.env.FUNDSAE_ALLOW_FILE_QUEUE !== '1') {
    throw new ConfigError(
      'Live mode keeps the news review queue in Sanity (settings.json news.review.store "sanity"). ' +
      'A file queue would be published by GitHub Pages. See docs/NEWS-REVIEW-GUIDE.md.'
    );
  }
  return createFileNewsReview(store, { editorialWrites: demo });
}

/**
 * @param {import('../store/jsonStore.js').JsonStore} store
 * @param {{editorialWrites?: boolean}} options  editorialWrites: allow decide() (demo decisions and tests only)
 * @returns {NewsReviewRepository & {decide?: Function}}
 */
export function createFileNewsReview(store, { editorialWrites = false } = {}) {
  const load = () => store.load(REVIEW_FILE, DEFAULTS);
  const save = (data) => store.save(REVIEW_FILE, data);

  const repo = {
    kind: 'file',

    async loadRecent(since) {
      const from = since.getTime();
      return load().docs.filter((d) => isReviewId(d._id) && (time(d.lastSeenAt) >= from || time(d.importedAt) >= from));
    },

    async existingDraftIds() {
      return new Set(); // the file queue has no drafts
    },

    async commit(mutations) {
      mutations.forEach(assertImporterMutation); // all or nothing, like a Sanity transaction
      const data = load();
      const byId = new Map(data.docs.map((d) => [d._id, d]));
      const counts = { created: 0, patched: 0, deleted: 0 };
      for (const m of mutations) {
        if (m.createIfNotExists) {
          const doc = m.createIfNotExists;
          if (!byId.has(doc._id)) {
            byId.set(doc._id, structuredClone(doc));
            counts.created++;
          }
        } else if (m.patch) {
          const doc = byId.get(m.patch.id);
          if (!doc) throw new Error(`Document "${m.patch.id}" not found (patch).`);
          applyPatch(doc, m.patch);
          counts.patched++;
        } else if (m.delete) {
          for (const [id, doc] of byId) {
            if (pruneMatches(doc, m.delete.params)) {
              byId.delete(id);
              counts.deleted++;
            }
          }
        } else if (m.createOrReplace?._id === STATE_DOC_ID) {
          data.state = structuredClone(m.createOrReplace);
        }
      }
      save({ ...data, docs: [...byId.values()] });
      return counts;
    },

    async listPublishedCandidates(now) {
      return load().docs.filter((d) => isReviewId(d._id) && d.status === 'published' && time(d.publishedAt) <= now.getTime());
    },

    async findByStoryIds(storyIds) {
      const wanted = new Set(storyIds);
      return load().docs.filter((d) => isReviewId(d._id) && wanted.has(d.storyId)).map(({ _id, storyId, status }) => ({ _id, storyId, status }));
    },

    async count() {
      return load().docs.length;
    },

    async loadState() {
      return load().state;
    }
  };

  if (editorialWrites) {
    /**
     * An editor's decision, applied directly: only for the demo decisions fixture and tests.
     * The live Sanity queue has no such method; editors decide in the Studio.
     */
    repo.decide = async (id, set) => {
      const data = load();
      const doc = data.docs.find((d) => d._id === id);
      if (!doc) throw new Error(`Document "${id}" not found.`);
      Object.assign(doc, structuredClone(set));
      save(data);
      return doc;
    };
  }
  return repo;
}
