# funds.ae: Sanity CMS developer guide

This guide explains how the Sanity CMS is built into funds.ae, how to set it up once, and how to develop it further: adding fields, adding content types and moving it to the Phase 3 worker.

- **Editors:** skip to [Part 9: Editor quick guide](#9-editor-quick-guide).
- **Developers:** read Parts 1-3 first. They explain why the design looks the way it does.

## Contents

1. [What lives in Sanity, and what does not](#1-what-lives-in-sanity-and-what-does-not)
2. [How it fits together](#2-how-it-fits-together)
3. [Where the code is](#3-where-the-code-is)
4. [One-time setup](#4-one-time-setup)
5. [Day-to-day development](#5-day-to-day-development)
6. [Adding a field or a new content type](#6-adding-a-field-or-a-new-content-type)
7. [Rules that keep it safe](#7-rules-that-keep-it-safe)
8. [Troubleshooting](#8-troubleshooting)
9. [Editor quick guide](#9-editor-quick-guide)
10. [Where this goes next](#10-where-this-goes-next)

---

## 1. What lives in Sanity, and what does not

Sanity holds **content people write by hand**. Ingested news and jobs never go into Sanity. They keep the pipeline, the review queue and the Publish workflow in build guide Parts B3 and F5. Those depend on licence checks, the copy check, the state machine and the audit log, and a CMS would bypass all of them.

| In Sanity (Studio menu) | Shown on the site | Sanity type | Published as |
|---|---|---|---|
| **Sponsors**, grouped by area | Elite Founding Sponsor banner, Elite Partners, Gold Sponsors, Sponsored Posts, Videos and Podcasts, Featured Companies, Career Resources | `sponsorItem` | `config/sponsors.json` → `api/v1/sponsors.json` |
| **Events** | Home "Events and Expos", Events page | `event` | `config/events.json` → `api/v1/events.json` |
| **Top Tweets (home)** | Home "Top Tweets" box (5 shown) | `socialHighlight` | `config/content.json` → `api/v1/content.json` `slots.socialHighlights` |
| **Advertise packages** | Advertise page cards (Partner, Gold, Elite) and the Elite Exclusive hero | `advertiseTier` | … `slots.advertiseTiers` |
| **Pages** | About, Privacy Policy, Terms of Service body copy | `page` | … `pages.{about,privacy,terms}` |

| Not in Sanity | Why |
|---|---|
| News stories | Ingested automatically, legally constrained (excerpts ≤ 280 characters, attribution, licence status), published through the Phase 6 review queue |
| Jobs and employers | Ingested from job boards and `config/jobs.manual.json` |
| Sources, taxonomy | Configuration with validation and licence fields (build guide Part C). Owned by admins, not editors |
| Thought Leaders box, navigation, page layout | Not in this first pass. Add them with the checklist in Part 6 when needed |

## 2. How it fits together

```
 Editor in Sanity Studio (https://<host>.sanity.studio)
   │  presses Publish (drafts stay private in Sanity)
   ▼
 Sanity webhook ──POST──► GitHub API: repository_dispatch { event_type: "cms-publish" }
   ▼
 GitHub Action "Publish content" (.github/workflows/publish-content.yml)
   1. npm run cms:pull
        GET https://<project>.api.sanity.io/v2025-02-19/data/query/<dataset>?perspective=published
        (one GROQ query, src/cms/queries.js, read-only Viewer token)
        → src/cms/mapping.js turns Sanity documents into the config file shapes
        → validated with the SAME rules as hand-edited files
            sponsors: src/pipeline/sponsors.js   events: src/pipeline/events.js
            content:  src/pipeline/content.js
        → all valid: write backend/config/{sponsors,events,content}.json
          anything invalid: write NOTHING, fail the run with plain-language reasons
   2. npm run publish:content  → api/v1/{sponsors,events,content,meta}.json
   3. commit + push → GitHub Pages
   ▼
 Website: js/fundsae-connector.js reads api/v1 and fills data-fundsae-slot elements (textContent only)
```

Why it pulls into config files instead of having the browser read Sanity:

- **The website contract does not change.** Pages still read `api/v1/*.json`. Sanity is never contacted from a visitor's browser, so it needs no CORS for the site and no Sanity code in `js/`.
- **One set of rules.** Content from Sanity passes the same validators as content typed into the JSON files. Invalid content cannot go live, and the previous good version stays published.
- **Git is the audit trail.** Every publish is a commit showing exactly what changed and when.
- **It survives Sanity outages.** The site serves static JSON. If Sanity is down, publishing pauses and nothing breaks.
- **It moves cleanly to Phase 3.** The same `pullFromSanity()` becomes a pg-boss job (Part 10).

The cost is that changes take about 1-2 minutes to appear, the time the Action takes.

## 3. Where the code is

```
studio/                              Sanity Studio (its own package; Node >= 22.12; sanity v6)
  sanity.config.js                   Studio config: desk structure, templates, Vision (dev only)
  sanity.cli.js                      CLI config: project/dataset from env, studioHost, Vite PostCSS pin
  structure.js                       Left-hand menu: Sponsors by area, Events, Top Tweets, packages, Pages
  schemaTypes/
    rules.js                         ALL limits (slots, lengths, max items). Plain data, no imports
    validators.js                    Shared Studio validation (https, hex, images, max per group)
    sponsorItem.js, event.js, socialHighlight.js, advertiseTier.js, page.js
  .env.example                       SANITY_STUDIO_PROJECT_ID, SANITY_STUDIO_DATASET, SANITY_STUDIO_HOST

backend/
  src/cms/sanity.js                  Env config + read-only GROQ client (uses lib/http.js fetchText)
  src/cms/queries.js                 The one GROQ query (published, enabled documents only)
  src/cms/mapping.js                 Sanity docs → config shapes; Portable Text → safe blocks
  src/cms/pull.js                    Fetch, map, validate everything, write all three files or none
  src/pipeline/content.js            Validates config/content.json (Top Tweets, packages, pages)
  src/pipeline/publish.js            publishContent() → api/v1/content.json
  src/contracts/models.js            CONTENT_SLOTS, PAGE_SLUGS, records, DB_MODELS, DTO_FIELDS
  src/contracts/serializers.js       toSocialHighlightDto, toAdvertiseTierDto, toPageDto
  schema/schema.sql                  social_highlights, advertise_tiers, pages tables (for Phase 2)
  config/content.json                Content written by cms:pull (or by hand while source is "file")
  config/settings.json               content.source: "file" | "sanity"
  scripts/cms-seed.mjs               Today's content → studio/seed/fundsae-seed.ndjson for import
  test/cms.test.js                   Mapping, sanitising, pull against a mock Sanity, rule parity

js/fundsae-api.js                    valid.socialHighlight / advertiseTier / page, setCopyLink
js/fundsae-connector.js              renderHighlights, renderTiers, renderPage (createElement + textContent)
frontend_demo/                       Slots: this.html (social-highlights), Advertise (advertise-tiers,
                                     advertise-exclusive), About/Privacy/Terms (page-body on <main>)
.github/workflows/publish-content.yml  repository_dispatch "cms-publish" → cms:pull → publish → commit
.github/workflows/ci.yml             "studio" job: schema validate + build
```

## 4. One-time setup

These are **human tasks**: they need your accounts. Do them in order. Commands run in PowerShell or Git Bash. `npx sanity …` commands run from `studio/`.

### 4.1 Create the Sanity project

1. Sign up at <https://www.sanity.io> with a **Google or GitHub account that has two-factor authentication on**. Sanity uses that login, so 2FA on that account protects the Studio.
2. Go to <https://www.sanity.io/manage>, create a project called "funds.ae", and note its **Project ID** (8 characters, e.g. `ab12cd34`).
3. Create the datasets and make both **private**. Private means drafts and hidden sponsors can only be read with a token.

   ```bash
   cd studio
   npm install
   npx sanity login
   npx sanity datasets create development --visibility private
   npx sanity datasets visibility set production private   # if production already exists
   npx sanity datasets create production --visibility private  # if it does not
   ```

4. Copy `studio/.env.example` to `studio/.env` and fill in `SANITY_STUDIO_PROJECT_ID`. Use `SANITY_STUDIO_DATASET=development` while you try things.

### 4.2 Run the Studio and load today's content

```bash
cd backend
npm run cms:seed          # writes studio/seed/fundsae-seed.ndjson (git-ignored)
cd ../studio
npx sanity datasets import seed/fundsae-seed.ndjson development --replace
npm run dev               # http://localhost:3333
```

- The seed contains the current sponsors (including images from `assets/sponsors/`), events, the four Advertise packages and the About/Privacy/Terms copy.
- Relative page links such as `Contact.dc.html` become `https://funds.ae/frontend_demo/Contact.dc.html`. Pass `npm run cms:seed -- --site-url https://<your-site>/frontend_demo/` if the site lives elsewhere.
- The dummy Top Tweets are **not** seeded. They have no real post links, so add real ones in the Studio.
- Much of today's content is placeholder ("demo", "dummy"). Import into `production` only once you have replaced it with real content, or start production empty and enter the real content by hand.

If the dev server says the origin is not allowed, run `npx sanity cors add http://localhost:3333 --credentials`.

### 4.3 Deploy the Studio

```bash
cd studio
npm run deploy            # → https://fundsae.sanity.studio (SANITY_STUDIO_HOST in .env)
```

- Set `SANITY_STUDIO_DATASET=production` in `studio/.env` before deploying the editors' Studio.
- Sanity adds the hosted Studio's origin to CORS automatically.
- Redeploy after every schema change (Part 6).

### 4.4 Give GitHub read access to Sanity

1. Create a read-only token, either at sanity.io/manage → API → Tokens → **Add API token**, permission **Viewer**, or with the CLI:

   ```bash
   npx sanity tokens create "GitHub Actions (read)" --role viewer
   ```

2. Go to GitHub → repository → Settings → Secrets and variables → Actions → **New repository secret**, and add:

   | Secret | Value |
   |---|---|
   | `SANITY_PROJECT_ID` | your project ID |
   | `SANITY_DATASET` | `production` |
   | `SANITY_READ_TOKEN` | the Viewer token |

Never put the token in a file in the repository, in `studio/.env` or in a webhook. The Studio needs no token.

### 4.5 Connect Publish in Sanity to the GitHub Action

1. Create a **fine-grained personal access token** on GitHub (Settings → Developer settings → Fine-grained tokens):
   - Repository access: **only this repository**.
   - Permissions: **Contents: Read and write**. Nothing else.
   - Expiry: 1 year. Put a reminder in the calendar to rotate it.
2. In sanity.io/manage → API → Webhooks → **Create webhook**:

   | Setting | Value |
   |---|---|
   | Name | Publish to funds.ae |
   | URL | `https://api.github.com/repos/<owner>/<repo>/dispatches` |
   | Dataset | `production` |
   | Trigger on | Create, Update, Delete |
   | Filter | `_type in ["sponsorItem", "event", "socialHighlight", "advertiseTier", "page"]` |
   | Projection | `{"event_type": "cms-publish"}` |
   | HTTP method | POST |
   | HTTP headers | `Authorization: Bearer <the GitHub token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` |
   | API version | `v2025-02-19` |
   | Trigger on drafts / versions | **off** |

3. Test it:
   1. Publish a small change in the **development** Studio. With the webhook on `production`, nothing should happen.
   2. Publish the same change in production.
   3. Check GitHub → Actions → **Publish content**. A run starts within seconds.
   4. If it doesn't, Sanity → Webhooks → your hook → **Attempts log** shows GitHub's answer. `204` means it worked; `401` or `404` means the token or URL is wrong.

### 4.6 Switch the site over to Sanity

Until you do this, nothing changes: `content.source` is `"file"`, so `cms:pull` refuses to run and the JSON files stay the source.

1. Make sure production holds the content you want live (step 4.2), the webhook works (step 4.5) and the GitHub secrets are set (step 4.4).
2. In `backend/config/settings.json`, set `"content": { "source": "sanity" }`. Commit and push to `main`.
3. Go to GitHub → Actions → **Publish content** → **Run workflow**. Check the run is green and the site shows the content.
4. Retire the old sponsor editor (`admin/`). From now on, edits there are overwritten by the next Sanity publish. Remove the page, or add a notice pointing editors to the Studio.

### 4.7 Invite editors

- Go to sanity.io/manage → Members → **Invite**, or run `npx sanity users invite name@funds.ae --role editor`.
- Which roles you can choose depends on your Sanity plan. Give editors the lowest role that lets them publish, and keep Administrator to one or two people.
- **2FA:** ask every editor to sign in with Google or GitHub, with 2FA turned on for that account. This matches CLAUDE.md's rule that 2FA is required for editor and above. On plans with SAML SSO, enforce it there instead.
- Remove people the day they leave.

## 5. Day-to-day development

### Work on the Studio

```bash
cd studio
npm run dev               # hot-reloads schema changes; uses studio/.env (point it at development)
npm run schema:validate   # the same check CI runs
npm run build             # the same build CI runs
```

The Vision tool (GROQ playground) appears in `npm run dev` only. Use it to try queries like the one in `backend/src/cms/queries.js`.

### See Sanity content on a local copy of the site

`cms:pull` and `publish:content` overwrite tracked files. Run them against `development`, look, then throw the changes away.

```bash
# Git Bash
cd backend
export FUNDSAE_CONTENT_SOURCE=sanity SANITY_PROJECT_ID=ab12cd34 SANITY_DATASET=development SANITY_READ_TOKEN=<viewer token>
npm run cms:pull && npm run publish:content && npm run serve      # http://localhost:8080
git checkout -- config ../api                                     # don't commit development content
```

```powershell
# PowerShell
cd backend
$env:FUNDSAE_CONTENT_SOURCE='sanity'; $env:SANITY_PROJECT_ID='ab12cd34'; $env:SANITY_DATASET='development'; $env:SANITY_READ_TOKEN='<viewer token>'
npm run cms:pull; npm run publish:content; npm run serve
git checkout -- config ../api
```

| Variable | Used by | Notes |
|---|---|---|
| `SANITY_PROJECT_ID` | `cms:pull` | Required |
| `SANITY_DATASET` | `cms:pull` | Default `production` |
| `SANITY_API_VERSION` | `cms:pull` | Default `2025-02-19`. Pinned on purpose: change it only after testing |
| `SANITY_READ_TOKEN` | `cms:pull` | Viewer token. Required for private datasets. Sent as a header, never logged |
| `FUNDSAE_CONTENT_SOURCE` | backend | Overrides `settings.json` `content.source` for one run |
| `SANITY_STUDIO_PROJECT_ID`, `SANITY_STUDIO_DATASET`, `SANITY_STUDIO_HOST` | Studio | In `studio/.env`. Not secret: they are built into the Studio bundle |

### Tests

```bash
cd backend && npm test
```

`test/cms.test.js` needs no Sanity account. It runs `pullFromSanity()` against a mock Sanity API on localhost and checks:
- the mapping, and Portable Text sanitising;
- all-or-nothing writes;
- the `Authorization` header, and that the token never appears in logs;
- that the seed file passes validation;
- that `studio/schemaTypes/rules.js` matches the backend rules.

`test/contract.test.js` checks that every slot the connector fills is declared on a page, and that `content.json` has exactly the contract fields.

## 6. Adding a field or a new content type

Content flows through six layers, and each one checks its neighbour. Follow this checklist **in order**, and put it all in one pull request so `npm test` can prove the layers agree.

| # | Layer | File(s) | What to do |
|---|---|---|---|
| 1 | Limits | `studio/schemaTypes/rules.js` **and** the backend twin (`SLOT_RULES` in `pipeline/sponsors.js`, `EVENT_SCHEMA` in `pipeline/events.js`, `CONTENT_LIMITS` in `pipeline/content.js`) | Same numbers in both. `test/cms.test.js` fails if they differ |
| 2 | Studio schema | `studio/schemaTypes/<type>.js`, `index.js`, `structure.js` | `defineField` with validation from `validators.js`. New type: add it to `schemaTypes` and give it a place in the menu |
| 3 | Query | `backend/src/cms/queries.js` | Project **only** the fields you need. Keep the `enabled != false` and published filters |
| 4 | Mapping | `backend/src/cms/mapping.js` | Map Sanity names to config names. Drop empty values with `compact()`. Rich text goes through `portableTextToBlocks()` only |
| 5 | Validation | `backend/src/pipeline/content.js` (or sponsors/events) | Add the field to the schema object (`rules.text`, `httpsUrl`, …). Unknown keys are rejected automatically |
| 6 | Contract | `src/contracts/models.js` (record typedef, `DB_MODELS`, `DTO_FIELDS`), `schema/schema.sql` (column), `src/contracts/serializers.js` (DTO) | CLAUDE.md: "changing a field means updating models, schema, serializers, js/ scripts and tests together" |
| 7 | Website | `js/fundsae-api.js` (`valid.*`), `js/fundsae-connector.js` (renderer), the page (`data-fundsae-slot`) | `textContent` / `createElement` only, never `innerHTML`. Links through `api.setLink` / `api.setCopyLink`, colours through `api.hex`, images through `api.imageUrl` |
| 8 | Tests | `test/cms.test.js`, `test/contract.test.js` | Fixture → mapping → validation → DTO keys. A slot test fails until page and connector agree |
| 9 | Docs | `backend/README.md` (config, endpoints, UI contract table), this guide (Part 1 table) | |
| 10 | Release | `npm test`, `cd studio && npm run build`, merge, then `npm run deploy` the Studio | Deploy the Studio **after** the backend is merged, or editors can publish fields the Action does not know yet. The Action would then fail safely with "Unknown field" |

**Example: add an optional "logo image" to Top Tweets avatars**

1. `rules.js`: nothing to change (no length limit).
2. `socialHighlight.js`: add `defineField({name: 'avatar', type: 'image', options: {accept: 'image/png,image/jpeg,image/webp'}, validation: imageRule})`.
3. `queries.js`: in `highlights`, add `"avatar": avatar.asset->{url, mimeType, size}`.
4. `mapping.js` `toHighlights`: check the type and size as `toSponsorsConfig` does, then set `avatar: img.url`.
5. `content.js` `HIGHLIGHT_SCHEMA`: add `avatar: httpsUrl({ required: false })`.
6. `models.js` and `schema.sql`: add the field and the `avatar` column. `serializers.js`: add `avatar: nullable(item.avatar)`.
7. `fundsae-api.js` `valid.socialHighlight`: add `optStr(h.avatar)`. In `renderHighlights`, use `api.imageUrl(item.avatar)` as a CSS background, the way `logoBox` does.
8. Tests: add `avatar` to the fixture and the expected DTO keys.

**Renaming or removing a field.** Sanity is schemaless, so old documents keep old fields. Either migrate them (`npx sanity migrations create`, then `npx sanity migrations run`), or keep mapping both names in `mapping.js` for one release. Never let an old field reach validation: `validate()` rejects unknown keys on purpose.

## 7. Rules that keep it safe

These follow from CLAUDE.md. Code review should check them on every CMS change.

- **Editorial only.** News and jobs never go into Sanity (Part 1).
- **Published only.**
  - Queries run with `perspective=published` and exclude `drafts.**`.
  - Sponsors, Top Tweets items and packages with `enabled == false` are filtered out in GROQ. Unannounced sponsors never leave Sanity and never reach the git history.
- **Validated twice.**
  - The Studio validates as editors type.
  - The backend validates again with the rules that hand-edited files use. If anything is invalid, nothing is written.
- **Safe rendering.**
  - Page copy is reduced to `p`, `h2`, `h3`, list items, bold, italic and https/mailto links (`portableTextToBlocks` plus `pageBlocks` validation).
  - The website builds it with `createElement` and `textContent`. Markup typed into the CMS is shown as text.
- **Images.**
  - Sponsor images must be PNG, JPG or WebP, up to 500 KB. SVG is refused because it can carry scripts. These are checked in the Studio and again in `mapping.js`.
  - They are hot-linked from `cdn.sanity.io`, which the page CSP (`img-src https:`) already allows. They are sponsor-supplied, not publisher images.
- **Top Tweets.**
  - Editors write their own one-line summary and link to the post. The post's text is not copied.
  - Links must be `https://x.com/<handle>/status/<id>`.
- **Secrets.**
  - The read token is a GitHub secret with the Viewer role. It is sent only as an `Authorization` header and never logged (a test checks this).
  - The GitHub token used by the webhook can only write contents of this one repository.
  - Rotate both yearly, and immediately if someone with access leaves.
- **Accounts.** Invite only, with 2FA through Google or GitHub (Part 4.7).

## 8. Troubleshooting

| Symptom | Where to look | Usual cause and fix |
|---|---|---|
| Published in Sanity, site unchanged after 5 min | Sanity → Webhooks → Attempts log | No attempt: the webhook filter or dataset is wrong. `401`: the GitHub token expired or lacks Contents write. `404`: wrong owner/repo in the URL |
| Action ran, step "Pull published content" skipped | `backend/config/settings.json` | `content.source` is still `"file"` (Part 4.6) |
| Action red: `cms.invalid …` lines | The failed step's log (also shown as annotations on the run page) | An item breaks a rule, e.g. "founding: 2 items are enabled but the page has room for 1". Fix it in the Studio and publish again. The site kept its previous content |
| Action red: "Sanity refused the read token" | GitHub secrets | `SANITY_READ_TOKEN` is wrong or was deleted. Create a new Viewer token |
| Action red: "project or dataset not found" | GitHub secrets | `SANITY_PROJECT_ID` / `SANITY_DATASET` |
| Studio: "Set SANITY_STUDIO_PROJECT_ID" | `studio/.env` | Copy `.env.example` |
| `sanity build` fails with a PostCSS / tailwind error | `studio/sanity.cli.js` | Vite found a `postcss.config.*` in a parent folder (e.g. `Downloads/`). The `vite` override in `sanity.cli.js` prevents this. Keep it |
| A page still shows the built-in copy | `api/v1/content.json` → `pages` | That page has never been published in Sanity, or failed validation. Pages and packages keep the built-in text when nothing is published |
| Top Tweets shows "Nothing to show yet" | `content.json` `slots.socialHighlights` | Live mode with no items published. Add up to 5 in the Studio |
| Arabic switch leaves CMS text in English | | Expected: `i18n.js` translates fixed page text only. See Part 10 |

## 9. Editor quick guide

- **Open the Studio** at `https://fundsae.sanity.studio` and sign in with the account you were invited with.
- **Change something:**
  1. Pick an area on the left: Sponsors → (area), Events, Top Tweets, Advertise packages, or Pages.
  2. Edit, then press **Publish**.
  3. The site updates within about 2 minutes.
  4. Drafts, meaning unpublished changes, are never shown.
- **Take something down without deleting it:** switch off **Show on the site** and publish.
- **Order:** lower **Order** numbers show first.
- **Limits:** the Studio tells you when a field is too long or an area is full. Each area holds only as many items as the page has room for: one founding sponsor, 5 Elite Partners, 5 Top Tweets.
- **Top Tweets:** write one line in your own words about the post, then paste the link to the post. Don't paste the post's text.
- **Links:** they must start with `https://`. On pages, `mailto:` also works.
- **If the site doesn't update:** tell the developer. The GitHub Action log says exactly which item broke which rule, and the site keeps the last good version in the meantime.

## 10. Where this goes next

- **Phase 2 (PostgreSQL).**
  - `schema/schema.sql` already has `sponsor_items`, `events`, `social_highlights`, `advertise_tiers` and `pages`.
  - Add `src/repositories/pg/` methods to save the validated content.
  - Change `pullFromSanity()` to write through the repositories instead of `config/*.json`.
  - The mapping and validation don't change.
- **Phase 3 (worker).**
  - Replace the GitHub `repository_dispatch` hop with a webhook endpoint on the web process, for example `POST /hooks/sanity`.
  - The endpoint verifies Sanity's webhook signature (HMAC secret set in the webhook), then `boss.send('cms.pull', {}, { singletonKey: 'cms', singletonSeconds: 20 })`.
  - The worker runs `pullFromSanity()` and queues `snapshot.build`.
  - The GitHub Action and the GitHub token can then be retired.
- **Phase 7 (snapshot builder).** `content.json` becomes one more file the snapshot builder uploads to R2, uploaded before `meta.json` like the others.
- **Arabic.**
  - Add `ar` variants of text fields, e.g. `title_ar`, or a localised object type.
  - Map them to `{ en, ar }` in `mapping.js`, extend the DTOs, and have the connector pick by `api.lang()`.
  - Re-render on `api.onLanguageChange`.
- **Live preview (optional).** Sanity's Presentation tool can show drafts on a preview build of the site. It needs a draft-aware read path, so keep it off the public site.
