# Funds.ae backend: news, jobs, events, sponsors and forms

This folder contains everything behind the Funds.ae website pages in `frontend_demo/`:

- **Ingestion:** collects headlines from RSS feeds, sorts them into **UAE** and **Rest of the World**, tags each with a private-markets topic, removes duplicates and groups coverage of one event into one story. It also collects open roles from employer job boards.
- **Publishing:** writes everything as a small, read-only JSON API in `api/v1/`, together with editor-maintained events and sponsor placements.
- **Optional server:** serves the pages, the same API with filters and paging, and the five website forms.

Setup for non-developers is in [`../SETUP-GUIDE.md`](../SETUP-GUIDE.md). This file is the technical reference.

---

## 1. Architecture

```
            config/*.json  ──►  src/cli.js  (daily GitHub Action, or the server's scheduler)
   RSS / job boards ──fetch──►  pipeline/news.js, jobs.js, events.js, sponsors.js
                                     │  repositories/ (JSON files in data/, schema.sql for PostgreSQL)
                                     ▼
                               pipeline/publish.js ──► api/v1/*.json   (contracts/serializers.js)
                                                            │
      GitHub Pages (static) ◄───────────────────────────────┤
      src/server/ (optional) ◄──────────────────────────────┘  + filters, paging, forms, admin
                                                            │
       frontend_demo/*.html + js/fundsae-api.js, fundsae-connector.js, fundsae-forms.js
```

| Need | Choice | Why |
|---|---|---|
| Runtime | Node.js 20+ (tested on 22 and 24), plain JavaScript modules | Same language as the website; one dependency (`fast-xml-parser`) |
| Scheduler | GitHub Actions `cron` (daily 03:00 UTC = 07:00 UAE) or `ENABLE_SCHEDULER=true` | Nothing to host; logs, retries and failure emails built in |
| Database | JSON files in `data/`, behind `src/repositories/` | Works with no server and is auditable in git. `schema/schema.sql` mirrors the same models for PostgreSQL |
| Public API | Static JSON in `api/v1/` | Read-only, cacheable, nothing to attack; identical from GitHub Pages or the server |
| Server | `src/server/` (Node's built-in `http`, no framework) | Filters, paging, forms, admin listing and the website itself from one process |
| Contract | `src/contracts/` | One place defines every stored record and every API field; tests fail on drift |

Folder map:

```
src/contracts/     models.js (records + DTO field lists), serializers.js (record -> API), envelope.js
src/validation/    validate.js (rules), submissions.js (the five form schemas)
src/repositories/  index.js (JSON tables), submissions.js (form store)
src/pipeline/      news, jobs, events, employers, sponsors, content, publish
src/cms/           Sanity: sanity.js (query client), queries.js (GROQ), mapping.js (docs -> config shapes), pull.js
src/server/        index.js, routes.js, http.js, rateLimit.js, static.js, scheduler.js, handlers/{read,submissions,admin}.js
src/lib/           feed parsing, HTTP client, text, URL, classification, grouping, quality rules, logging
src/cli.js         command line;  src/server.js  server entry point
```

## 2. How a daily run works

```
sources.news.json ──► fetch (retries, ETag, size cap) ──► parse RSS/Atom/RDF
      ▼
normalise (plain text, excerpt ≤ 280 chars, feed image only, date)
      ▼
quality filter (opinion, advertorial, podcasts/video, press releases*, stale)
      ▼
deduplicate (canonical URL → article id; source GUID; same headline from same source within 7 days)
      ▼
classify (UAE vs Rest of the World; topic; relevance score) ──► drop if not about private markets/investment
      ▼
broken-link check on new items (live mode; drops 404/410 only)
      ▼
group into stories (same event across sources within 72 hours) ──► prune (> retentionDays) ──► save data/
      ▼
jobs (boards + manual) ──► events (config) ──► sponsors (config) ──► publish api/v1 + meta.json versions
```
\* press releases are kept by default; set `excludePressReleases: true` to drop them.

Each source is fetched independently: one broken feed never stops the others. A source that fails 5 runs in a row, or returns "not found", is paused for 7 days (circuit breaker) and shown as such in `api/v1/sources.json`. Invalid events or sponsor files fail only their own step; the previous published file stays live.

### Deduplication, grouping and classification
- **Canonical URL:** lower-cased host, `www.`/`m.`/`amp.` removed, `https`, fragment and tracking parameters (`utm_*`, `fbclid`, `gclid`…) removed, remaining parameters sorted, trailing slash and `/amp` removed. The article id is `a_` + SHA-256 of that URL. The same `<guid>` from one source, or the same normalised headline from one source within 7 days, is also the same article.
- **Grouping** (`src/lib/grouping.js`): two articles within 72 hours are one story when their headlines share at least half their meaningful words, or at least two distinctive entities (a company name plus the same money amount, `$45 million` = `$45m`). Place names do not count. The lead link is the most authoritative source (lowest `priority`), then the earliest.
- **UAE vs Rest of the World** (`src/lib/classify.js`, rules in `config/taxonomy.json`): UAE terms score 3 in the headline or 1 in the summary; UAE-based outlets add 1; 2 or more makes it UAE.
- **Topic:** keyword weights per topic; headline hits count double; up to 3 topics are kept. **Sections** group topics for one area of the page (the tile grids) and can be limited to a category.
- **Relevance:** topic score plus general investment terms minus off-topic terms. General business outlets need ≥ 3; specialist outlets ≥ 1.

## 3. Configuration (`backend/config/`)

| File | What it controls |
|---|---|
| `settings.json` | `mode` (`demo`/`live`), timeouts, retries, thresholds, retention, grouping, publishing limits, `events`, `employers`, `submissions` |
| `sources.news.json` | News feeds: `sources` (the 100 sources verified on 2026-09-30, build guide Part C3) for live, `demoSources` for demo |
| `sources.jobs.json` | Job sources: `rss`, `greenhouse`, `lever`, `ashby` |
| `jobs.manual.json` | Roles you post yourself (featured roles are listed first; `demoOnly` examples never go live) |
| `events.json` | Events for "Events and Expos" (`events` for live, `demoFixture` for demo) |
| `taxonomy.json` | Categories, UAE terms, topics and keywords, **sections**, filters, job rules |
| `sponsors.json` | Sponsor slots (edited with `admin/`, or written from Sanity by `npm run cms:pull`) |
| `content.json` | Editorial content from the Sanity Studio: `socialHighlights` (home "Top Tweets"), `advertiseTiers` (Advertise packages), `pages` (About, Privacy, Terms copy) |

`settings.json` `content.source` says where `sponsors.json`, `events.json` and `content.json` come from: `"file"` (default; edit them by hand) or `"sanity"` (the Studio in `studio/` is the source and `npm run cms:pull` overwrites them). See [`../docs/SANITY-CMS-GUIDE.md`](../docs/SANITY-CMS-GUIDE.md).

Keys starting with `_` are notes for people and are ignored. `npm run validate` checks every file and explains mistakes in plain language.

**News source fields.** Beyond `id`, `name`, `homepage`, `type` (`rss`, or `api` which must stay disabled until it has an adapter), `url`, `enabled`, `region`, `focus` and `priority`, every live source states its licensing:

| Field | Values | Default (demo only) |
|---|---|---|
| `tier` | `L1` official, `L2` press-release wire, `L3` publisher RSS, `L4` licensed API, `L5` paid syndication | `L3` |
| `licenseStatus` | `public_sector`, `wire`, `terms_reviewed`, `permission_granted`, `pending_review`, `blocked` | `pending_review` |
| `termsUrl`, `termsReviewedAt` | https link and `YYYY-MM-DD`. Required for `terms_reviewed` (`permission_granted` needs the date) | none |
| `allowExcerpt` | `false` shows headline + link only | `true` |
| `allowImages` | `true` shows images from the publisher's own feed (hot-linked). **Opt-in** | `false` |
| `language` | two-letter code | `en` |
| `pollEveryHours` | 1–168 | `24` |

`tier` and `licenseStatus` are required in live mode. `blocked` sources must be disabled. Misspelt fields are reported (for example `licenceStatus`).

**Checking feeds.** `npm run check-sources -- --config` fetches every enabled RSS source with the pipeline's own client and parser. It prints status, format, item count and newest item date. It exits 1 if any source fails, is not a feed, is empty, or has no item newer than 14 days. `npm run check-sources -- <url>` checks a single feed before you add it.

Environment variables for the server are documented in [`.env.example`](.env.example).

## 4. Public API contract (v1)

Base URL: `https://<site>/api/v1/`, either GitHub Pages (static files) or the server (same files plus the routes below).

**Conventions**
- Keys are camelCase and dates are ISO-8601 UTC. Event dates are `YYYY-MM-DD` calendar dates in the UAE.
- Every field listed below is always present. **Optional values are `null`, never `""`.**
- Every document starts with the envelope `{ apiVersion: 1, mode: "demo"|"live", generatedAt, notice }`. Lists add `{ count, items }`. Server-paged lists also add `{ total, limit, offset }`.
- Errors are `{ "error": { "status", "code", "message", "fields"? } }`. Codes: `bad_request`, `validation_failed`, `not_found`, `method_not_allowed`, `payload_too_large`, `unsupported_media_type`, `forbidden_origin`, `unauthorized`, `rate_limited`, `submissions_disabled`, `unavailable`, `internal`.

### Read endpoints

| Static file | Server route | Contents |
|---|---|---|
| `meta.json` | `GET /api/v1/meta` | `buildId`, `counts`, `lastRun`, `versions` {news, jobs, employers, events, sponsors, content} (content hashes used for cache-busting), `capabilities.submissions` (`false` in the static file; the server reports the truth), `endpoints` |
| `news.json`, `news/uae.json`, `news/world.json`, `news/topics/{topic}.json`, `news/sections/{section}.json` | `GET /api/v1/news?category=&topic=&section=&q=&limit=&offset=` | Stories, newest first |
| — | `GET /api/v1/news/{id}` | One story (`s_` + hex) |
| `jobs.json` | `GET /api/v1/jobs?q=&employer=&featured=&limit=&offset=` | Open roles, featured first |
| `employers.json` | `GET /api/v1/employers` | Employers derived from open roles (top 15) |
| `events.json` | `GET /api/v1/events?status=upcoming\|past&limit=&offset=` | Upcoming and recent events, soonest first |
| `sponsors.json` | `GET /api/v1/sponsors` | `{ slots: { founding, platinum, gold, sponsoredPosts, sponsoredMedia, professionalServices, careerResources } }` |
| `content.json` | `GET /api/v1/content` | `{ slots: { socialHighlights, advertiseTiers }, pages: { about?, privacy?, terms? } }` (only published pages are present) |
| `sources.json`, `taxonomy.json` | `GET /api/v1/sources`, `/taxonomy` | Source health; categories, topics, sections |

Query parameters are validated against an allow-list (`v` is always allowed for cache-busting). `category`, `topic` and `section` must exist in `taxonomy.json`; `q` ≤ 100 characters; `limit` 1–100 (default 20); `offset` 0–10000. Anything else returns 400.

### Item shapes

```jsonc
// story (news*.json)
{ "id": "s_…", "headline": "…", "summary": "≤ 280 chars" | null, "url": "https://publisher/…",
  "source": "…", "sourceId": "…", "publishedAt": "…", "updatedAt": "…",
  "category": "uae" | "world", "categoryLabel": "UAE", "uiLabel": "UAE News",
  "topic": "private-credit", "topicLabel": "Private credit", "topics": ["…"],
  "imageUrl": "https://…" | null, "sourceCount": 3,
  "sources": [{ "articleId": "a_…", "source": "…", "sourceId": "…", "title": "…", "url": "…", "publishedAt": "…" }] }

// job (jobs.json)
{ "id": "j_…", "title": "…", "company": "…", "employerId": "emp_…", "location": "…" | null, "url": "https://…",
  "postedAt": "…", "department": "…" | null,
  "employmentType": "Full-time" | "Part-time" | "Contract" | "Internship" | "Temporary" | null,
  "featured": true, "source": "…", "sourceId": "…" }

// employer (employers.json)
{ "id": "emp_…", "name": "…", "initials": "GH", "openJobs": 3, "featured": false }

// event (events.json)
{ "id": "…", "title": "…", "eventType": "Roundtable", "startDate": "2026-10-12", "endDate": "2026-10-13" | null,
  "city": "Dubai", "venue": "…" | null, "url": "https://…" | null, "organiser": "…" | null, "featured": false }

// sponsor item (every slot in sponsors.json)
{ "id": "…", "title": "…" | null, "blurb": … | null, "label": … | null, "logoText": … | null,
  "website": "www.example.ae" | null, "url": "https://…" | null, "image": "assets/sponsors/x.png" | "https://…" | null,
  "colorFrom": "#RRGGBB" | null, "colorTo": "#RRGGBB" | null, "sponsored": true }

// social highlight (content.json slots.socialHighlights: home "Top Tweets", max 5)
{ "id": "…", "accountName": "…", "handle": "adfinance", "text": "our own one-line summary (≤ 140)",
  "url": "https://x.com/<handle>/status/<n>", "initials": "AF", "color": "#RRGGBB" | null }

// advertise tier (content.json slots.advertiseTiers; id is the enquiry form's tier)
{ "id": "silver" | "gold" | "platinum" | "exclusive", "name": "…", "badge": "…" | null, "price": "AED 9,500",
  "priceNote": "/ month" | null, "features": ["…"], "featured": true }

// page (content.json pages.{about,privacy,terms}): a safe subset of Portable Text
{ "slug": "privacy", "title": "…", "intro": "…" | null, "updatedAt": "2026-10-01" | null,
  "blocks": [ { "type": "p" | "h2" | "h3" | "li", "list": "bullet" | "number" | null,
                "spans": [ { "text": "…", "bold": false, "italic": false, "href": "https://…" | "mailto:…" | null } ] } ] }
```

### Sponsor slots

| Slot | Page area | Max | Fields used | `sponsored` |
|---|---|---|---|---|
| `founding` | "Elite Founding Sponsor" banner under the masthead on every page except Careers. Empty shows the "Your firm here" advert for the slot | 1 | title, blurb, url, image (logo) | yes |
| `platinum` | "Elite Partners" box: Home, top of the middle column | 5 | title, url, image, colorFrom/To | yes |
| `gold` | "Gold Sponsors" box: Home right column | 10 | title, label, url, image, colorFrom/To | yes |
| `sponsoredPosts` | Home "Sponsored Posts" | 20 | title, blurb, logoText, url, image, colorFrom/To | yes |
| `sponsoredMedia` | Home "Videos and Podcasts" | 15 | title, label, blurb, url, image | yes |
| `professionalServices` | Home "Featured Companies" (names only) and the scrolling strip at the bottom of the Careers page (logo or initials, name, website) | 20 | title, website, logoText, url, image, colorFrom/To | yes |
| `careerResources` | Home and Careers "Career Resources" | 12 | title, logoText, url, colorFrom/To | no (editorial) |

Unknown fields and old names (`headline`, `name`, `logo`, `thumbnail`, `logoBackground`, the `banners` group) are rejected with a message saying what they are now called.

### Form endpoints (server only)

`POST /api/v1/submissions/{kind}` with `Content-Type: application/json`, body ≤ 16 KB. Unknown fields are rejected. Every form also sends the hidden honeypot field `website`, which must be empty.

| Kind | Fields (limits) | Stored status |
|---|---|---|
| `contact` | `name` 2–80, `email`, `subject` 2–120, `message` 10–4000 | `new` |
| `newsletter` | `email`, `placement` `home`\|`careers` (one sign-up per address) | `new` |
| `advertise` | `name`, `email`, `company` 2–120, `tier` `silver`\|`gold`\|`platinum`\|`exclusive` (shown as Partner, Gold Partner, Elite Partner, Elite Exclusive Partner), `message` ≤ 2000 (optional) | `new` |
| `event` | `title` 3–90, `eventType` 2–40, `startDate`, `endDate` (optional, ≥ start, ≤ ~2 years ahead), `city` 2–60, `url` (optional, https), `organiser` 2–120, `email` | `pending-review` |
| `job` | `title` 3–160, `company` 2–120, `location` 2–160, `url` (https), `employmentType` (optional, enum), `email` | `pending-review` |

- **202** `{ "ok": true, "status": "received", "mode": "demo"|"live" }`. The same answer is given for a new sign-up, a repeat newsletter sign-up and a honeypot hit, and submitted data is never echoed.
- **400** `validation_failed` with `fields: { name: "message" }`. **403** foreign origin. **413** too large. **415** not JSON. **429** rate limited (`Retry-After`). **503** forms turned off.

`GET /api/v1/admin/submissions?kind=contact&limit=50` requires `Authorization: Bearer $ADMIN_API_TOKEN` (≥ 32 characters; unset means the route does not exist). Responses are `no-store, private` and never shared cross-origin.

## 5. Website contract (the pages and `js/`)

Pages load `js/fundsae-api.js` (API base, fetch with timeout, validation, safe DOM helpers), then `js/fundsae-connector.js` (data) and `js/fundsae-forms.js` (forms). `this.html` injects them at the end of its layout script; the other pages include them with `<script defer>`. The API base is `../api/v1/` relative to the scripts, or `window.FUNDSAE_CONFIG.apiBase`.

The connector fills elements marked `data-fundsae-slot`. For each slot it clones one of the slot's own placeholder rows, so the page's styling is kept, and fills it with `textContent`.

| Slot | Where | Data |
|---|---|---|
| `news` | Home news column: tabs "News" (UAE and global stories together) and "Fundraising" (stories tagged `fundraising`: fund launches and closes), "View All", search box `#home-search` | `news.json` |
| `tiles-real-estate-infrastructure`, `tiles-energy`, `tiles-ai-technology`, `tiles-grants-funding` | Home tile grids | `news/sections/*.json` |
| `top-jobs` | Careers page column 2, "Top Jobs" (20 roles) (featured first, then newest; links to the employer posting) | `jobs.json` |
| `home-jobs` | Home "UAE Careers" (links to `Careers.dc.html#<jobId>`) | `jobs.json` |
| `roles`, `employers` | Careers page: roles in column 1 (pager, `?employer=` filter, `#jobId` deep link); "Top Employers" in column 2 (top 20 with initials logos, each linking to the `?employer=` filter) | `jobs.json`, `employers.json` |
| `events` | Home "Events and Expos" box (next 10) and the Events page `Events.dc.html` (up to `data-fundsae-limit`, with event names); upcoming only | `events.json` |
| `sponsor-platinum`, `sponsor-gold`, `sponsor-posts`, `sponsor-media`, `sponsor-companies`, `career-resources` | Sponsor areas on both pages | `sponsors.json` slots |
| `sponsor-founding` | Banner under the masthead on every page except Careers (styles in `frontend_demo/founding-banner.css`). With no `founding` sponsor it keeps its "Your firm here" advert in every mode (never "Nothing to show yet") | `sponsors.json` `founding` |
| `social-highlights` | Home "Top Tweets" (first 5): avatar initials, name, @handle, our one-line summary, link to the post | `content.json` `slots.socialHighlights` |
| `advertise-tiers`, `advertise-exclusive` | Advertise page package cards (`silver`, `gold`, `platinum`) and the Elite Exclusive Partner hero (`exclusive`). "Get started" keeps `data-fundsae-tier`, so the enquiry form preselects the package. With no packages published the built-in cards stay | `content.json` `slots.advertiseTiers` |
| `page-body` (`data-fundsae-page="about\|privacy\|terms"` on `<main>`) | Title, lead, "Last updated" and the body `<section>`s (sections marked `data-fundsae-keep`, such as About's team grid, stay). With no page published the built-in copy stays, in every mode | `content.json` `pages` |
| `data-fundsae-date`, `data-fundsae-badge` | Masthead date, "Demo data" badge | `meta.json` |

`data-fundsae-hide-placeholders` marks lists rendered by the home page's own component: placeholders there are hidden rather than removed. Forms are `<form data-fundsae-form="contact|newsletter|advertise|event|job">`, and their `name` attributes are exactly the API field names.

Demo data never passes as real. In **live** mode every slot's placeholders are replaced, and an empty slot shows "Nothing to show yet". In **demo** mode a "Demo data" badge is shown. If the API is unreachable, the page keeps its built-in content. Forms check `meta.capabilities.submissions` first; when it is false (GitHub Pages) they say so and send nothing.

`test/contract.test.js` fails if the connector uses a slot no page declares (or the reverse), or if a form sends a field name the API would reject.

## 6. Data storage

`backend/data/` (live) and `backend/data/demo/` (demo, rebuilt on every full run):

| File (repository table) | Contents | SQL table |
|---|---|---|
| `news-db.json` (`news`) | `articles[]`, `stories[]` | `articles`, `stories` |
| `jobs-db.json` (`jobs`) | `jobs[]` with `open` / `closed` / `expired` status | `jobs` |
| `feed-state.json` (`feedState`) | Per-source health, ETags, circuit breaker | `sources` |
| `run-history.json` (`runs`) | Last 30 runs with counts, warnings and errors | `ingestion_runs` |
| `submissions/<kind>.jsonl` | Form submissions (git-ignored) | `submissions` |
| `config/events.json`, `config/sponsors.json` | Editor-maintained | `events`, `sponsor_items` |

Record shapes are defined once in `src/contracts/models.js`. `schema/schema.sql` uses the same names in snake_case (`articleId` → `article_id`), and `test/contract.test.js` fails if any model field lacks a column or the JSON store holds a field the schema does not know.

**Moving to PostgreSQL:** implement the methods in `src/repositories/index.js` (`load`/`save` per table, `record` for runs) and `src/repositories/submissions.js` (`add`, `list`, `prune`) against the tables in `schema.sql`, using parameterised queries only. Nothing else changes. Do this before running more than one server instance: the JSON files and the in-memory rate limiter assume one process.

## 7. Security

**Inputs**
- Every form field and query parameter is validated against an allow-list (type, length, pattern, enum, real calendar dates, email syntax, https-only public URLs). Unknown fields are rejected.
- Text is Unicode-normalised, and control, zero-width and bidi-override characters are removed.
- Values are stored as plain text and escaped at output. The website inserts data with `textContent` only.

**Forms**
- Bodies must be JSON and at most 16 KB.
- Browser requests must come from this server's origin or one listed in `ALLOWED_ORIGINS`. `*` never applies to writes.
- Each IP is limited to 5 forms a minute and 30 an hour (a bounded token bucket), and failed admin logins count against the same limit.
- The honeypot is silently dropped.
- Responses are identical for new and repeat newsletter addresses, so subscribers cannot be probed.

**Personal data**
- Client IPs are stored only as an HMAC (`SUBMISSIONS_HASH_SALT`), and user agents are cut to 200 characters.
- Names, emails and messages are never logged; only the kind and id are.
- Submission files are created owner-only and git-ignored, and the daily workflow refuses to commit them.
- `npm run submissions:prune` deletes records older than `retentionDays`. Demo mode stores at most 500 per kind.

**Server**
- Every API response carries `nosniff`, `X-Frame-Options: DENY`, `default-src 'none'` CSP, `Referrer-Policy` and `Permissions-Policy`. HSTS is available with `HSTS=true`.
- Request, header and keep-alive timeouts are set.
- Errors never include stack traces.
- With `TRUST_PROXY=true`, the client IP is the right-most `X-Forwarded-For` hop (the one your proxy added).
- The admin route uses a constant-time token comparison.

**Website hosting**
- Only `frontend_demo/`, `js/`, `assets/` and `/i18n.js` are served. Each path segment is decoded separately; `..`, dotfiles, backslashes, colons, NUL and unlisted extensions return 404.
- `backend/`, `admin/` and `.github/` are never served.
- HTML pages get a CSP. It must allow `'unsafe-inline'`, `'unsafe-eval'` and `blob:` because `this.html` is a design-tool bundle that unpacks itself. `STATIC_CSP` overrides it.

**Outbound**
- Only configured URLs are fetched. Private, loopback and cloud-metadata addresses are refused, responses over 5 MB are rejected, and XML `DOCTYPE`s are stripped.

**Content**
- Sponsor links must be `https://`. Images must be PNG, JPG or WebP in `assets/sponsors/` or on https; SVG is refused. Colours must be hex. Invalid files are not published.

**Admin page**
- It talks only to `api.github.com` with a fine-grained token held in memory (or this tab's session storage if you tick Remember), under a strict CSP.

**Workflows**
- They request only the permissions they use, install with `--ignore-scripts`, and publish sponsors and events only from `main`.

## 8. Operations

- **Commands:**
  - `npm run ingest` (everything), `ingest:news`, `ingest:jobs`, `publish:sponsors`, `publish:events`, `publish:content`
  - `validate`, `check-sources -- --config`, `reset-feed -- <id>`, `submissions:prune`
  - `serve`
- **Logs:** GitHub → Actions → the run. Warnings and errors also appear as annotations.
- **Failure alerts:** if every source fails or the code crashes, the workflow fails and GitHub emails the owner. The site keeps its previous data.
- **Source health:** `api/v1/sources.json`. A paused source resumes after 7 days, or run `npm run reset-feed -- <id>`.
- **Tests:** `npm test` runs 67 tests:
  - source configuration rules, the live source list, and the check-sources script
  - parsing (including real-world date formats), dedupe, grouping, classification and filters
  - HTTP retries, timeouts and limits
  - the full demo pipeline
  - validation rules
  - the API, database and website contract
  - the server's read, form, admin and static routes, including traversal, origin, size, type and rate-limit cases

## 9. Legal and editorial

- Only headlines, publisher-supplied excerpts (≤ 280 characters) and publisher-supplied feed images are used; full articles are never copied. Every item links to the original publisher, and grouped stories keep every source's link.
- Images are hot-linked from the publisher's own feed, never copied, and only for sources with `allowImages: true` (set once the publisher's terms allow it).
- The fetcher identifies itself as `Mozilla/5.0 (compatible; FundsAeNewsBot/1.0; +https://funds.ae/about)`, the standard crawler format. A source that still answers 403 has blocked the bot: disable it and ask the publisher; never disguise the bot.
- Set `contactEmail` in `config/settings.json` (or the `FUNDSAE_CONTACT_EMAIL` environment variable) to a role mailbox such as `news@funds.ae`. It is added to the user-agent (`…; +https://funds.ae/about; news@funds.ae)`). The SEC requires a contact in the user-agent, and live runs warn while SEC sources are enabled without one.
- Before going live, review each publisher's terms for commercial reuse of its RSS feed and remove any source whose terms you cannot meet. The research so far is in [`docs/source-terms-review.md`](../docs/source-terms-review.md).
- Sponsored links carry `rel="sponsored"`; editorial career resources do not.
- All demo names (sponsors, employers, events, stories) are fictional and marked "(demo)" or "Demo …". Replace them before launch.
- The Privacy Policy should describe what the forms collect and the retention period before the forms are switched on.
