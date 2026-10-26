# funds.ae: News Review Queue guide

The news aggregator collects stories automatically and **publishes nothing by itself**. Every ingested story waits
in the **News Review Queue** in the Sanity Studio until an approver publishes it. The queue also holds the news
source registry and the two category systems, **Capital Types** and **Asset Classes**.

- **Editors:** see [Part 7: Editor guide](#7-editor-guide).
- **Developers:** read Parts 1-4 first.

This guide grows with the build. [Part 8](#8-build-status) lists which parts are finished.

## Contents

1. [How it fits together](#1-how-it-fits-together)
2. [Rules that keep the gate shut](#2-rules-that-keep-the-gate-shut)
3. [Statuses and actions](#3-statuses-and-actions)
4. [Approvers](#4-approvers)
5. [Sanity Free plan: what was checked](#5-sanity-free-plan-what-was-checked)
6. [Where the code is](#6-where-the-code-is)
7. [Editor guide](#7-editor-guide)
8. [Build status](#8-build-status)

---

## 1. How it fits together

```
 RSS sources (config/sources.news.json, edited in the Studio and pulled by cms:pull)
   │  hourly GitHub Action "News ingest", or "Fetch News Now" in the Studio
   ▼
 runNews: fetch → normalise (excerpt ≤ 280) → quality filters → dedupe → classify
          (topics, Capital Types, Asset Classes, geography, transaction type, confidence)
   │  SANITY_WRITE_TOKEN, whitelisted mutations only
   ▼
 Sanity: newsArticle  _id = queue.<articleId>   status = pending_review
   │  editor edits the headline, summary and categories, then an approver presses
   │  Approve / Approve and publish / Schedule (or anyone presses Reject / Archive)
   ▼
 Sanity webhook → GitHub "Publish content" (also runs hourly for scheduled stories)
   cms:pull → publish:content → news:publish (read-only token)
   │  keeps only stories that are published, due, approved by a listed approver,
   │  unchanged since approval and from a source with a cleared licence
   ▼
 api/v1/news*.json + frontend_demo/news/<slug>.html → commit → GitHub Pages
```

In demo mode and in tests, the queue is a file (`news.review.store: "file"`) and nothing touches Sanity.

## 2. Rules that keep the gate shut

1. **The importer cannot publish.**
   - It only sends `createIfNotExists` (status always `pending_review`, no approval fields) and patches to the ingest-owned fields (`NEWS_INGEST_PATCH_FIELDS`: `lastSeenAt`, `excerpt`, `sourceImageUrl`, `otherSources`).
   - Any other mutation throws before it is sent, and a test checks every request the importer makes.
2. **Nothing automated changes a status.** Only the Studio's workflow actions do. A scheduled story is already `published`, with a future `publishedAt`, and becomes visible when that time passes.
3. **The publisher only reads.**
   - It uses the read-only token and makes no mutations.
   - A story is public only if all of these hold:
     - status `published` and `publishedAt` ≤ now;
     - an approval whose `approvedById` is in `settings.json news.review.approverIds`;
     - the approval's `contentHash` matches the story as it is now;
     - every publish check passes (`publishBlockers`), including the licence gate.
4. **Approval is bound to content.**
   - The approval stores a hash of the approved fields (`NEWS_APPROVAL_HASH_FIELDS`).
   - If anyone other than an approver changes a live story, the hash no longer matches and the story comes off the site until an approver approves it again.
   - When an approver saves changes, the approval is re-stamped.
5. **Licence gate.** Stories publish only from sources whose `licenseStatus` is `public_sector`, `wire`, `terms_reviewed` or `permission_granted`. The Studio refuses the approval and the publisher refuses the story.
6. **Re-imports never overwrite editors.**
   - Editorial fields (headline, summary, categories and so on) are pre-filled once, when the story is created.
   - After that the importer only touches the ingest-owned fields.
   - If an editor has an open draft, the importer patches the draft too, so publishing the draft can't undo the importer's change.
7. **Safety stop.** `news:publish` refuses to write if the number of live stories would fall by more than `news.publish.maxDropPercent`, for example because of a wrong dataset or a revoked token.
8. **No pending content in public places.**
   - Live mode refuses a file-based queue, because GitHub Pages serves `backend/data`.
   - Run logs name stories by id, never by headline.

## 3. Statuses and actions

| Status | Meaning | On the site? |
|---|---|---|
| Pending review | Imported, waiting for an editor | No |
| Approved | Approved by an approver, not live yet | No |
| Published | Live, or scheduled when `publishedAt` is in the future | Yes, once `publishedAt` has passed |
| Rejected | Not suitable; a reason is recorded | No |
| Archived | Taken off the site for good (provenance kept) | No |

| Action | From | To | Who |
|---|---|---|---|
| Approve | Pending review, Rejected | Approved | Approvers |
| Approve and publish | Pending review, Rejected | Published (now) | Approvers |
| Publish now | Approved | Published (now) | Approvers |
| Schedule | Pending review, Approved | Published (at a future time) | Approvers |
| Reject (reason required) | Pending review, Approved | Rejected | Any editor |
| Unpublish | Published | Approved | Any editor |
| Archive | Any status except Archived | Archived | Any editor |
| Return to review | Approved, Rejected, Archived | Pending review (approval cleared) | Any editor |

Taking a story off the site is open to every editor. Putting one on it is not.

## 4. Approvers

On the Sanity Free plan every member is an Administrator, so a list of user ids decides who can approve. The same list must be in two places:

1. `studio/schemaTypes/newsRules.js`: `NEWS_APPROVER_IDS`. This shows or hides the buttons in the Studio. Redeploy the Studio after changing it (`cd studio && npm run deploy`).
2. `backend/config/settings.json`: `news.review.approverIds`. This is what the publisher enforces.

`npm test` fails if the two lists differ. If both are empty, nobody can publish.

To find someone's id, run `npx sanity users list` from `studio/`. The ids look like `pAbC123xyz`.

## 5. Sanity Free plan: what was checked

These were checked on 2026-10-26 against the `development` dataset, with throwaway documents that were deleted afterwards.

| Question | Result |
|---|---|
| Can anonymous readers see `queue.*` documents? | **No.** `/data/query`, the API CDN and `perspective=published` all return nothing without a token. |
| Do token reads see them? | Yes, with `raw`, `published` and `drafts` perspectives. `queue.x` counts as a published document, and its draft is `drafts.queue.x`. `path("queue.*")` matches `queue.x` but not `drafts.queue.x`. |
| Does the Studio treat them as normal documents? | **Yes**, checked in the browser on 2026-10-26 with two test stories in `development` (since deleted). The queue lists show `queue.*` stories, they open and edit like any document, and every workflow action works (Approve and publish, Reject with a reason, Unpublish, Save changes on a live story). The approval fingerprint computed in the browser matched the backend's exactly. The licence gate refused a story from a `pending_review` source, and the Studio showed the reason. |
| Does publishing a draft undo importer changes? | **Yes.** Publishing replaces the whole document. The importer therefore patches an existing draft as well, in the same transaction. Patching a draft that doesn't exist fails with 404, so the importer looks up which drafts exist first. |
| Does Studio publishing guard against concurrent changes? | **Yes.** It sends `ifPublishedRevisionId`. If the importer patches a story seconds before an editor publishes, the editor sees an error and presses Publish again. The importer touches existing stories rarely (`lastSeenAt` at most every `lastSeenThrottleHours`). |
| Can a webhook projection pick the event type? | Yes. `select(_type == "newsAggregator" => "news-fetch", "cms-publish")` works. |
| Plan limits | 10,000 documents, 2 webhooks, Administrator and Viewer roles only, no History API, 250k API requests a month. Not verified: whether drafts and image assets count toward the 10,000 (treat them as counting). |

## 6. Where the code is

```
studio/schemaTypes/newsRules.js      statuses, actions, field groups, limits, approver ids (plain data)
studio/schemaTypes/newsWorkflow.js   planAction(), planSave(), approvalHash(), publishBlockers() (pure)
backend/src/news/rules.js            backend copy of newsRules.js (test/cms.test.js keeps them equal)
backend/src/news/workflow.js         backend copy of approvalHash() and publishBlockers()
backend/config/settings.json         news.review, news.registry, news.publish
backend/test/workflow.test.js        the workflow actions
backend/test/cms.test.js             Studio == backend parity
```

## 7. Editor guide

Written when the Studio screens ship (Part 8).

## 8. Build status

- [x] Phase 0: Free-plan spike (Part 5)
- [x] Phase 1: shared rules, workflow logic, settings, documentation
- [x] Phase 2: Capital Types, Asset Classes and the rule classifier
- [x] Phase 3: review repository and safety rails
- [x] Phase 4: pipeline writes to the queue; only approved stories are published
- [x] Phase 5: API contract and news files
- [x] Phase 6: story pages
- [x] Phase 7: Sanity read/write client and the Sanity queue
- [x] Phase 8: Studio schemas, queue views and workflow actions
- [x] Phase 9: registry and taxonomy pulled from Sanity
- [ ] Phase 10: workflows (hourly ingest, publish, Fetch News Now)
- [ ] Phase 11: Real Estate Capital News page and category bar
- [ ] Phase 12: optional Claude summaries
- [ ] Phase 13: setup runbook and editor guide
