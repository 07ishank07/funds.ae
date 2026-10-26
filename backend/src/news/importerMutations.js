// Everything the news importer may write, and the guard that refuses anything else.
//
// The importer creates pending stories, refreshes a few ingest-owned fields, prunes
// stale stories and records its own run state. It can never set a status other than
// pending_review, never write approval or publication fields, and never edit what
// editors own (src/news/rules.js). Every mutation passes assertImporterMutation()
// before it is sent to Sanity or applied to the file queue; tests check every request.

import { NEWS_INGEST_FIELDS, NEWS_INGEST_PATCH_FIELDS, NEWS_LIMITS, NEWS_PREFILL_FIELDS } from './rules.js';
import { NEWS_DOC_TYPE, draftIdFor, isReviewId } from './reviewDocs.js';

export class ImporterMutationError extends Error {}

export const STATE_DOC_ID = 'newsAggregatorState';
export const STATE_DOC_TYPE = 'newsAggregatorState';
const STATE_FIELDS = new Set(['_id', '_type', 'updatedAt', 'lastRun', 'sources', 'documents']);
const CREATE_FIELDS = new Set(['_id', '_type', 'status', 'statusChangedAt', ...NEWS_INGEST_FIELDS, ...NEWS_PREFILL_FIELDS]);
const PATCH_FIELDS = new Set(NEWS_INGEST_PATCH_FIELDS);
const PATCH_OPS = new Set(['set', 'setIfMissing']);

/**
 * Stale stories nobody decided on, and rejected ones, after their TTL. Approved, published and
 * archived stories never match. Sanity runs this filter server-side inside the delete, so a story
 * an editor acts on in the meantime cannot be deleted. pruneMatches() is the same rule in JavaScript.
 */
export const PRUNE_QUERY =
  '*[_type == "newsArticle" && (_id in path("queue.*") || _id in path("drafts.queue.*")) && ' +
  '((status == "pending_review" && dateTime(lastSeenAt) < dateTime($pendingBefore)) || ' +
  '(status == "rejected" && dateTime(coalesce(statusChangedAt, lastSeenAt)) < dateTime($rejectedBefore)))]';

export function pruneParams({ now, pendingTtlDays, rejectedTtlDays }) {
  const daysAgo = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();
  return { pendingBefore: daysAgo(pendingTtlDays), rejectedBefore: daysAgo(rejectedTtlDays) };
}

export function pruneMatches(doc, { pendingBefore, rejectedBefore }) {
  const id = String(doc?._id || '');
  if (doc?._type !== NEWS_DOC_TYPE || !(isReviewId(id) || isReviewId(id.replace(/^drafts\./, '')))) return false;
  const before = (value, limit) => typeof value === 'string' && new Date(value) < new Date(limit);
  if (doc.status === 'pending_review') return before(doc.lastSeenAt, pendingBefore);
  if (doc.status === 'rejected') return before(doc.statusChangedAt || doc.lastSeenAt, rejectedBefore);
  return false;
}

const fail = (message) => {
  throw new ImporterMutationError(`Refused importer mutation: ${message}`);
};

/** Never more than a 280-character excerpt or summary of publisher text (CLAUDE.md legal rules). */
function assertShortText(fields) {
  for (const field of ['excerpt', 'summary']) {
    const value = fields[field];
    if (value !== undefined && (typeof value !== 'string' || value.length > NEWS_LIMITS.excerpt[1])) {
      fail(`"${field}" must be text of at most ${NEWS_LIMITS.excerpt[1]} characters.`);
    }
  }
}

function assertCreate(doc) {
  if (!doc || typeof doc !== 'object') fail('createIfNotExists needs a document.');
  if (!isReviewId(doc._id)) fail(`"${doc._id}" is not a queue id (queue.a_<16 hex>).`);
  if (doc._type !== NEWS_DOC_TYPE) fail(`type must be ${NEWS_DOC_TYPE}.`);
  if (doc.status !== 'pending_review') fail(`a new story must be pending_review, not "${doc.status}".`);
  for (const key of Object.keys(doc)) if (!CREATE_FIELDS.has(key)) fail(`the importer may not write "${key}".`);
  assertShortText(doc);
}

function assertPatch(patch) {
  const id = String(patch?.id || '');
  if (!isReviewId(id) && !isReviewId(id.replace(/^drafts\./, ''))) fail(`cannot patch "${id}".`);
  const ops = Object.keys(patch).filter((key) => key !== 'id');
  if (!ops.length) fail('empty patch.');
  for (const op of ops) {
    if (!PATCH_OPS.has(op)) fail(`patch operation "${op}" is not allowed.`);
    const fields = patch[op];
    if (!fields || typeof fields !== 'object' || !Object.keys(fields).length) fail(`"${op}" needs fields.`);
    for (const path of Object.keys(fields)) {
      const field = path.split(/[.[]/)[0];
      if (!PATCH_FIELDS.has(field)) fail(`the importer may not change "${field}" on an existing story.`);
    }
    assertShortText(fields);
  }
}

/** Throws ImporterMutationError unless the mutation is one the importer is allowed to make. */
export function assertImporterMutation(mutation) {
  const kinds = mutation && typeof mutation === 'object' ? Object.keys(mutation) : [];
  if (kinds.length !== 1) fail('one operation per mutation.');
  const [kind] = kinds;
  const body = mutation[kind];
  if (kind === 'createIfNotExists') return assertCreate(body);
  if (kind === 'patch') return assertPatch(body);
  if (kind === 'delete') {
    if (body?.query !== PRUNE_QUERY || !body.params?.pendingBefore || !body.params?.rejectedBefore) {
      fail('deletes are only allowed through the prune query.');
    }
    return undefined;
  }
  if (kind === 'createOrReplace') {
    if (body?._id !== STATE_DOC_ID || body?._type !== STATE_DOC_TYPE) fail('only the aggregator state document can be replaced.');
    for (const key of Object.keys(body)) if (!STATE_FIELDS.has(key)) fail(`aggregator state may not hold "${key}".`);
    return undefined;
  }
  return fail(`"${kind}" is not allowed.`);
}

const checked = (mutation) => {
  assertImporterMutation(mutation);
  return mutation;
};

export const createMutation = (doc) => checked({ createIfNotExists: doc });

/**
 * Patches for ingest-owned fields. When an editor has a draft open, the draft gets the same
 * patch: publishing a draft replaces the whole document, so a patch on the published copy
 * alone would be undone (docs/NEWS-REVIEW-GUIDE.md, Part 5).
 */
export function ingestPatchMutations(id, { set, setIfMissing } = {}, { hasDraft = false } = {}) {
  const ops = {};
  if (set && Object.keys(set).length) ops.set = set;
  if (setIfMissing && Object.keys(setIfMissing).length) ops.setIfMissing = setIfMissing;
  if (!Object.keys(ops).length) return [];
  const ids = hasDraft ? [id, draftIdFor(id)] : [id];
  return ids.map((target) => checked({ patch: { id: target, ...ops } }));
}

export const pruneMutation = (opts) => checked({ delete: { query: PRUNE_QUERY, params: pruneParams(opts) } });

export const stateMutation = (state) => checked({ createOrReplace: { _id: STATE_DOC_ID, _type: STATE_DOC_TYPE, ...state } });
