# funds.ae: News Review Queue guide

The news aggregator collects stories automatically and **publishes nothing by itself**. Every ingested story waits
in the **News Review Queue** in the Sanity Studio until an approver publishes it. The queue also holds the news
source registry and the two category systems, **Capital Types** and **Asset Classes**.

- **Editors:** see [Part 7: Editor guide](#7-editor-guide).
- **Developers:** read Parts 1-4 first; Part 6 maps the code.

To switch the site to the queue, follow [Part 8: Going live](#8-going-live-setup-runbook).

## Contents

1. [How it fits together](#1-how-it-fits-together)
2. [Rules that keep the gate shut](#2-rules-that-keep-the-gate-shut)
3. [Statuses and actions](#3-statuses-and-actions)
4. [Approvers](#4-approvers)
5. [Sanity Free plan: what was checked](#5-sanity-free-plan-what-was-checked)
6. [Where the code is](#6-where-the-code-is)
7. [Editor guide](#7-editor-guide)
8. [Going live (setup runbook)](#8-going-live-setup-runbook)
9. [Settings and environment](#9-settings-and-environment)
10. [Optional AI suggestions](#10-optional-ai-suggestions)
11. [Free-plan limitations](#11-free-plan-limitations)
12. [Troubleshooting](#12-troubleshooting)
13. [Build status](#13-build-status)

---

## 1. How it fits together

```
 RSS sources (config/sources.news.json, edited in the Studio and pulled by cms:pull)
   │  GitHub Action "News ingest" daily at 09:00 Sydney time, or "Fetch News Now" in the Studio
   ▼
 runNews: fetch → normalise (excerpt ≤ 280) → quality filters → dedupe → classify
          (topics, Capital Types, Asset Classes, geography, transaction type, confidence)
   │  SANITY_WRITE_TOKEN, whitelisted mutations only
   ▼
 Sanity: newsArticle  _id = queue.<articleId>   status = pending_review
   │  editor edits the headline, summary and categories, then an approver presses
   │  Approve / Approve and publish / Schedule (or anyone presses Reject / Archive)
   ▼
 Sanity webhook → GitHub "Publish content" (also runs daily at 09:00 Sydney for scheduled stories)
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
     - every publish check passes (`publishBlockers`), including the licence gate;
     - a summary that is the publisher's excerpt, or written by AI, still has the source's permission.
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
studio/
  schemaTypes/newsRules.js           statuses, actions, field groups, limits, approver ids (plain data)
  schemaTypes/newsWorkflow.js        planAction(), planSave(), approvalHash(), publishBlockers() (pure)
  schemaTypes/newsArticle.js         the story document (queue.<articleId>)
  schemaTypes/newsSource.js          a news source: feed, licence, permissions (+ components/SourceHealth.jsx)
  schemaTypes/newsTaxonomy.js        capitalType (category bar: showInNav, navLabel), assetClass (homeSection)
  schemaTypes/newsAggregator.js      newsAggregator (Fetch News Now), newsAggregatorState, newsPublishSignal
  actions/newsActions.jsx            workflow actions, "Save changes", Fetch News Now
  structure.js                       News Review Queue and "News sources and categories" menus

backend/
  config/sources.news.json           the source registry (written by cms:pull when news.registry.source is "sanity")
  config/news-taxonomy.json          Capital Types and Asset Classes (same)
  config/taxonomy.json               topic keywords, geographies, transaction types, exclusion terms
  config/settings.json               news.review, news.registry, news.publish, news.ai (Part 9)
  src/lib/taxonomyClassify.js        rule classifier: Capital Types, Asset Classes, geography, deal type, confidence
  src/ai/enrich.js                   optional Claude suggestions (Part 10)
  src/news/rules.js, workflow.js     backend copies of newsRules.js and the hash/blocker parts of newsWorkflow.js
  src/news/reviewDocs.js             builds queue documents from ingested stories
  src/news/importerMutations.js      the importer's mutation whitelist (assertImporterMutation)
  src/news/publicFilter.js           the only rule for what reaches the site (holdReasons, selectPublic)
  src/news/demoDecisions.js          demo-mode editor decisions (throws outside demo mode)
  src/repositories/newsReview.js     file queue (demo, tests) and the factory that picks file or Sanity
  src/repositories/newsReview.sanity.js  Sanity queue and source-health writer
  src/cms/sanity.js                  read and write client (SANITY_READ_TOKEN, SANITY_WRITE_TOKEN)
  src/cms/queries.js, mapping.js     GROQ queries; Sanity documents to backend shapes and back
  src/cms/pull.js                    cms:pull: content, and the registry and categories
  src/pipeline/news.js               ingest into the queue (runNews)
  src/pipeline/publish.js            publishApprovedNews: queue to api/v1/news*.json
  src/pipeline/storyPages.js         frontend_demo/news/<slug>.html from templates/story.html
  scripts/cms-seed.mjs               studio/seed/fundsae-news-seed.ndjson (registry, categories, singletons)
  test/newsPipeline.test.js          ingest, dedupe, approval, scheduling, held stories, safety stop
  test/newsReview.test.js, sanityQueue.test.js, workflow.test.js, registry.test.js, taxonomy.test.js,
  storyPages.test.js, newsFilter.test.js, ai.test.js, cms.test.js (Studio == backend parity)

js/fundsae-news-filter.js            the news page's filter rules (pure; tested under node)
js/fundsae-news.js                   the Real Estate Capital News page
frontend_demo/News.dc.html           that page; frontend_demo/news/*.html are generated story pages

.github/workflows/news-ingest.yml    daily ingest (09:00 Sydney) into the queue, and Fetch News Now (the only write token)
.github/workflows/publish-content.yml  cms:pull, publish:content, news:publish, commit (read token)
```

## 7. Editor guide

Open the Studio (`https://fundsae.sanity.studio`, or the address in `studio/.env`) and sign in with your Google or GitHub account.

### 7.1 Reviewing a story

1. Go to **News Review Queue → Pending review**. The most relevant stories are at the top. **Needs attention** lists the ones the machine could not classify confidently.
2. Open a story. It has four tabs:
   - **Editorial** is what readers see: headline, summary, Capital Types, Asset Classes, geography, transaction type, Featured, image and search-engine text.
   - **Source** shows the publisher's own headline, link and excerpt, and other outlets that reported the same story. Click **Original article** to read it.
   - **Classification** shows what the machine suggested and why (matched keywords, confidence). Suggestions written by AI say so (Part 10).
   - **Workflow** shows the status history and approval. It is read-only.
3. Edit the Editorial tab:
   - **Headline:** 12-160 characters. Rewrite clickbait; keep it factual.
   - **Summary:** 20-280 characters, in our own words, using only facts in the headline and excerpt. Never paste more than a few words from the article. The publisher's excerpt can stand as the summary only while the source allows excerpts.
   - **Capital Types** (who provides the money) and **Asset Classes** (what is bought or built): choose every one that clearly applies, and none if you are unsure. A story with an Asset Class appears on the Real Estate Capital News page.
   - **Image:** leave it empty unless the source allows images, or you upload one and tick **I confirm we have the rights to use this image**.
4. Press **Save changes** (bottom right) to keep your edits. Nothing goes on the site yet.
5. Then choose an action from the same menu:
   - **Approve and publish:** live within a few minutes (approvers only).
   - **Approve:** ready, but not live; publish it later with **Publish now** (approvers only).
   - **Schedule:** pick a date and time; it goes live at the first publishing run after that time: the daily run at 9:00 am Sydney time, or sooner if someone publishes another story first (approvers only).
   - **Reject:** give a reason. It never appears on the site.

If an action refuses, a dialog lists the reasons, for example "the source's licence has not been cleared", "the summary is longer than 280 characters" or "only approvers can do this". Fix what it says and try again.

### 7.2 Changing or removing a live story

- **Change it:** only approvers can save changes to an approved or live story. Their save re-approves the new text. Other editors can write in **Notes for editors** (the Studio keeps it in the draft for an approver to see) or unpublish the story.
- **Take it off the site:** **Unpublish** (any editor). It is gone after the next publish run, usually within two minutes. **Archive** retires it for good.
- Removed stories stay in the site's public git history. For a legal takedown, tell a developer as well.

### 7.3 Sources

**News sources and categories → News sources** lists every feed. On a source you can:

- turn it on or off (**Fetch this source**);
- on the **Licence** tab, set **Licence status** once someone has read the publisher's terms, and fill in **Terms read (link)** and **Terms reviewed on**. Only `public_sector`, `wire`, `terms_reviewed` and `permission_granted` sources can be published. `docs/source-terms-review.md` lists what has been checked;
- allow or refuse the publisher's excerpt, images and AI summaries. These default to off for a reason: change them only when the terms allow it;
- see its health on the **Health** tab: last fetch, errors and whether it has been paused.

Source changes reach the importer after the next **Publish content** run, which your change starts automatically, and take effect at the next daily fetch (or when someone presses Fetch News Now).

### 7.4 Capital Types and Asset Classes

Each category has a name, description, **Keywords for automatic tagging** (each with a weight from 1 to 5) and a **Display order**.

- Capital Types with **Show in the category bar** appear in the bar on every page, labelled with **Category bar label**. At most 12.
- Asset Classes with a **Home page box** feed that box on the home page.
- A category's id is fixed once it is created, because links and published stories use it. To retire a category, remove it from the bar instead of deleting it.

### 7.5 Fetch News Now

**News sources and categories → Fetch News Now**, then the **Fetch News Now** button (bottom right). New stories arrive in Pending review within a few minutes. The button rests for 10 minutes after each press. **Aggregator status** shows the last run, each source's health and how many documents the queue holds.

## 8. Going live (setup runbook)

Do these in order. Until step 7, the site keeps its demo stories and nothing reads or writes the Sanity queue. Commands run from the folder named in each step.

**Before you start:** finish [SANITY-CMS-GUIDE.md](SANITY-CMS-GUIDE.md) Part 4 (project, Studio, read token, webhook).

1. **Deploy the Studio with the news screens.** In `studio/.env`, set `SANITY_STUDIO_DATASET=production`, then:
   ```bash
   cd studio
   npm run deploy
   ```
2. **Load the sources, categories and the aggregator's documents.** `--missing` only adds documents that do not exist yet, so nothing an editor has written is replaced. Never use `--replace` on production.
   ```bash
   cd backend
   npm run cms:seed
   cd ../studio
   npx sanity datasets import seed/fundsae-news-seed.ndjson production --missing
   ```
3. **Name the approvers.** Run `npx sanity users list` from `studio/`, then add the ids to **both** lists in Part 4. Run `npm test` in `backend/`, commit, push and redeploy the Studio (step 1). Until this is done nobody can publish.
4. **Create the importer's write token.** The importer needs a token that can create documents:
   ```bash
   cd studio
   npx sanity tokens add "GitHub Actions news ingest (write)" --role editor --expires-at 2027-10-26
   ```
   On GitHub, add it as the repository secret **`SANITY_WRITE_TOKEN`**. Only the News ingest workflow uses it. Set a calendar reminder to replace it before it expires (`npx sanity tokens rotate`). If Sanity refuses the `editor` role on your plan, the error lists the roles you can use; pick the lowest one that can write.
5. **Update the webhook.** The Free plan allows two webhooks, so the existing "Publish to funds.ae" hook does both jobs. In sanity.io/manage → API → Webhooks, edit it:

   | Setting | Value |
   |---|---|
   | Filter | `_type in ["sponsorItem", "event", "socialHighlight", "advertiseTier", "page", "newsSource", "capitalType", "assetClass", "newsPublishSignal", "newsAggregator", "employer", "careersPage"]` |
   | Projection | `{"event_type": select(_type == "newsAggregator" => "news-fetch", "cms-publish")}` |

   Leave everything else as it is (Create, Update, Delete; drafts off). Do **not** add `newsArticle`: stories never trigger the site directly. The workflow actions touch `newsPublishSignal` instead, and the projection carries no story content.
6. **Read sources and categories from Sanity.** In `backend/config/settings.json`, set `"news": { "registry": { "source": "sanity" } }`. Commit and push, then run **Actions → Publish content → Run workflow**. The run copies the registry into `config/sources.news.json` and `config/news-taxonomy.json`. It refuses an empty registry.
7. **Switch the queue on.** In `settings.json` set `"news": { "review": { "store": "sanity" } }` and `"mode": "live"`, then commit and push. From then on:
   - **News ingest** fills the queue once a day at 09:00 Sydney time (check **Actions → News ingest → Run workflow** once by hand).
   - **Publish content** publishes what approvers publish.
   - The daily workflow keeps running jobs only.
8. **Clear the demo stories once.** The demo stories are not in the queue, so the safety stop refuses the first live publish. Approve and publish a few real stories first, then run **Actions → Publish content → Run workflow** with **Let the number of live stories fall sharply** ticked. Only this run may drop stories in bulk.
9. **Clear licences as terms are confirmed** (Part 7.3). Today 25 of the 100 sources are cleared (15 public sector, 10 wire); stories from the other 75 can be reviewed but not published.
10. **Optional: AI suggestions** (Part 10).

To undo the switch, set `store` back to `"file"` and `mode` to `"demo"`. The queue stays in Sanity untouched.

## 9. Settings and environment

`backend/config/settings.json`, checked by `npm run validate`:

| Setting | Default | Meaning |
|---|---|---|
| `news.review.store` | `"file"` | `"sanity"` keeps the queue in Sanity. Live mode refuses `"file"`, because GitHub Pages would serve it. |
| `news.review.approverIds` | `[]` | Sanity user ids allowed to approve (Part 4). |
| `news.review.pendingTtlDays` | 30 | Pending stories not seen in a feed for this long are deleted. |
| `news.review.rejectedTtlDays` | 45 | Rejected stories are deleted after this long. Approved, published and archived stories are never deleted. |
| `news.review.lastSeenThrottleHours` | 12 | How often the importer may touch an existing story. |
| `news.review.documentBudget` | 8000 / 9500 | Warn at `warnAt` documents; stop creating stories at `stopCreatesAt` (Free plan limit: 10,000). |
| `news.registry.source` | `"file"` | `"sanity"`: cms:pull copies sources and categories from Sanity. |
| `news.publish.maxArchive` | 2000 | Stories kept in `news/real-estate.json`. |
| `news.publish.maxDropPercent` | 50 | Safety stop (Part 2, rule 7). |
| `news.excerptMaxChars` | 280 | Publisher excerpt limit; cannot exceed 280. |
| `news.ai.*` | off | Part 10. |

GitHub repository secrets:

| Secret | Used by | Role |
|---|---|---|
| `SANITY_PROJECT_ID`, `SANITY_DATASET` | all three workflows | |
| `SANITY_READ_TOKEN` | Publish content, Daily ingest | Viewer |
| `SANITY_WRITE_TOKEN` | News ingest only | Editor |
| `ANTHROPIC_API_KEY` | News ingest only (optional) | |

For a local run, put the same names in your shell or in `backend/.env`, which git ignores. Never commit tokens.

**Document budget:** each story is one document, plus one while an editor has a draft open. `npm run news:prune` (also run by every ingest) deletes old pending and rejected stories. If **Aggregator status** shows the count near `warnAt`, reject or archive more aggressively, or lower the TTLs.

## 10. Optional AI suggestions

With AI on, each new story from a source that allows AI summaries gets a suggested summary and suggested categories from Claude. Editors review them like any other suggestion.

- **Which stories:** only new stories from sources with **Allow AI summaries** ticked. That box needs licence status `terms_reviewed` or `permission_granted`, because someone must have read the terms. The most relevant stories go first.
- **Input:** only the publisher's name, the headline and the publisher's excerpt (at most 280 characters). Claude never sees the article.
- **Checks:**
  - a summary over 280 characters, one that repeats 8 or more consecutive words of the headline or excerpt, or one that just repeats the headline is thrown away;
  - categories must be existing ids. Where Claude suggests none, the keyword-based suggestion stays;
  - if Claude fails, declines or runs out of time, the rule-based classification stays. Each request has a 60-second limit and the whole run 5 minutes;
  - logs name the story by id only, never with Claude's answer.
- **Labelling:** the summary is marked **Summary written by: ai**, and the original suggestion stays in the Classification tab. Editing the summary changes the label to editor.
- **Approval:** unchanged. An AI suggestion is never published without an approver. If a source later stops allowing AI summaries, its AI-written summaries are held off the site until an editor rewrites them.
- **Turning it on:**
  1. Create an API key at console.anthropic.com and add it as the GitHub secret `ANTHROPIC_API_KEY`.
  2. Set `news.ai.enabled` to `true`.
  3. Tick **Allow AI summaries** on each source whose terms allow it (licence status `terms_reviewed` or `permission_granted`).
- **Cost:** at most `news.ai.maxPerRun` stories per run (default 40), so about 40 a day plus any Fetch News Now runs. `news.ai.model` defaults to `claude-opus-5-5`, and `news.ai.effort` to `low`.

## 11. Free-plan limitations

- **Approval control:** every Studio member is an Administrator. The approver list and content hash stop the importer and accidental edits from publishing, but a determined administrator could fake an approval through the API. Detecting that needs Sanity's History API (paid plans).
- **Images:** images uploaded in the Studio can be fetched by anyone who has the URL, before approval.
- **Timing:** scheduled stories go live at the next daily publishing run (9:00 am Sydney time) after their time, or sooner if another story is published in between.
- **History:** removed stories stay in the public git history.
- **Document cap:** the queue must be pruned to stay under 10,000 documents (Part 9).

## 12. Troubleshooting

| Symptom | Where to look |
|---|---|
| An approved story is not on the site | Actions → Publish content → the run's log. Held stories appear as `news.story.held` with their id and the reason (not approved by a listed approver, changed since approval, licence not cleared, scheduled). |
| Publish content fails with "refused" | The safety stop. Check the dataset and token secrets. For a deliberate clean-up, use the tick box in Part 8, step 8. |
| Fetch News Now does nothing | sanity.io/manage → Webhooks → Attempts log. `204` is fine; then check Actions → News ingest. |
| No new stories for hours | Aggregator status: are sources paused, or is the document budget reached? Actions → News ingest for errors. |
| Approve buttons are greyed out | Your id is not in `NEWS_APPROVER_IDS` (Part 4), or the Studio has not been redeployed since. |

## 13. Build status

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
- [x] Phase 10: workflows (scheduled ingest, publish, Fetch News Now)
- [x] Phase 11: Real Estate Capital News page and category bar
- [x] Phase 12: optional Claude summaries
- [x] Phase 13: setup runbook and editor guide
