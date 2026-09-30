# funds.ae: build guide from prototype to production

**Version 1.0, 30 September 2026.** Written for the `funds.ae` repository as it stands today.

This is a working manual. Follow it top to bottom. Every phase ends with commands you run and checks that must pass before you move on. Where it says **Prompt**, paste the text into Claude Code as-is.

> **Not legal advice.** Part H summarises the laws and licensing questions that apply to a UAE news aggregator. Before launch, have a UAE-qualified media and IP lawyer review your source list, terms of use and privacy policy.

---

## Contents

- [How to use this guide](#how-to-use-this-guide)
- [Part A: What funds.ae is](#part-a-what-fundsae-is)
- [Part B: System design](#part-b-system-design)
- [Part C: Source strategy (100 verified sources)](#part-c-source-strategy)
- [Part D: Data pipeline design](#part-d-data-pipeline-design)
- [Part E: Building it with Claude Code](#part-e-building-it-with-claude-code)
- [Part F: Backend implementation](#part-f-backend-implementation)
- [Part G: Automation, monitoring and error handling](#part-g-automation-monitoring-and-error-handling)
- [Part H: Legal and compliance](#part-h-legal-and-compliance)
- [Part I: Deployment to production](#part-i-deployment-to-production)
- [Part J: Execution plan, phase by phase](#part-j-execution-plan-phase-by-phase)
- [Appendices](#appendices)

---

## How to use this guide

1. Read Parts A and B once. They explain *what* you are building and *why* it is shaped this way.
2. Part C is your source list, and Parts D, F, G and H are the specifications. You will point Claude Code at them.
3. **Part J is the build order.** Work through it one phase at a time. Each phase lists:
   - the goal
   - the Claude Code prompt
   - the files it touches
   - the checks that prove it is done
4. Don't skip the "Done when" checks. They are how you, as a beginner, know the work is correct without reading every line of code.

**Conventions**
- `code` is a command, file or identifier.
- **GST** is Gulf Standard Time (UTC+4), the time zone every schedule in this guide uses.
- "The repo" is the `funds.ae` folder containing `backend/`, `frontend_demo/`, `js/`, `api/` and `admin/`.

---

## Part A: What funds.ae is

### A1. In one sentence

funds.ae is a curated news and intelligence site for people who work in or around **private capital**: private equity, venture capital, private credit, hedge funds, and the sovereign and institutional investors behind them. It has a **UAE-first lens**: it covers the UAE and the wider Gulf, and places them against global capital markets.

### A2. The problem it solves

- **The signal is scattered.** A UAE fund manager, LP, founder or job-seeker who wants "what happened in private capital today, with the UAE angle" has to check three kinds of source:
  - regional business outlets such as The National, Arabian Business, AGBI and Gulf News;
  - global specialist trade press such as PE Hub, PEI and Hedgeweek;
  - press-release wires and regulators, where fund closes and filings appear first.
- **No single place filters it.** Nothing takes all of that, filters out the noise (sport, gadgets, opinion, advertorials), groups duplicate coverage of the same deal, and presents it cleanly every morning.
- **Around the news sits an ecosystem with no hub:** jobs in UAE finance, industry events, service providers and sponsors. funds.ae already has the beginnings of all of these (careers, events, sponsor areas).

### A3. What the system does, at product level

| For | funds.ae gives them |
|---|---|
| Readers (GPs, LPs, founders, advisers, job-seekers) | A fast, trustworthy daily digest: UAE and Global news, topic pages (private credit, VC, real estate and more), jobs and events. Every item links to the original publisher |
| Editors (you and your team) | An admin workspace where ingested stories wait in a **review queue**. Editors check the AI-suggested summary and topic, then press **Publish** (or reject). Published stories appear on the home and topic pages within about a minute |
| Sponsors and advertisers | Clearly labelled placements (Platinum, Gold, Sponsored Posts, Videos, Featured Companies) managed by your team |
| Publishers you aggregate | Attribution and traffic: headlines and short excerpts only, always linking back. Nothing that substitutes for their article |

### A4. What it becomes long-term

Build towards these stages, but only build Stage 1 and Stage 2 now.

| Stage | What funds.ae is | Key capability |
|---|---|---|
| 1. Aggregator (this guide) | Daily curated feed of UAE and global private-capital news, with manual publishing | Reliable ingestion, dedupe, review queue, publish, legal compliance |
| 2. Curated newsroom | Adds editor-written briefs, a morning newsletter and topic pages. The audience grows | Editorial tools, newsletter delivery, analytics |
| 3. Intelligence platform | Structured data extracted from the news (fund closes, deal sizes, investors, regulators' actions), then searchable databases: "every UAE fund close this year" | Entity extraction, a deals/funds database, search, alerts |
| 4. Marketplace | Jobs, events and service-provider directories become products with paid listings, sponsorship packages and premium data | Payments, self-serve listings, subscriber accounts |

The architecture below is chosen so Stage 3 needs no rebuild. The database stores structured fields (entities, amounts, deal types) from day one, even before the site displays them.

### A5. Where the repo is today

You are not starting from zero. This table is the gap analysis every later part refers back to.

| Capability | In the repo today | What this guide adds |
|---|---|---|
| RSS and job-board ingestion, cleaning, dedupe, UAE/World classification, story grouping | `backend/src/pipeline/*`, `backend/src/lib/*` (tested) | Keep. Swap storage to PostgreSQL. Add AI enrichment and ranking |
| Storage | JSON files in `backend/data/`, behind `backend/src/repositories/`. `backend/schema/schema.sql` matches the models | PostgreSQL implementation of the same repositories, plus editorial tables |
| Publishing | Everything that passes filters is published automatically to `api/v1/*.json` | **Manual review queue and a Publish button.** Only approved stories reach the site |
| Public API | Static JSON in `api/v1/` plus an optional Node server (`backend/src/server/`) | Same contract, built from published stories in the database, served through a CDN |
| Admin | `admin/` edits sponsors through the GitHub API. The server has a token-protected submissions listing | Full editor app: logins, roles, two-factor authentication, queue, story editor, sources, runs, audit log |
| Scheduling | GitHub Actions cron once a day | A job queue with cron inside the worker (pg-boss), plus retries and alerts |
| Frontend | `frontend_demo/*.html` with `js/fundsae-*.js` filling data slots | Unchanged contract, plus topic (category) pages |
| Forms | Contact, newsletter, advertise, event and job submissions, validated and rate-limited | Keep. Add Cloudflare Turnstile and email notifications |

> **Fix this first (it affects Claude Code).** `C:\Users\ishan\Downloads\CLAUDE.md` is a playbook for a different project (a UNSW student society site). Claude Code loads `CLAUDE.md` files from **parent folders** too, so every session in `funds.ae` sees those unrelated instructions. Its "Power Delivery Network" wording has already leaked into `Advertise.dc.html` once. Rename that file or move `funds.ae` out of `Downloads` before you start (Phase 0).

---

## Part B: System design

### B1. Architecture at a glance

```
                  SOURCES (Part C)
   RSS/Atom feeds | press-release wires | regulator feeds
   public APIs (SEC EDGAR, World Bank, Guardian) | job boards
                        |
                        |  scheduled fetch (06:00 GST daily + optional hourly light run)
                        v
+------------------------------------------------------------------+
| WORKER process (Node.js)                        runs pg-boss jobs |
|  1 fetch -> 2 parse/normalise -> 3 quality filter -> 4 dedupe    |
|  -> 5 rule classifier -> 6 story grouping -> 7 AI enrichment     |
|  (Claude, batch) -> 8 ranking -> 9 review queue / auto-reject    |
|  + snapshot builder (on publish) + housekeeping (retention)      |
+-------------------------+----------------------------------------+
                          | SQL (repositories)
                          v
+------------------------------------------------------------------+
| PostgreSQL: sources, articles, stories, placements, users,       |
| sessions, audit_log, runs, jobs, events, sponsors, submissions   |
+-------------+-------------------------------------+--------------+
              ^                                     |
              | admin actions (publish, edit...)    | published stories
+-------------+--------------+          +-----------v--------------+
| WEB process (Fastify)      |          | Snapshot builder         |
|  /admin   editors (login,  |--job---->| writes api/v1/*.json     |
|           2FA, roles)      |          | (same contract as today) |
|  /api/v1  public read API  |          +-----------+--------------+
|  /api/v1/submissions forms |                      | upload + purge
+-------------+--------------+                      v
              |                          +--------------------------+
              |                          | Object storage + CDN     |
              |                          | (Cloudflare R2 + cache)  |
              |                          +-----------+--------------+
              |                                      |
              v                                      v
+------------------------------------------------------------------+
| funds.ae website: frontend_demo/*.html + js/fundsae-api.js,      |
| fundsae-connector.js, fundsae-forms.js  (reads api/v1/*.json)    |
+------------------------------------------------------------------+
```

**Two processes, one database.** The **web** process answers people: editors and site visitors. The **worker** process does slow, scheduled work: fetching, AI calls, building snapshots.

Splitting them means:
- a slow feed or AI batch can never make the admin panel or the public API slow;
- you can scale either side on its own.

Both share the same code base and the same PostgreSQL database. Jobs are passed between them through a queue stored in that database (pg-boss), so no extra Redis server is needed.

### B2. Layers and responsibilities

| Layer | Responsibility | Where it lives (target) | Built from |
|---|---|---|---|
| **Source registry** | Which feeds exist, how to fetch them, licence status, priority tier | `sources` table, seeded from `backend/config/sources.*.json` | Part C |
| **Ingestion** | Fetch each feed politely and parse RSS, Atom, RDF or JSON | `backend/src/adapters/`, `lib/http.js`, `lib/feedParser.js` | exists |
| **Processing** | Normalise, quality filter, dedupe, classify, group into stories, AI enrichment, ranking | `backend/src/pipeline/`, `lib/*`, new `backend/src/ai/` | exists + Part D |
| **Storage** | Durable records and editorial state | PostgreSQL, accessed only through `backend/src/repositories/` | Part F3 |
| **Review and publishing** | Queue, story editor, Publish/Unpublish, placements, audit | New `backend/src/admin/` (Fastify routes + server-rendered pages) | Part F4-F6 |
| **Delivery** | Public JSON API, snapshot files, CDN | `backend/src/server/`, new `backend/src/publisher/` | exists + Part F5 |
| **Website** | Pages that render the API | `frontend_demo/`, `js/` | exists; add topic pages |
| **Operations** | Scheduling, retries, logs, metrics, alerts | pg-boss, pino, Sentry, uptime monitor | Part G |

### B3. Lifecycle of a story

Every item moves through explicit states. Nothing reaches the public site unless a person has published it.

```
 feed item
    |
    v
 [article stored] --quality/relevance fail--> discarded (counted in run stats)
    |
    v
 grouped into a story
    |
    v
 candidate --score >= review threshold--> in_review --editor: Publish----> published
    |                                         |  \--editor: Schedule--> scheduled --time--> published
    |                                         \----editor: Reject------> rejected
    \--score < threshold or stale (> 7 days)--> expired (never shown)

 published --editor: Unpublish (reason required)--> unpublished --Publish again--> published
 published --age > 90 days (configurable)--------> archived (kept on topic pages, off home)
```

- **candidate:** stored, grouped and enriched, but not yet worth an editor's time.
- **in_review:** sits in the queue, ordered by rank score.
- **published:** included in the next snapshot. The home page shows the top N by placement and score.
- **Every transition is logged** in `audit_log`: who, when, from which state to which, and why.

### B4. Technology choices

These choices favour **one language (JavaScript), few moving parts, and managed services**. That is what a beginner working with Claude Code can operate safely.

| Concern | Choice | Why this and not something else |
|---|---|---|
| Runtime | **Node.js 24 LTS** | The existing pipeline, tests and website scripts are JavaScript. One language keeps Claude Code's context small |
| Web framework | **Fastify 5** plus `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cookie`, `@fastify/formbody`, `@fastify/view`, `@fastify/csrf-protection` | Fast, schema-validated routes, a mature security plugin ecosystem, and simpler than Express for secure defaults. Django's admin is excellent but would mean rewriting a tested pipeline in Python |
| Admin UI | **Server-rendered HTML (Eta templates) + htmx** | No separate front-end build, no API tokens in the browser, CSRF handled by forms. The Publish button is one htmx `POST` |
| Database | **PostgreSQL 17** (managed) with `pg` and `node-pg-migrate` | The repo already has `schema.sql`. `jsonb`, full-text search and `pgvector` cover Stage 3 |
| Jobs and scheduling | **pg-boss** (queue in PostgreSQL, cron schedules with a time zone, retries, backoff, dead-letter) | No Redis to run. Jobs are transactional with your data |
| AI | **Anthropic Claude API** (`@anthropic-ai/sdk`), Message Batches for the daily run, structured JSON output validated with `zod` | Topic tagging, relevance scoring and one-sentence summaries at scale, at about half the per-token price through Batches |
| Semantic dedupe (Stage 2+) | Open-source embeddings in Node (`@huggingface/transformers` with `Xenova/all-MiniLM-L6-v2`) stored with **pgvector** | Runs locally at no per-call cost. Catches rewrites that keyword grouping misses |
| Logging | **pino** (JSON logs) | Fast and structured. Redaction built in |
| Errors and uptime | **Sentry** (errors) plus **Better Stack** or UptimeRobot (uptime checks, log search) | Free tiers cover launch |
| Hosting | **Render** (web + worker + managed PostgreSQL). Alternatives: Railway, or Fly.io + Neon. For UAE data residency: AWS me-central-1 or Azure UAE North | Push-to-deploy, managed backups, HTTPS by default |
| CDN, DNS, WAF, bot checks | **Cloudflare** (DNS, CDN, WAF, R2 object storage, Turnstile) | Has points of presence in the UAE. R2 serves the snapshot JSON; Turnstile stops form spam |
| Website hosting | **Cloudflare Pages** (or keep GitHub Pages) for `frontend_demo/` + `js/` | Static, global and free. Reads `https://api.funds.ae/api/v1/` or the R2 snapshot |
| Source control and CI | **GitHub** + **GitHub Actions** | Tests on every pull request, protected `main`, deploy on merge |


---

## Part C: Source strategy

### C1. Legal access tiers (read this before adding any source)

**A feed being technically available does not mean you may republish from it commercially.** Each source sits in one of five tiers, and the tier decides what funds.ae may show.

| Tier | What it is | What funds.ae may show | Examples |
|---|---|---|---|
| **L1: Official and public-sector** | Regulators, central banks and statistical agencies publishing for public use | Headline, short excerpt, link. Check each body's reuse terms (for example, UK bodies use the Open Government Licence) | SEC, EDGAR, Federal Reserve, ECB, DFSA, World Bank |
| **L2: Press-release wires** | Releases issued by companies specifically for redistribution | Headline, short excerpt, link. Wires' feed terms generally allow this with attribution | PR Newswire, Business Wire, GlobeNewswire, AETOSWire |
| **L3: Publisher RSS** | Feeds a publisher offers for reading in feed readers | Headline, publisher-supplied excerpt (≤ 280 characters), link, attribution. **Some publishers limit feeds to personal or non-commercial use: read the terms, and ask for permission where they say so** | The National, FT, Bloomberg, PE Hub |
| **L4: Licensed developer APIs** | APIs with written terms and keys | Whatever the API terms allow. Often non-commercial on the free tier | Guardian Open Platform, FRED |
| **L5: Paid syndication** | Contracted news licences | Whatever the contract says, often full text | Reuters Connect, Dow Jones/Factiva, AP, LSEG (Zawya) |

What this means in practice:
- **Launch with L1, L2 and L3.** For L3, start with sources whose terms you have read and recorded. Every other L3 source is marked `license_status = 'pending_review'` and can't be published until you review it (Part F6 enforces this).
- **Record the decision.** Each source row stores `terms_url`, `license_status`, `terms_reviewed_at` and `reviewed_by`. If a publisher ever asks, you can show when and how you checked.
- **Never bypass blocking.** A source that answers automated requests with HTTP 403 has blocked you. Do not spoof a browser user-agent or rotate IPs to get round it. Email the publisher and ask for feed access or a syndication agreement.

### C2. Selection criteria

A source earns a place when it scores well on all six:

1. **Relevance:** covers private capital, fundraising, deals, institutional investors, or UAE/GCC business.
2. **Authority:** original reporting, a regulator, or the primary announcement itself (a wire).
3. **Freshness:** publishes at least weekly. Feeds whose newest item is months old are excluded.
4. **Machine access:** a working RSS/Atom/RDF feed or a documented API. No scraping.
5. **Licence clarity:** a tier in C1 that you can document.
6. **Good behaviour:** supports conditional requests (ETag / Last-Modified) and does not block automated access.

### C3. The 100 verified sources

**How these were verified.**
- Every feed and endpoint below was requested once, live, on **30 September 2026**.
- A source counts as verified only if it returned HTTP 200 with a valid RSS, Atom or RDF feed containing at least one item, or valid JSON for APIs.
- The "Newest item" column shows how current the feed was. Two developer APIs (G) answered with a JSON "key required" message, which confirms the endpoint is live; you need a free key.
- Feeds change. Re-verify quarterly with the script in Appendix 3, and check source health daily in the admin **Sources** page.

**Why each category is included**
- **A. Private-markets specialists.** The core of funds.ae. Trade press that reports fundraises, fund closes, LP commitments, buyouts, secondaries and hedge fund launches before the general press does.
- **B. Venture capital, start-ups and fintech.** UAE capital increasingly flows into venture and fintech. These sources carry funding rounds, especially in India, Africa, Europe and Singapore (the markets UAE investors are most active in), and fintech, which is the largest start-up sector in the UAE.
- **C. UAE and GCC.** The "UAE-first" promise. National and regional business outlets report sovereign funds (Mubadala, ADIA, ADQ, PIF, QIA), free-zone activity (DIFC, ADGM), real estate and local deals.
- **D. Global financial news.** Context: markets, rates, M&A and global LPs. These are mostly headlines-only (several are paywalled), which suits an aggregator that links out.
- **E. Regulators, central banks and official data.** Primary, authoritative and generally free to reference. SEC **Form D** filings are the single best early signal of new private fund raises.
- **F. Press-release wires.** Fund closes, launches and hires are announced here first, by the companies themselves, for redistribution.
- **G. Developer APIs.** Licensed, structured access for search and macro data.

### A. Private-markets specialists

| # | Source | Access | Feed / endpoint | Newest item on 30 Sep 2026 | Focus |
|---|---|---|---|---|---|
| 1 | PE Hub | RSS | `https://www.pehub.com/feed/` | 2026-09-30 | PE deals, fund closes, people moves |
| 2 | AltAssets | RSS | `https://www.altassets.net/feed` | 2026-09-29 | Global PE/VC fund and LP news |
| 3 | Private Equity Wire | RSS | `https://www.privateequitywire.co.uk/feed/` | 2026-09-29 | Fund launches, GP and service-provider news |
| 4 | Private Equity International | RSS | `https://www.privateequityinternational.com/feed/` | 2026-09-29 | Fundraising and LP allocations (headlines; articles paywalled) |
| 5 | Private Funds CFO | RSS | `https://www.privatefundscfo.com/feed/` | 2026-09-29 | Fund finance, operations, compliance |
| 6 | New Private Markets | RSS | `https://www.newprivatemarkets.com/feed/` | 2026-09-29 | Impact and ESG private markets |
| 7 | Buyouts | RSS | `https://www.buyoutsinsider.com/feed/` | 2026-09-29 | Buyout deals and fundraising |
| 8 | Venture Capital Journal | RSS | `https://www.venturecapitaljournal.com/feed/` | 2026-09-28 | VC fundraising and LP commitments |
| 9 | Hedgeweek | RSS | `https://www.hedgeweek.com/feed/` | 2026-09-29 | Hedge fund launches, performance, service providers |
| 10 | Opalesque | RSS | `https://www.opalesque.com/rss.xml` | 2026-09-29 | Hedge funds and alternatives briefings |
| 11 | Top1000funds | RSS | `https://www.top1000funds.com/feed/` | 2026-09-30 | Sovereign wealth and pension (asset-owner) strategy |
| 12 | Private Banker International | RSS | `https://www.privatebankerinternational.com/feed/` | 2026-09-29 | Private banking and wealth management |

### B. Venture capital, start-ups and fintech

| # | Source | Access | Feed / endpoint | Newest item on 30 Sep 2026 | Focus |
|---|---|---|---|---|---|
| 13 | Crunchbase News | RSS | `https://news.crunchbase.com/feed/` | 2026-09-29 | Funding rounds with data-driven analysis |
| 14 | Crunchbase News (Venture) | RSS | `https://news.crunchbase.com/sections/venture/feed/` | 2026-09-29 | Venture section of the above |
| 15 | TechCrunch Venture | RSS | `https://techcrunch.com/category/venture/feed/` | 2026-09-29 | VC firms, funds and rounds |
| 16 | TechCrunch Fundraising | RSS | `https://techcrunch.com/tag/fundraising/feed/` | 2026-07-02 | Fundraising-tagged stories (lower volume) |
| 17 | Sifted | RSS | `https://sifted.eu/feed` | 2026-09-30 | European start-ups and VC |
| 18 | EU-Startups | RSS | `https://www.eu-startups.com/feed/` | 2026-09-30 | European funding rounds |
| 19 | Tech.eu | RSS | `https://tech.eu/feed/` | 2026-09-30 | European tech funding and exits |
| 20 | Axios | RSS | `https://api.axios.com/feed/` | 2026-09-29 | Business and deals (includes Pro Rata coverage) |
| 21 | Inc42 | RSS | `https://inc42.com/feed/` | 2026-09-30 | India start-up funding (India-UAE corridor) |
| 22 | YourStory | RSS | `https://yourstory.com/feed` | 2026-09-29 | India start-ups and investors |
| 23 | TechCabal | RSS | `https://techcabal.com/feed/` | 2026-09-30 | African tech funding (Gulf investors active there) |
| 24 | AlleyWatch | RSS | `https://www.alleywatch.com/feed/` | 2026-09-29 | Daily US funding-round reports |
| 25 | Crowdfund Insider | RSS | `https://www.crowdfundinsider.com/feed/` | 2026-09-30 | Crowdfunding, alternative finance, fintech regulation |
| 26 | FinTech Global | RSS | `https://fintech.global/feed/` | 2026-09-30 | Fintech funding and deals |
| 27 | Finextra | RSS | `https://www.finextra.com/rss/headlines.aspx` | 2026-09-30 | Banking and fintech |
| 28 | The Fintech Times | RSS | `https://thefintechtimes.com/feed/` | 2026-09-30 | Global fintech including MENA |
| 29 | Fintech News Singapore | RSS | `https://fintechnews.sg/feed/` | 2026-09-30 | APAC fintech hub, a peer market to DIFC/ADGM |

### C. UAE and GCC

| # | Source | Access | Feed / endpoint | Newest item on 30 Sep 2026 | Focus |
|---|---|---|---|---|---|
| 30 | The National (Business) | RSS | `https://www.thenationalnews.com/arc/outboundfeeds/rss/category/business/?outputType=xml` | 2026-09-30 | Abu Dhabi national daily, business section |
| 31 | The National (Markets) | RSS | `https://www.thenationalnews.com/arc/outboundfeeds/rss/category/business/markets/?outputType=xml` | 2026-09-30 | Markets sub-section |
| 32 | Gulf News | RSS | `https://gulfnews.com/feed` | 2026-09-30 | Dubai daily |
| 33 | Arabian Business | RSS | `https://www.arabianbusiness.com/feed` | 2026-09-30 | UAE business: deals, companies, people |
| 34 | AGBI | RSS | `https://www.agbi.com/feed/` | 2026-09-30 | Gulf business journalism |
| 35 | Economy Middle East | RSS | `https://economymiddleeast.com/feed/` | 2026-09-30 | Regional economy and companies |
| 36 | Construction Week Middle East | RSS | `https://www.constructionweekonline.com/feed` | 2026-09-29 | Real estate and infrastructure projects |
| 37 | The National (Property) | RSS | `https://www.thenationalnews.com/arc/outboundfeeds/rss/category/business/property/?outputType=xml` | 2026-09-30 | UAE real estate and property funds |
| 38 | Wamda | RSS | `https://www.wamda.com/feed` | 2026-09-28 | MENA start-up ecosystem and VC |
| 39 | Fintech News Middle East | RSS | `https://fintechnews.ae/feed/` | 2026-09-30 | UAE and GCC fintech |
| 40 | Arab News | RSS | `https://www.arabnews.com/rss.xml` | 2026-09-30 | Saudi daily (PIF, Saudi capital markets) |
| 41 | Saudi Gazette | RSS | `https://saudigazette.com.sa/rssFeed/0` | 2026-09-30 | Saudi business |
| 42 | Gulf Times (Qatar) | RSS | `https://www.gulf-times.com/rssFeed/3` | 2026-09-28 | Qatar (QIA, Qatari markets) |
| 43 | Times of Oman | RSS | `https://timesofoman.com/feed` | 2026-09-30 | Oman |
| 44 | Asharq Al-Awsat (English) | RSS | `https://english.aawsat.com/feed` | 2026-09-30 | Pan-Arab (filter for business) |
| 45 | Al Jazeera (all) | RSS | `https://www.aljazeera.com/xml/rss/all.xml` | 2026-09-30 | Regional and global (filter for economy) |
| 46 | Semafor | RSS | `https://www.semafor.com/rss.xml` | 2026-09-29 | Global business, including its Gulf coverage |

### D. Global financial news

| # | Source | Access | Feed / endpoint | Newest item on 30 Sep 2026 | Focus |
|---|---|---|---|---|---|
| 47 | Financial Times (home) | RSS | `https://www.ft.com/rss/home` | 2026-09-30 | Global finance, headlines only (paywalled) |
| 48 | Financial Times (companies) | RSS | `https://www.ft.com/companies?format=rss` | 2026-09-30 | Companies and deals |
| 49 | Bloomberg Markets | RSS | `https://feeds.bloomberg.com/markets/news.rss` | 2026-09-29 | Markets (headlines; paywalled) |
| 50 | Bloomberg Business | RSS | `https://feeds.bloomberg.com/business/news.rss` | 2026-09-30 | Business, M&A and capital markets (headlines; paywalled) |
| 51 | CNBC Top News | RSS | `https://www.cnbc.com/id/100003114/device/rss/rss.html` | 2026-09-30 | US and global business |
| 52 | CNBC Finance | RSS | `https://www.cnbc.com/id/10000664/device/rss/rss.html` | 2026-09-30 | Finance section |
| 53 | MarketWatch | RSS | `https://feeds.content.dowjones.io/public/rss/mw_topstories` | 2026-09-30 | Markets |
| 54 | Yahoo Finance | RSS | `https://finance.yahoo.com/news/rssindex` | 2026-09-24 | Markets and company news |
| 55 | Business Insider | Atom | `https://feeds.businessinsider.com/custom/all` | 2026-09-30 | Business and finance |
| 56 | Fortune | RSS | `https://fortune.com/feed/` | 2026-09-30 | Business, includes Term Sheet deal coverage |
| 57 | Forbes Business | RSS | `https://www.forbes.com/business/feed/` | 2026-09-30 | Business and investing |
| 58 | The Economist (Finance & economics) | RSS | `https://www.economist.com/finance-and-economics/rss.xml` | 2026-09-29 | Macro and finance analysis |
| 59 | BBC Business | RSS | `https://feeds.bbci.co.uk/news/business/rss.xml` | 2026-09-30 | Global business |
| 60 | The Guardian Business | RSS | `https://www.theguardian.com/uk/business/rss` | 2026-09-30 | Global business (also has an API, see G) |
| 61 | NYT Business | RSS | `https://rss.nytimes.com/services/xml/rss/nyt/Business.xml` | 2026-09-30 | Business |
| 62 | NYT DealBook | RSS | `https://rss.nytimes.com/services/xml/rss/nyt/Dealbook.xml` | 2026-09-30 | Deals, M&A, Wall Street |
| 63 | Nikkei Asia | RSS 1.0 (RDF) | `https://asia.nikkei.com/rss/feed/nar` | n/a | Asian business and capital flows |
| 64 | South China Morning Post Business | RSS | `https://www.scmp.com/rss/92/feed` | 2026-09-30 | China and Hong Kong business |
| 65 | The Economic Times Markets | RSS | `https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms` | 2026-09-30 | Indian markets |
| 66 | Mint Markets | RSS | `https://www.livemint.com/rss/markets` | n/a | Indian markets |
| 67 | Straits Times Business | RSS | `https://www.straitstimes.com/news/business/rss.xml` | 2026-09-30 | Singapore and South-East Asia business |
| 68 | Euronews Business | RSS | `https://www.euronews.com/rss?format=mrss&level=theme&name=business` | 2026-09-30 | European business |
| 69 | DW Business | RSS 1.0 (RDF) | `https://rss.dw.com/rdf/rss-en-bus` | 2026-09-30 | German and European business |
| 70 | Financial Post | RSS | `https://financialpost.com/feed/` | 2026-09-30 | Canadian business (pension-fund coverage) |
| 71 | The Globe and Mail Business | RSS | `https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/business/` | 2026-09-28 | Canadian business (Canadian pension funds are major PE investors) |
| 72 | City A.M. | RSS | `https://www.cityam.com/feed/` | 2026-09-30 | London financial district |
| 73 | CoinDesk | RSS | `https://www.coindesk.com/arc/outboundfeeds/rss/` | 2026-09-30 | Digital assets (for digital-asset funds) |

### E. Regulators, central banks and official data

| # | Source | Access | Feed / endpoint | Newest item on 30 Sep 2026 | Focus |
|---|---|---|---|---|---|
| 74 | SEC Press Releases | RSS | `https://www.sec.gov/news/pressreleases.rss` | 2026-09-29 | US securities regulator |
| 75 | SEC EDGAR Form D filings (private offerings) | Atom | `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=D&company=&dateb=&owner=include&start=0&count=40&output=atom` | 2026-09-30 | US private fund and company raises, filed within 15 days of first sale. Primary fundraising signal |
| 76 | SEC EDGAR Submissions API | API (JSON) | `https://data.sec.gov/submissions/CIK##########.json` | live (JSON) | Filings by company (JSON); send a User-Agent with contact details |
| 77 | Federal Reserve Press Releases | RSS | `https://www.federalreserve.gov/feeds/press_all.xml` | n/a | US monetary policy (the UAE central bank follows Fed rate moves) |
| 78 | European Central Bank | RSS | `https://www.ecb.europa.eu/rss/press.html` | 2026-09-30 | Euro-area policy |
| 79 | Bank of England | RSS | `https://www.bankofengland.co.uk/rss/news` | 2026-09-25 | UK policy |
| 80 | Bank for International Settlements | RSS 1.0 (RDF) | `https://www.bis.org/doclist/all_pressrels.rss` | 2026-09-23 | Central-bank research and statistics |
| 81 | ESMA News | RSS | `https://www.esma.europa.eu/rss.xml` | n/a | EU markets regulator (AIFMD for fund managers) |
| 82 | UK FCA News | RSS | `https://www.fca.org.uk/news/rss.xml` | 2026-09-28 | UK conduct regulator |
| 83 | DFSA (Dubai) News | RSS | `https://www.dfsa.ae/rss` | 2026-09-23 | DIFC financial regulator |
| 84 | US CFTC Press Releases | RSS | `https://www.cftc.gov/RSS/RSSGP/rssgp.xml` | 2026-09-24 | US derivatives regulator |
| 85 | European Commission Press Corner | RSS | `https://ec.europa.eu/commission/presscorner/api/rss?language=en` | 2026-09-29 | EU policy, competition decisions on M&A |
| 86 | Hong Kong Monetary Authority Press | RSS | `https://www.hkma.gov.hk/eng/other-information/rss/rss_press-release.xml` | n/a | Hong Kong policy |
| 87 | Bank of Canada Press | RSS 1.0 (RDF) | `https://www.bankofcanada.ca/content_type/press-releases/feed/` | 2026-09-29 | Canadian policy |
| 88 | World Bank Open Data API | API (JSON) | `https://api.worldbank.org/v2/country/ARE/indicator/NY.GDP.MKTP.CD?format=json&per_page=2` | live (JSON) | Macro indicators for the UAE and other countries (JSON) |

### F. Press-release wires (content issued for redistribution)

| # | Source | Access | Feed / endpoint | Newest item on 30 Sep 2026 | Focus |
|---|---|---|---|---|---|
| 89 | PR Newswire (Financial services) | RSS | `https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss` | 2026-09-30 | Fund closes, launches, hires |
| 90 | PR Newswire (Venture capital) | RSS | `https://www.prnewswire.com/rss/financial-services-latest-news/venture-capital-list.rss` | 2026-09-30 | Funding announcements |
| 91 | PR Newswire (All news) | RSS | `https://www.prnewswire.com/rss/news-releases-list.rss` | 2026-09-30 | Broad feed; filter by relevance |
| 92 | Business Wire (Home) | RSS | `https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeGVtRWA==` | 2026-09-30 | Corporate announcements |
| 93 | Business Wire (Banking/Financial) | RSS | `https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeGVtXWQ==` | 2026-09-30 | Financial-sector releases |
| 94 | GlobeNewswire (Public companies) | RSS | `https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies` | 2026-09-30 | Listed-company releases |
| 95 | GlobeNewswire (Mergers & Acquisitions) | RSS | `https://www.globenewswire.com/RssFeed/subjectcode/27-Mergers%20And%20Acquisitions/feedTitle/GlobeNewswire%20-%20Mergers%20And%20Acquisitions` | 2026-09-30 | M&A announcements |
| 96 | GlobeNewswire (Banking & financial services) | RSS | `https://www.globenewswire.com/RssFeed/industry/8000-Financials/feedTitle/GlobeNewswire%20-%20Industry%20News%20on%20Financials` | 2026-09-30 | Financial-sector releases |
| 97 | Newswire.ca (Cision Canada) | RSS | `https://www.newswire.ca/rss/news-releases-list.rss` | 2026-09-29 | Canadian releases (pension funds, asset managers) |
| 98 | AETOSWire (Middle East wire) | RSS | `https://www.aetoswire.com/rss` | 2026-09-29 | Middle East corporate releases |

### G. Developer APIs (free key required)

| # | Source | Access | Feed / endpoint | Newest item on 30 Sep 2026 | Focus |
|---|---|---|---|---|---|
| 99 | The Guardian Open Platform API | API (JSON) | `https://content.guardianapis.com/search?q=private%20equity&api-key=YOUR_KEY` | endpoint live, key required (HTTP 401) | Search and headlines API; free developer key, commercial use needs a Guardian agreement |
| 100 | FRED API (St. Louis Fed) | API (JSON) | `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&file_type=json&api_key=YOUR_KEY` | endpoint live, key required (HTTP 400) | US and global macro series; free key |

### C4. Sources deliberately not in the list

The same check found these sources unsuitable for automated access today. Don't add them without resolving the note.

| Why excluded | Sources | What to do |
|---|---|---|
| **Block automated requests** (HTTP 403, 405, 429 or 503 on 30 Sep 2026) | Gulf Business, Zawya, Gulf Today, Al Arabiya English, MENAbytes, Mubasher, Bahrain News Agency, Arabian Business start-up section, PitchBook News, Pensions & Investments, Institutional Asset Manager, Alternatives Watch, Axios Pro Rata, Fintech Futures, VentureBeat, DealStreetAsia, Barron's, Business Standard, IMF, OECD, IOSCO, UNCTAD, World Economic Forum, Central Bank of the UAE, DIFC newsroom, ACCESS Newswire, EIN Presswire, Infrastructure Intelligence | Email the publisher and ask for feed access or a syndication agreement. Do not bypass the block |
| **Feed is stale** (newest item months or years old) | WSJ Markets and WSJ Business (January 2025), CNN Business (2018), ai-CIO (2022), StrictlyVC (2020), Disrupt Africa (January 2024) | Re-check quarterly. Skip until they update |
| **No public feed found** | Khaleej Times (its feed URLs return 404 today), WAM, Emirates 24\|7, TradeArabia, Dubai Media Office, ADGM, Saudi Press Agency, Argaam, The Peninsula, Kuwait Times, Oman Observer, Institutional Investor, IPE, Global SWF, SWF Institute, Fortune Term Sheet, and PEI's PERE, Infrastructure Investor, Private Debt Investor and Secondaries Investor (these serve web pages, not feeds, at the usual paths) | Look for a feed link on the site. Otherwise contact the publisher. Several offer licensed feeds |
| **Paid syndication only** | Reuters, AP, Bloomberg full text, Dow Jones/Factiva, LSEG/Zawya content, MEED, Preqin, PitchBook data, Mergermarket, MAGNiTT | Budget for a licence once traffic justifies it (tier L5). Several of these unlock full text and deal data |

> **Your current config needs updating.** `backend/config/sources.news.json` enables `gulf-business` (now 403) and `khaleej-times` (now 404) in live mode, and has `wamda` disabled even though its feed now works. Phase 1 fixes this.

### C5. How each source is configured

Extend each entry in `backend/config/sources.news.json` (and later the `sources` table) with licensing and priority fields:

```json
{
  "id": "pe-hub",
  "name": "PE Hub",
  "homepage": "https://www.pehub.com",
  "type": "rss",
  "url": "https://www.pehub.com/feed/",
  "enabled": true,
  "region": "global",
  "focus": "private-markets",
  "language": "en",
  "priority": 1,
  "tier": "L3",
  "licenseStatus": "terms_reviewed",
  "termsUrl": "https://www.pehub.com/terms-of-use/",
  "termsReviewedAt": "2026-10-02",
  "allowImages": false,
  "allowExcerpt": true,
  "pollEveryHours": 24,
  "notes": "Headlines + publisher excerpt only. Articles are paywalled."
}
```

| Field | Meaning |
|---|---|
| `priority` | 1 = most authoritative (lead link when several outlets cover a story), 3 = least. Drives the ranking weight in D7 |
| `tier` | L1 to L5 from C1 |
| `licenseStatus` | `public_sector`, `wire`, `terms_reviewed`, `permission_granted`, `pending_review` or `blocked`. Only the first four may be published |
| `allowImages` | Show the image the publisher put in its own feed, hot-linked (never copied). **Default `false`** until the terms are checked |
| `allowExcerpt` | Show the publisher's feed excerpt. If `false`, show only the headline and your own summary |
| `pollEveryHours` | 24 for most sources. 1 for tier-1 UAE sources if you enable the hourly light run |

### C6. Adding a source: the checklist

1. Find the feed. Look for an RSS icon, `/feed/` (WordPress), `/rss`, or `<link rel="alternate" type="application/rss+xml">` in the page source.
2. Open the feed URL in a browser. You should see XML with `<item>` or `<entry>`.
3. Run the verifier (Appendix 3) on it. It must pass, and its newest item must be under 7 days old.
4. Find the site's terms of use. Search them for "RSS", "feed", "commercial" and "reproduce". Record the URL.
5. Decide the tier and `licenseStatus`. When unsure, use `pending_review`: items are ingested but can't be published.
6. Add the JSON block (C5) with `enabled: true`. Set `allowImages: false` unless the terms clearly allow hot-linking.
7. Run `npm run validate` and `npm test` in `backend/`.
8. Run one ingestion in a staging environment. Check the admin **Sources** page shows `ok` and sensible item counts.
9. Commit with a message such as `feat(sources): add PE Hub (L3, terms reviewed 2026-10-02)`.
10. Put a reminder in the calendar to re-verify it in 3 months.

---

## Part D: Data pipeline design

### D1. Daily schedule

| When (GST) | Job | What it does | Typical duration |
|---|---|---|---|
| 05:30 | `ingest.news` | Fetch all enabled news sources; parse, filter, dedupe, classify, group | 1-3 min |
| 05:35 | `ingest.jobs` | Fetch job boards; track open/closed roles | < 1 min |
| 05:40 | `ai.enrich.submit` | Send new candidate stories to Claude as one Message Batch | seconds |
| every 10 min until done | `ai.enrich.collect` | Poll the batch; write topics, relevance, importance and summaries back to stories | most batches finish well within an hour |
| after collect | `rank.recompute` | Compute rank scores; move stories above the threshold to `in_review` | seconds |
| 07:00 | *(people)* | Editors review the queue and publish | 15-30 min |
| on every publish/unpublish | `snapshot.build` | Rebuild `api/v1/*.json` from published stories; upload; purge CDN | < 30 s |
| hourly (optional) | `ingest.news.light` | Tier-1 UAE sources only, same pipeline | < 1 min |
| 02:00 | `housekeeping` | Retention clean-up, archive old stories, prune submissions, vacuum stats | < 1 min |

- The morning run is timed so the queue is ready when editors start.
- Time zones are set explicitly (`Asia/Dubai`) in the scheduler, never left to the server's clock.

### D2. Fetching: polite, safe, reliable

Most of these rules already exist in `backend/src/lib/http.js` and `lib/sourceHealth.js`; keep them.

- **Identify yourself.** Set `User-Agent: FundsAeNewsBot/1.0 (+https://funds.ae/about/bot)` and publish a short bot page explaining what you fetch and how to opt out.
- **Conditional requests.** Send `If-None-Match` and `If-Modified-Since`. A `304 Not Modified` costs the publisher almost nothing.
- **One request per feed per run.** Concurrency is 4, with a 15 s timeout per attempt.
- **Retries.**
  - Up to 3, with exponential backoff and jitter, on network errors, 408, 425, 429 and 5xx.
  - Honour `Retry-After`, capped at 60 s.
  - Never retry 403 or 404.
- **Circuit breaker.** 5 consecutive failures, or a 404/410, pauses the source for 7 days and shows it red in the admin.
- **Safety.**
  - Refuse private, loopback and cloud-metadata addresses (prevents server-side request forgery).
  - Cap responses at 5 MB.
  - Strip `<!DOCTYPE>` before XML parsing (blocks entity-expansion attacks).
- **Never fetch article pages.**
  - The only request to an article URL is an optional `HEAD` (or 1 KB ranged `GET`) link check to drop dead links.
  - If a feed includes full text (`content:encoded`), extract at most the excerpt and **discard the rest in memory**. It is never stored.

### D3. Parsing and normalising

| Field stored | Source in the feed | Cleaning rule |
|---|---|---|
| `title` | `<title>` | HTML to plain text; decode entities; remove a trailing " - Publisher Name"; collapse whitespace |
| `original_url` | `<link>` / Atom `link[rel=alternate]` | Must be http(s); resolve relative links against the source homepage |
| `canonical_url` | derived | Lower-case host; strip `www.`, `m.`, `amp.`; force https; drop fragment and tracking parameters (`utm_*`, `fbclid`, `gclid`...); sort the rest; remove trailing `/` and `/amp` |
| `guid` | `<guid>` / `<id>` | Trimmed string |
| `published_at` | `pubDate` / `updated` / `dc:date` | Parse; if missing use fetch time and set `date_estimated = true`; if in the future, clamp to now |
| `summary` | `<description>` / `<summary>` | HTML to text; drop boilerplate ("The post ... appeared first on ..."); truncate at a word boundary to **≤ 280 characters**; blank if identical to the title |
| `image_url` | `media:content`, `enclosure`, first `<img>` in the description | Only if `allowImages` is true for the source; https only; hot-linked, never downloaded |
| `language` | derived | `franc` language detection on title + summary (`en`, `ar`); Arabic support is a Stage 2 feature |
| `author` | `dc:creator` / `author` | Plain text; optional |

All text is plain text from this point on. The website inserts it with `textContent` and never as HTML.

### D4. Removing duplicates

Five layers, cheapest first. Layers 1-4 exist in the repo today.

| # | Layer | Rule | Catches |
|---|---|---|---|
| 1 | Canonical URL | `article_id = 'a_' + sha256(canonical_url)` with a `UNIQUE` constraint | The same article reached with tracking links, or through `www`/`amp` variants |
| 2 | Source GUID | `UNIQUE (source_id, guid)` | The publisher changed the URL but kept the GUID |
| 3 | Headline fingerprint | Same normalised headline from the same source within 7 days | Republished and updated copies |
| 4 | Story grouping | Two articles within 72 h are one story if their headline word sets overlap by Jaccard ≥ 0.5, or they share ≥ 2 distinctive entities (company names, money amounts such as `$45m` = `$45 million`); place names don't count | Five outlets covering the same fund close |
| 5 | Semantic (Stage 2) | Cosine similarity ≥ 0.88 between headline+summary embeddings within 72 h, stored in pgvector | Headline rewrites with no shared words |

- **The story is what gets published, not the article.** Its lead link is the most authoritative source (lowest `priority`, then earliest).
- Every other outlet is kept as "Also reported by".

### D5. Classification

**Step 1: rules (free, instant, explainable).** These already exist in `backend/src/lib/classify.js` with `config/taxonomy.json`:
- **UAE vs World:**
  - UAE terms (places, regulators, sovereign funds, exchanges) score 3 in the headline and 1 in the summary.
  - UAE-based outlets add 1.
  - A score of 2 or more means UAE.
- **Topic:** weighted keywords per topic (private equity, venture capital, private credit, infrastructure, real estate, hedge funds, secondaries, fundraising, M&A, institutional investors, IPOs, grants and funding). Headline hits count double.
- **Relevance:** topic score plus general investment terms, minus off-topic terms. Specialist sources need ≥ 1; general sources need ≥ 3.

**Step 2: AI enrichment (only for items that pass step 1).** Claude reads the **headline and publisher excerpt only** and returns structured JSON (prompt and code in E6):
- relevance (0-1) and a one-line reason
- primary topic and up to 3 topics (same list as the taxonomy)
- importance (1-5)
- deal type (`fund_close`, `fund_launch`, `funding_round`, `acquisition`, `ipo`, `regulation`, `macro`, `people`, `other`)
- entities (organisations, investors, amounts, people)
- a one-sentence summary in its own words

**Step 3: merge the two.**

| Situation | Result |
|---|---|
| Rules and AI agree | Use it |
| AI relevance < 0.3 with confidence ≥ 0.8 | Mark the story `expired` (not shown to editors); keep it for 30 days for tuning |
| AI finds extra topics | Add them (max 3) |
| AI call failed, refused, or its output failed validation | Keep the rule result; flag `needs_manual = true` |
| UAE vs World | Rules decide (they are auditable). AI disagreement is shown to the editor as a hint |

**Editors see both results** and can change topic, region and summary before publishing. The AI output is a suggestion; the editor decides.

### D6. Summaries and copyright safety

A published story shows:
- the headline (as published by the source)
- the source name
- the date
- **one** of:
  1. the publisher's own feed excerpt, up to 280 characters, quoted as supplied and attributed; or
  2. a **funds.ae summary**: one or two sentences, at most 280 characters, written by an editor or suggested by AI and approved by an editor.

Rules for funds.ae summaries, enforced in code at publish time (Part F5):
- **Written only from the headline and the feed excerpt.** Never from the full article. The pipeline never has the full article.
- **Own words.** The publish check rejects a summary that copies **8 or more consecutive words** from the excerpt. Names, titles and amounts are excluded from the count.
- **No new facts.** Every number, name and claim must appear in the headline or excerpt. The AI prompt forbids adding facts, and editors check.
- **Neutral and factual.** No opinion, no investment advice, no "buy/sell" language.
- **Labelled.** The site shows "Summary: funds.ae", and the About page explains that summaries may be AI-assisted and are editor-reviewed.
- **The link is prominent:** "Read the full story at {publisher}".

### D7. Ranking

Rank scores decide the order of the review queue, and the default order of published stories on the home and topic pages.

```
score = 0.30 * recency
      + 0.20 * source_authority
      + 0.20 * topic_weight
      + 0.10 * uae_boost
      + 0.10 * coverage
      + 0.10 * ai_importance
```

| Signal | Formula | Range |
|---|---|---|
| `recency` | `exp(-hours_since_published / 24)`, so about 0.37 at one day and 0.05 at three days | 0-1 |
| `source_authority` | priority 1 = 1.0, 2 = 0.7, 3 = 0.4 (best source in the story) | 0.4-1 |
| `topic_weight` | core private-markets topics (PE, VC, private credit, secondaries, fundraising, institutional investors) = 1.0; infrastructure, real estate, hedge funds, M&A, IPOs = 0.7; grants and funding = 0.6; general investment = 0.3 | 0.3-1 |
| `uae_boost` | 1 if the story is UAE, else 0 | 0/1 |
| `coverage` | `min(1, log2(distinct_sources + 1) / 3)`, where 1 source ≈ 0.33 and 7 sources = 1.0 | 0.33-1 |
| `ai_importance` | `(importance - 1) / 4`; 0.5 if AI unavailable | 0-1 |

**Thresholds and page composition**
- **Review threshold:**
  - `score ≥ 0.35` moves a candidate to `in_review`.
  - Stories below it stay candidates and expire after 7 days.
  - Tune the threshold so the queue holds 40-80 stories a day.
- **Home page:**
  - The UAE and Global tabs each show the 15 highest-scoring **published** stories from the last 72 hours.
  - Stories pinned by an editor come first, until their pin expires.
  - Diversity rule: no more than 3 stories from the same source in a tab's top 15.
- **Topic pages:** published stories with that topic, newest first, 30 per page.
- **Recompute** scores hourly, because recency decays.

### D8. Retention

| Data | Kept for |
|---|---|
| Articles and stories that were never published | 30 days (for tuning), then deleted |
| Published stories (headline, link, summary, metadata) | Indefinitely; archived off the home page after 90 days |
| Source health and run history | 180 days |
| AI enrichment records (model, tokens, output) | 180 days |
| Application logs | 30 days |
| Form submissions | 180 days (`settings.submissions.retentionDays`), then deleted |

### D9. Quality measures (shown on the admin dashboard)

- Items fetched, new, duplicates and filtered, by reason, per run.
- Queue size, and the share of queued stories editors publish. If fewer than 30% get published, raise the threshold; if more than 80%, lower it.
- Editor corrections to AI topics and summaries. This is your ongoing AI quality measure.
- Sources failing, paused or stale (newest item older than 14 days).
- Time from source publication to funds.ae publication (median).


---

## Part E: Building it with Claude Code

Claude Code is an AI coding assistant that runs in your terminal, inside your project folder. It reads your code, runs commands (with your permission), edits files and explains what it did. **You stay the decision-maker.** This part shows how to use it safely and effectively for funds.ae.

### E1. What you need (one-time setup)

| Item | Why | How |
|---|---|---|
| Node.js 24 LTS | Runs the backend and tests | nodejs.org installer, or `nvm install 24` |
| Git and a GitHub account | Version control, pull requests, CI | git-scm.com; github.com |
| GitHub CLI (`gh`) | Lets Claude Code open PRs and read CI results | `winget install GitHub.cli`, then `gh auth login` |
| Docker Desktop (recommended) | Runs PostgreSQL locally for development | docker.com |
| VS Code (optional) | Read diffs comfortably; the Claude Code extension shows changes inline | code.visualstudio.com |
| A Claude plan (Pro or Max) or an Anthropic Console account | Signs you in to Claude Code | claude.ai |
| **A separate Anthropic API key** | For funds.ae's **runtime** AI enrichment (Part E6). Billed per token; not the same as your Claude Code login | console.anthropic.com → API keys; set a monthly spend limit |

**Install Claude Code** (pick one):

```powershell
# Windows PowerShell
irm https://claude.ai/install.ps1 | iex
```
```bash
# macOS / Linux / Git Bash
curl -fsSL https://claude.ai/install.sh | bash
# or, with Node installed
npm install -g @anthropic-ai/claude-code
```

Then open your project and sign in:

```bash
cd path/to/funds.ae
claude            # first run asks you to log in
claude --version  # check it works
```

### E2. Your first session: set up the project for Claude

1. **Remove the stray instructions.** Rename `C:\Users\ishan\Downloads\CLAUDE.md` (for example to `CompEngSoc-CLAUDE.md`), or move `funds.ae` out of `Downloads`. Claude Code reads `CLAUDE.md` files in parent folders, and that one belongs to a different project.
2. Start Claude Code in the repo: `claude`.
3. Type `/init`. Claude scans the repo and writes a starter `CLAUDE.md`. **Replace its content with the template in E3.** The template encodes the rules this guide depends on.
4. Commit it: `git add CLAUDE.md .claude && git commit -m "docs: Claude Code project instructions"`.

**Commands you will use every day**

| Command / key | What it does |
|---|---|
| `Shift+Tab` | Cycles permission modes. **Plan mode** makes Claude research and propose a plan without changing files. Use it at the start of every phase |
| `/clear` | Start a fresh conversation (do this between phases) |
| `/compact` | Summarise a long conversation to free up context |
| `/model` | Choose the Claude model Claude Code uses |
| `/permissions` | See and edit what Claude may do without asking. It writes the correct rule syntax for your version |
| `/agents` | Create and manage subagents (E5) |
| `/mcp` | Manage connected tools (E5) |
| `/code-review` | Review the current branch's changes for bugs |
| `/security-review` | Security review of pending changes |
| `/rewind` (or `Esc` twice) | Go back to an earlier point and undo changes |
| `@path/to/file` | Point Claude at a specific file in your message |
| `!command` | Run a shell command yourself; the output goes into the conversation |
| `Esc` | Interrupt Claude mid-task (then redirect it) |

### E3. `CLAUDE.md` for funds.ae (copy this into the repo root)

```markdown
# funds.ae: instructions for Claude Code

## What this is
funds.ae aggregates UAE and global private-capital news (PE, VC, private credit, hedge funds,
institutional investors), jobs and events. Stories are ingested automatically, enriched by AI,
and published ONLY after an editor presses Publish. Build guide: docs/FUNDS-AE-BUILD-GUIDE.md.

## Stack
Node.js 24 (ES modules, JavaScript + JSDoc), Fastify 5, PostgreSQL 17 (pg + node-pg-migrate),
pg-boss (jobs/cron), @anthropic-ai/sdk + zod, pino, node:test. Website: static HTML in
frontend_demo/ + js/fundsae-*.js reading /api/v1 JSON.

## Commands (run from backend/)
- npm test                 all tests (must pass before any commit)
- npm run validate         check config files
- npm run migrate up       apply database migrations (local/staging only)
- npm run dev:web / dev:worker   run locally
- npm run ingest           one ingestion run

## Architecture rules
- Data access ONLY through src/repositories/. No SQL anywhere else.
- Every SQL query is parameterised ($1, $2). Never build SQL with string concatenation.
- Record -> API mapping ONLY in src/contracts/serializers.js. The API contract is
  src/contracts/models.js; changing a field means updating models, schema (migration),
  serializers, js/ scripts and tests together (test/contract.test.js enforces this).
- Web process (src/server, src/admin) never runs ingestion; worker (src/worker) does.
- Status changes of stories go through src/editorial/transitions.js (state machine + audit log).

## Legal rules (never break these)
- Never fetch or store full article text. Store headline, link, publisher excerpt <= 280 chars,
  metadata, and our own summary only. Discard content:encoded after extracting an excerpt.
- Never download publisher images; hot-link only when source.allowImages is true.
- Every published item shows source name + link to the original.
- AI summaries are written from headline + excerpt only, <= 280 chars, and are editor-approved.
- Never bypass bot blocking (no fake user-agents, no proxies).

## Security rules
- Secrets only from environment variables; never commit .env; never log secrets or personal data.
- Admin routes require login + role check + CSRF token; 2FA required for editor and above.
- Validate every input (zod or src/validation). Escape all output (templates auto-escape; the
  website uses textContent only).

## Working agreement
- Start each task in plan mode; wait for approval.
- Write or update tests with every change; run npm test and show the result.
- Small commits with conventional messages (feat:, fix:, chore:, docs:, test:).
- Never run migrations, deploys or destructive commands against production.
- If a requirement is unclear, ask instead of guessing.
```

**`.claude/settings.json`**: shared project settings, committed to git.

```json
{
  "permissions": {
    "allow": [
      "Bash(npm test)",
      "Bash(npm run validate)",
      "Bash(npm run lint)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./backend/.env)",
      "Bash(git push --force:*)"
    ]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "npm --prefix backend run lint --silent" }
        ]
      }
    ]
  }
}
```

- The **deny** rules keep secrets out of Claude's context.
- The **hook** runs the linter automatically after every file edit, so style problems surface immediately.
- If a rule doesn't match what you expect, add it through `/permissions` instead; that writes the syntax your installed version uses.

### E4. The working loop (use it for every phase in Part J)

```
1. git switch -c phase-N-short-name          # new branch per phase
2. claude  ->  /clear                         # fresh context
3. Shift+Tab to plan mode, paste the phase prompt from Part J
4. Read the plan. Ask questions. Approve only when it matches the guide.
5. Let Claude implement. It runs tests as it goes.
6. /code-review  and  /security-review
7. Run the phase's "Done when" checks yourself (commands are in Part J)
8. git push, open a PR (Claude can do it: "open a PR for this branch"), wait for CI green, merge
9. Add anything learned to CLAUDE.md
```

**Rules that keep a beginner safe**
- **One phase per session.** Long, mixed sessions are where mistakes creep in.
- **Be specific.** Name the files, the behaviour, and how to prove it works. The prompts in Part J already do this.
- **Ask for explanations.** "Explain what you changed and why, as if I'm new to Node" is a perfectly good prompt.
- **Never paste secrets** (API keys, passwords, database URLs) into the chat. Put them in `.env`, which Claude is denied from reading.
- **Local and staging only.** Claude Code never gets production database credentials or deploy rights. You press deploy.
- **If it goes off track,** press `Esc`, say what's wrong, or `/rewind` to an earlier point.

### E5. Subagents, commands and tools

**Subagents** are specialist helpers with their own instructions and limited tools. Create them with `/agents`, or as files in `.claude/agents/`. Four are worth having for funds.ae:

`.claude/agents/compliance-reviewer.md`
```markdown
---
name: compliance-reviewer
description: Reviews code changes against funds.ae legal rules (no full-text storage, attribution, summary rules, image rules, source licence checks). Use before merging any change to ingestion, storage, publishing or the website.
tools: Read, Grep, Glob, Bash
---
You review diffs for copyright and privacy compliance in funds.ae.
Check, and report each as PASS/FAIL with file:line evidence:
1. No code stores or logs full article text (content:encoded, article HTML, scraped pages).
2. Excerpts are truncated to <= 280 characters before storage.
3. Images are never downloaded or re-hosted; hot-linking only when source.allowImages is true.
4. Every public output includes source name and original URL.
5. AI summaries are generated from headline + excerpt only and pass the 8-word copy check.
6. Stories from sources with licenseStatus pending_review or blocked cannot be published.
7. Personal data (form submissions, users) is never written to logs or public files.
Run `git diff main...HEAD` to see the changes. Do not edit files; only report.
```

`.claude/agents/pipeline-tester.md`
```markdown
---
name: pipeline-tester
description: Runs the backend test suite and diagnoses failures. Use after any backend change.
tools: Read, Grep, Glob, Bash
---
Run `npm test` in backend/. If anything fails, find the root cause (read the failing test and
the code it exercises), explain it in plain English, and propose the smallest fix. Do not
weaken or delete tests to make them pass.
```

`.claude/agents/source-verifier.md`
```markdown
---
name: source-verifier
description: Verifies news feed URLs and proposes source registry entries. Use when adding or auditing sources.
tools: Read, Grep, Glob, Bash, WebFetch
---
For each source: run `node backend/scripts/check-sources.mjs <url>` and report status, format,
item count and newest item date. A source qualifies only if it returns a valid feed with an item
newer than 7 days. Find and quote the site's terms-of-use section about RSS/feeds/commercial use
if one exists. Propose a JSON entry following Part C5 of docs/FUNDS-AE-BUILD-GUIDE.md with
licenseStatus "pending_review" unless the terms clearly permit use. Never suggest bypassing a
403/blocked response.
```

`.claude/agents/migration-reviewer.md`
```markdown
---
name: migration-reviewer
description: Reviews database migrations for safety before they run on staging or production.
tools: Read, Grep, Glob
---
Check each migration in backend/migrations/ for: reversible down step, no data loss without an
explicit backfill, NOT NULL columns added with defaults, indexes created CONCURRENTLY on large
tables, CHECK constraints matching src/contracts/models.js, and no secrets. Report issues only.
```

Use them by name: *"Use the compliance-reviewer agent to review this branch."*

**Custom commands** turn repeated prompts into one word. Save them as `.claude/commands/<name>.md`; `$ARGUMENTS` is whatever you type after the command.

`.claude/commands/phase.md`: run with `/phase 3`
```markdown
Read Part J, Phase $ARGUMENTS, of docs/FUNDS-AE-BUILD-GUIDE.md and the parts it references.
Enter plan mode behaviour: produce a step-by-step plan (files to create/change, tests to add,
commands to run) and wait for my approval before editing anything. Follow CLAUDE.md rules.
```

`.claude/commands/add-source.md`: run with `/add-source https://example.com/feed/`
```markdown
Add a news source for $ARGUMENTS following Part C6 of docs/FUNDS-AE-BUILD-GUIDE.md.
Use the source-verifier agent first. Only add it with enabled: true if verification passes.
Use licenseStatus "pending_review" unless I confirm the terms. Run npm run validate and npm test.
```

**Tools and integrations**

| Tool | Use it for | Set up |
|---|---|---|
| GitHub CLI (`gh`) | Claude opens PRs, reads CI logs, comments on issues | `gh auth login` (already in E1) |
| Claude GitHub app | Mention `@claude` on a PR or issue to have it review or fix things in CI | Inside Claude Code: `/install-github-app` |
| Playwright MCP | Claude drives a real browser to test the admin publish flow and the website | `claude mcp add playwright -- npx @playwright/mcp@latest` |
| Headless mode | Scripted runs, e.g. a weekly "audit sources and open an issue" job | `claude -p "Audit the source registry..." --output-format json` |
| `psql` against **local** PostgreSQL | Let Claude inspect your development database | Docker Postgres from Phase 2; never production credentials |

**Open-source libraries used alongside Claude Code**

| Purpose | Library |
|---|---|
| Feed parsing | `fast-xml-parser` (already used) |
| Database, migrations | `pg`, `node-pg-migrate`, optional `pgvector` extension |
| Jobs, cron, retries | `pg-boss` |
| Web and admin | `fastify`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cookie`, `@fastify/formbody`, `@fastify/view`, `@fastify/csrf-protection`, `@fastify/static`, `eta`, `htmx.org` |
| Validation | `zod` |
| Passwords and 2FA | `@node-rs/argon2` (Argon2id), `otplib` (TOTP) |
| AI | `@anthropic-ai/sdk` |
| Language detection | `franc` |
| Semantic dedupe (Stage 2) | `@huggingface/transformers` (runs `Xenova/all-MiniLM-L6-v2` locally), `pgvector` |
| Logging and errors | `pino`, `pino-pretty` (dev), `@sentry/node` |
| Testing | `node:test` (already used), `@playwright/test` for end-to-end, `k6` for load tests |
| Code quality | `eslint`, `prettier` |

### E6. Prompts: how to write them, and the ones funds.ae runs

There are **two different kinds of prompt** in this project. Don't mix them up.

1. **Build prompts:** what *you* type into Claude Code to build a feature. Structure every one as **Context, then Task, then Constraints, then Proof**:

```
Context:   what exists and which files matter (@backend/src/pipeline/news.js ...)
Task:      the behaviour you want, in plain words
Rules:     constraints from CLAUDE.md / this guide that apply (legal, security, style)
Proof:     tests to add and commands that must pass; what to show me at the end
```

2. **Runtime prompts:** what the *application* sends to the Claude API every morning to classify and summarise stories. They live in code (`backend/src/ai/`), are version-controlled, and are tested like code.

#### Build prompt: ingestion

```
Context: backend/src/pipeline/news.js and backend/src/adapters/index.js fetch RSS sources listed in
backend/config/sources.news.json. Part C5 of docs/FUNDS-AE-BUILD-GUIDE.md adds fields tier,
licenseStatus, allowExcerpt, pollEveryHours, language.
Task: support the new fields end to end: validate them in src/config.js, store them on sources,
skip sources whose pollEveryHours has not elapsed since last success, and drop the excerpt when
allowExcerpt is false. Discard any content:encoded after extracting the excerpt.
Rules: follow CLAUDE.md legal rules; no new dependencies.
Proof: add unit tests for each field (valid/invalid config, excerpt dropped, poll interval
respected); npm run validate and npm test must pass. Show me the test output.
```

#### Build prompt: filtering

```
Context: backend/src/lib/quality.js and config/taxonomy.json filter opinion, advertorial,
non-article and off-topic items. Part D5 describes rules + AI merge.
Task: record the filter reason for every discarded item in the run statistics (already partly
done) and expose per-source filter counts on the admin Runs page data (repository function only
for now). Add a "stale" filter: items older than settings.news.maxAgeDays are discarded.
Proof: unit tests with fixture items for each reason; npm test passes.
```

#### Build prompt: classification (AI enrichment)

```
Context: Part D5 and Part E6 of docs/FUNDS-AE-BUILD-GUIDE.md define an enrichment step using the
Claude Message Batches API with structured JSON output. Stories live in the stories table.
Task: create backend/src/ai/enrich.js exactly as specified in E6 (system prompt, JSON schema,
zod validation, submitBatch, collectBatch), plus pg-boss jobs ai.enrich.submit and
ai.enrich.collect in src/worker/. Store results in story_enrichments and merge them into stories
using the Part D5 merge table. Record model, token usage and cost estimate per batch in llm_runs.
Rules: send ONLY headline + publisher excerpt + source name + date. Never send full text.
The model name comes from FUNDSAE_AI_MODEL (default claude-opus-5). API key from
ANTHROPIC_API_KEY. Handle: errored/expired results (retry next run), refusal and max_tokens
stop reasons (flag needs_manual), invalid JSON (flag needs_manual).
Proof: unit tests that mock the Anthropic client (no real API calls in tests) for success,
refusal, invalid output and expired results; npm test passes.
```

#### Build prompt: summarisation guard

```
Context: Part D6 defines summary rules; Part F5 defines publish checks.
Task: add backend/src/editorial/copycheck.js exporting longestCopiedRun(summary, excerpt) as in
Part F5, and use it in the publish transition: reject publishing when the run is >= 8 words
(names, titles and amounts are excluded by the function). Show the editor which words matched.
Proof: unit tests with examples that pass and fail; npm test passes.
```

#### Runtime prompt and code: classification + summary (daily batch)

`backend/src/ai/enrich.js` (reference implementation to give Claude Code):

```js
// AI enrichment for stories: topic, relevance, importance, deal type, entities and a
// one-sentence summary, from the HEADLINE AND PUBLISHER EXCERPT ONLY.
// Runs as a Message Batch (asynchronous, lower price), once per ingestion run.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
export const MODEL = process.env.FUNDSAE_AI_MODEL || 'claude-opus-5';
export const PROMPT_VERSION = 'enrich-v1';

export const TOPICS = [
  'private-equity', 'venture-capital', 'private-credit', 'infrastructure', 'real-estate',
  'hedge-funds-alternatives', 'secondaries', 'fundraising', 'mergers-acquisitions',
  'institutional-investors', 'ipo-capital-markets', 'grants-funding', 'general-investment'
];
export const DEAL_TYPES = ['fund_close', 'fund_launch', 'funding_round', 'acquisition', 'ipo',
  'regulation', 'macro', 'people', 'other'];

// Sent to the API. Numeric/length limits are not supported in the schema itself,
// so they are enforced by the zod schema below after the response arrives.
export const ENRICHMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['relevant', 'relevance', 'reason', 'primaryTopic', 'topics', 'importance',
    'dealType', 'region', 'entities', 'summary', 'confidence'],
  properties: {
    relevant: { type: 'boolean' },
    relevance: { type: 'number' },
    reason: { type: 'string' },
    primaryTopic: { type: 'string', enum: TOPICS },
    topics: { type: 'array', items: { type: 'string', enum: TOPICS } },
    importance: { type: 'integer' },
    dealType: { type: 'string', enum: DEAL_TYPES },
    region: { type: 'string', enum: ['uae', 'gcc', 'world'] },
    entities: {
      type: 'object',
      additionalProperties: false,
      required: ['organisations', 'investors', 'amounts', 'people'],
      properties: {
        organisations: { type: 'array', items: { type: 'string' } },
        investors: { type: 'array', items: { type: 'string' } },
        amounts: { type: 'array', items: { type: 'string' } },
        people: { type: 'array', items: { type: 'string' } }
      }
    },
    summary: { type: 'string' },
    confidence: { type: 'number' }
  }
};

// Validates what came back (including the limits the API schema can't express).
export const Enrichment = z.object({
  relevant: z.boolean(),
  relevance: z.number().min(0).max(1),
  reason: z.string().max(200),
  primaryTopic: z.enum(TOPICS),
  topics: z.array(z.enum(TOPICS)).max(3),
  importance: z.number().int().min(1).max(5),
  dealType: z.enum(DEAL_TYPES),
  region: z.enum(['uae', 'gcc', 'world']),
  entities: z.object({
    organisations: z.array(z.string().max(120)).max(10),
    investors: z.array(z.string().max(120)).max(10),
    amounts: z.array(z.string().max(40)).max(5),
    people: z.array(z.string().max(80)).max(5)
  }).strict(),
  summary: z.string().min(20).max(280),
  confidence: z.number().min(0).max(1)
}).strict();

export const SYSTEM_PROMPT = `You are a news classifier and sub-editor for funds.ae, a UAE-focused
site about private capital: private equity, venture capital, private credit, hedge funds,
secondaries, infrastructure and real estate funds, fundraising, M&A, IPOs, and sovereign and
institutional investors.

You receive ONE news item: a headline, the publisher's short excerpt, the publisher name and the
publication date. You never see the full article.

Return JSON matching the schema:
- relevant / relevance (0-1): is this useful to professionals in private capital or UAE/GCC
  business and investing? General consumer news, sport, crime, weather, celebrity, gadgets and
  pure politics are not relevant unless they directly concern investors, funds or deals.
- reason: one short sentence explaining the relevance judgement.
- primaryTopic and topics (max 3) from the allowed list. Use general-investment only if nothing
  more specific fits.
- importance (1-5): 5 = major deal, fund close or policy change affecting the market (e.g. a
  sovereign fund commitment above USD 1bn); 3 = notable deal or fund news; 1 = minor or routine.
- dealType from the allowed list.
- region: "uae" if the UAE is central to the story, "gcc" if another GCC country is central,
  else "world".
- entities: names of organisations, investors, money amounts (as written, e.g. "$45m") and
  people that appear in the headline or excerpt. Empty arrays if none.
- summary: ONE or TWO plain sentences, maximum 280 characters, in your own words, stating what
  happened. Use ONLY facts present in the headline or excerpt. Do not add numbers, names, dates,
  causes or context that are not in the input. Do not copy more than five consecutive words from
  the excerpt except names and amounts. No opinions, no advice, no hype, no quotation marks.
- confidence (0-1): your confidence in the classification.

If the input is too thin to summarise, write a summary that restates the headline neutrally in
different words.`;

function renderItem(story) {
  // Only these four fields ever leave funds.ae.
  return [
    `Publisher: ${story.source}`,
    `Published: ${story.publishedAt}`,
    `Headline: ${story.headline}`,
    `Excerpt: ${story.excerpt || '(none)'}`
  ].join('\n');
}

export async function submitBatch(stories) {
  const batch = await client.messages.batches.create({
    requests: stories.map((story) => ({
      custom_id: story.storyId, // e.g. s_5dbd32a8d22e9c
      params: {
        model: MODEL,
        max_tokens: 2000,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: renderItem(story) }],
        output_config: {
          effort: 'low', // classification needs little deliberation; keeps cost down
          format: { type: 'json_schema', schema: ENRICHMENT_JSON_SCHEMA }
        }
      }
    }))
  });
  return batch.id;
}

/**
 * Collects a finished batch. Returns false if it is still running.
 * onResult(storyId, { ok, data?, error?, usage?, model? }) is called once per story.
 */
export async function collectBatch(batchId, onResult) {
  const batch = await client.messages.batches.retrieve(batchId);
  if (batch.processing_status !== 'ended') return false;
  for await (const item of await client.messages.batches.results(batchId)) {
    if (item.result.type !== 'succeeded') {
      // errored / expired / canceled: retried on the next run
      await onResult(item.custom_id, { ok: false, error: item.result.type });
      continue;
    }
    const message = item.result.message;
    if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
      await onResult(item.custom_id, { ok: false, error: message.stop_reason });
      continue;
    }
    const text = message.content.find((block) => block.type === 'text')?.text ?? '';
    const parsed = Enrichment.safeParse(safeJson(text));
    if (!parsed.success) {
      await onResult(item.custom_id, { ok: false, error: 'invalid_output' });
      continue;
    }
    await onResult(item.custom_id, { ok: true, data: parsed.data, usage: message.usage, model: message.model });
  }
  return true;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
```

Notes on this design:
- **Why Batches.**
  - The morning run is not time-critical, and Message Batches cost about half the normal per-token price.
  - Results usually arrive well within an hour, which fits the 05:30-07:00 window in D1.
  - Batch results come back in any order; always match them by `custom_id`.
- **Model.**
  - The default is `claude-opus-5`. It is set by `FUNDSAE_AI_MODEL`, so you can change it without a code change.
  - Other models (for example `claude-sonnet-5` or `claude-haiku-4-5`) are cheaper per token. Switching is a quality-versus-cost decision.
  - Make it only after comparing outputs on 100 real stories that editors have already checked (see "Measuring quality" below).
- **Effort.** `effort: 'low'` keeps thinking (and cost) small for a simple classification task.
- **Prompt caching.**
  - The system prompt is marked cacheable.
  - It only caches if the prompt is longer than the model's minimum cacheable size. If `usage.cache_read_input_tokens` stays at 0, it isn't long enough, and nothing breaks.
- **Refusals.**
  - Rare for news, but handled: the story is flagged `needs_manual` and the rule-based classification stands.
  - The API's automatic refusal fallback isn't available for batch requests. The interactive "Suggest summary" button (below) can use it if you choose.
- **Cost, as an order of magnitude.**
  - 300 stories a day at roughly 1,500 input and 300 output tokens each, at batch pricing for Claude Opus 5 ($5 / $25 per million tokens standard, halved for batches), comes to **about $1-3 a day**.
  - Check the Anthropic pricing page for current rates, and the `llm_runs` table for your actual spend. Set a monthly spend limit in the Anthropic Console.

**Interactive "Suggest summary" button (admin, one story at a time)**

```js
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Enrichment, SYSTEM_PROMPT, MODEL } from './enrich.js';

const client = new Anthropic();

export async function suggestForEditor(story) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Publisher: ${story.source}\nPublished: ${story.publishedAt}\nHeadline: ${story.headline}\nExcerpt: ${story.excerpt || '(none)'}` }],
    output_config: { effort: 'low', format: zodOutputFormat(Enrichment) }
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return null; // editor writes it
  return response.parsed_output;
}
```

- If you want automatic fallback when a model declines, the API offers `fallbacks: "default"`. It goes on the beta messages endpoint with the `server-side-fallback-2026-07-01` beta header.
- It is **not** available on the Batches API. Ask Claude Code to add it to this interactive path if you want it.

**Measuring quality (do this before trusting any AI change)**
1. Export 100 stories that editors have already reviewed. These are your ground truth: topic, region, published or rejected, final summary.
2. Run the enrichment on them. Compare:
   - **topic accuracy:** primary topic equals the editor's topic;
   - **relevance agreement:** relevant equals published;
   - **summary acceptance:** the editor would publish the summary unchanged, rated by a colleague.
3. Change the prompt or model **only** if these numbers stay the same or improve. Record every comparison in `docs/ai-evals.md`. Bump `PROMPT_VERSION` with every prompt change; it is stored with every enrichment.


---

## Part F: Backend implementation

### F1. Stack decision

**Node.js 24 LTS + Fastify 5 + PostgreSQL 17 + pg-boss**, deployed as two processes: `web` and `worker`. The reasons are in B4.

The short version:
- it keeps the tested pipeline you already have;
- it is one language;
- it has no Redis;
- it has secure-by-default web plugins.

Why not the alternatives:
- **Django** is a strong alternative when a team already knows Python. Its built-in admin would save time on F4, but you would rewrite ingestion.
- **FastAPI** would add the same rewrite without the admin.

`backend/package.json` scripts to add:

```json
{
  "scripts": {
    "dev:web": "node --watch src/web.js",
    "dev:worker": "node --watch src/worker/index.js",
    "start:web": "node src/web.js",
    "start:worker": "node src/worker/index.js",
    "migrate": "node-pg-migrate --migrations-dir migrations --migration-file-language sql",
    "lint": "eslint src test",
    "test": "node --test test/*.test.js",
    "test:e2e": "playwright test",
    "check-sources": "node scripts/check-sources.mjs"
  }
}
```

### F2. Target repository layout

New items are marked `+`. Everything else exists today.

```
funds.ae/
  CLAUDE.md                         + project instructions (E3)
  .claude/                          + settings.json, agents/, commands/
  docs/FUNDS-AE-BUILD-GUIDE.md      + this guide
  frontend_demo/                    website pages (+ topic.html in Phase 6)
  js/                               fundsae-api.js, fundsae-connector.js, fundsae-forms.js
  backend/
    migrations/                     + 0001_base.sql (from schema/schema.sql), 0002_editorial.sql, ...
    scripts/check-sources.mjs       + feed verifier (Appendix 3)
    src/
      config.js, contracts/, validation/, lib/, adapters/, pipeline/   (exist)
      repositories/                 index.js (JSON, exists)  + pg/ (PostgreSQL implementation)
      db/pool.js                    + one pg Pool, timeouts, SSL
      ai/enrich.js, ai/suggest.js   + Part E6
      editorial/                    + transitions.js (state machine), ranking.js (D7),
                                      copycheck.js (D6), placements.js
      publisher/snapshot.js         + builds api/v1 JSON from published stories, uploads, purges CDN
      worker/index.js               + pg-boss: schedules and job handlers (Part G)
      server/                       public API + forms (exists; becomes a Fastify plugin)
      admin/                        + auth/ (sessions, passwords, totp, rbac), routes/, views/ (Eta)
      web.js                        + Fastify app: helmet, rate limit, server + admin plugins
    test/                           unit, contract, server (exist) + pg/ (integration), e2e/
```

### F3. Database schema

- `backend/schema/schema.sql` already defines `sources`, `articles`, `stories`, `jobs`, `events`, `sponsor_items`, `submissions` and `ingestion_runs`.
- It becomes migration `0001_base.sql`.
- Migration `0002_editorial.sql` adds the editorial, user and operations tables below.
- Keep `test/contract.test.js` in step: every new model field needs a column.

```sql
-- 0002_editorial.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive emails

-- People who use the admin. No self-registration: owners invite users.
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  name            text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  role            text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'reviewer', 'viewer')),
  password_hash   text NOT NULL,                       -- Argon2id
  totp_secret_enc text,                                -- encrypted with APP_ENCRYPTION_KEY
  totp_enabled    boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended')),
  failed_logins   integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Server-side sessions. The cookie holds a random token; only its SHA-256 is stored.
CREATE TABLE sessions (
  token_hash    text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  mfa_passed    boolean NOT NULL DEFAULT false,
  ip_hash       text,
  user_agent    text CHECK (char_length(user_agent) <= 200)
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Licensing and scheduling fields on sources (Part C5).
ALTER TABLE sources
  ADD COLUMN tier              text CHECK (tier IN ('L1', 'L2', 'L3', 'L4', 'L5')),
  ADD COLUMN license_status    text NOT NULL DEFAULT 'pending_review'
    CHECK (license_status IN ('public_sector', 'wire', 'terms_reviewed', 'permission_granted', 'pending_review', 'blocked')),
  ADD COLUMN terms_url         text,
  ADD COLUMN terms_reviewed_at date,
  ADD COLUMN reviewed_by       uuid REFERENCES users(id),
  ADD COLUMN allow_excerpt     boolean NOT NULL DEFAULT true,
  ADD COLUMN language          text NOT NULL DEFAULT 'en',
  ADD COLUMN poll_every_hours  smallint NOT NULL DEFAULT 24;

-- Editorial state on stories (Part B3).
ALTER TABLE stories
  ADD COLUMN status            text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'in_review', 'scheduled', 'published', 'rejected', 'unpublished', 'expired', 'archived')),
  ADD COLUMN editorial_headline text CHECK (char_length(editorial_headline) <= 160),
  ADD COLUMN editorial_summary  text CHECK (char_length(editorial_summary) <= 280),
  ADD COLUMN summary_source    text CHECK (summary_source IN ('publisher_excerpt', 'ai', 'editor')),
  ADD COLUMN region            text CHECK (region IN ('uae', 'gcc', 'world')),
  ADD COLUMN rank_score        numeric(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN needs_manual      boolean NOT NULL DEFAULT false,
  ADD COLUMN legal_hold        boolean NOT NULL DEFAULT false,
  ADD COLUMN pinned_until      timestamptz,
  ADD COLUMN publish_at        timestamptz,
  ADD COLUMN published_at      timestamptz,
  ADD COLUMN published_by      uuid REFERENCES users(id),
  ADD COLUMN decision_reason   text CHECK (char_length(decision_reason) <= 500),
  ADD COLUMN locked_by         uuid REFERENCES users(id),
  ADD COLUMN locked_at         timestamptz,
  ADD COLUMN version           integer NOT NULL DEFAULT 1;   -- optimistic locking
CREATE INDEX stories_queue ON stories (status, rank_score DESC);
CREATE INDEX stories_published ON stories (published_at DESC) WHERE status = 'published';

-- One row per AI enrichment attempt (Part E6).
CREATE TABLE story_enrichments (
  id              bigserial PRIMARY KEY,
  story_id        text NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
  batch_id        text,
  model           text NOT NULL,
  prompt_version  text NOT NULL,
  status          text NOT NULL CHECK (status IN ('ok', 'refusal', 'max_tokens', 'invalid_output', 'errored', 'expired')),
  output          jsonb,                        -- validated Enrichment object
  input_tokens    integer,
  output_tokens   integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX story_enrichments_story ON story_enrichments (story_id, created_at DESC);

-- AI spend per batch.
CREATE TABLE llm_runs (
  batch_id        text PRIMARY KEY,
  model           text NOT NULL,
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  requests        integer NOT NULL,
  succeeded       integer,
  failed          integer,
  input_tokens    bigint,
  output_tokens   bigint,
  cost_usd_est    numeric(10,4)
);

-- Curated slots: what appears where, in what order, for how long.
CREATE TABLE story_placements (
  placement   text NOT NULL,                    -- 'home.uae', 'home.world', 'home.featured', 'topic:private-credit'
  story_id    text NOT NULL REFERENCES stories(story_id) ON DELETE CASCADE,
  position    smallint NOT NULL DEFAULT 0,
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  created_by  uuid REFERENCES users(id),
  PRIMARY KEY (placement, story_id)
);

-- Every change an editor or the system makes. Append-only.
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid REFERENCES users(id),       -- NULL = system/worker
  action       text NOT NULL,                   -- 'story.publish', 'source.update', 'user.role_change', ...
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  before       jsonb,
  after        jsonb,
  reason       text,
  ip_hash      text
);
CREATE INDEX audit_entity ON audit_log (entity_type, entity_id, at DESC);
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;  -- app role may only INSERT/SELECT

-- Snapshot builds (Part F5).
CREATE TABLE snapshot_builds (
  id            bigserial PRIMARY KEY,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  trigger       text NOT NULL,                  -- 'publish', 'unpublish', 'schedule', 'manual'
  stories       integer,
  error         text
);

-- Requests from publishers or individuals to remove content (Part H5).
CREATE TABLE takedown_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at   timestamptz NOT NULL DEFAULT now(),
  requester     text NOT NULL,
  contact       text NOT NULL,
  source_id     text,
  story_id      text REFERENCES stories(story_id),
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'declined')),
  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES users(id),
  notes         text
);
```

**Database roles (least privilege).** Create three PostgreSQL users:

| Role | Used by | Privileges |
|---|---|---|
| `fundsae_migrator` | CI migration step only | DDL (owns the schema) |
| `fundsae_app` | web + worker | `SELECT, INSERT, UPDATE, DELETE` on app tables; `INSERT, SELECT` only on `audit_log` |
| `fundsae_readonly` | Analytics, Claude Code on staging | `SELECT` only |

### F4. Admin panel design

The admin panel lives at `https://admin.funds.ae` (a separate hostname, so its cookies never mix with the public site). It is server-rendered with htmx: plain HTML forms, with no JavaScript framework to maintain.

| Screen | Purpose | Main actions | Minimum role |
|---|---|---|---|
| **Dashboard** | Today at a glance | Queue size, last run status, failing sources, AI spend this month, published today | viewer |
| **Review queue** | The editor's workbench | Filter by region, topic or source; sort by score; open a story; bulk-reject selected; keyboard shortcuts (J/K move, P publish, R reject) | reviewer |
| **Story editor** | Decide on one story | Edit headline and summary; pick the summary source; set topics and region; set placements and pin; **Publish now**, **Schedule**, **Reject (reason)**, **Unpublish (reason)**; see all sources, AI output and history | editor to publish; reviewer can edit and recommend |
| **Published** | What is live | Unpublish, re-order placements, pin or unpin, correct a summary (logged as a correction) | editor |
| **Sources** | The registry | Health (ok, failing, paused), last item, licence status, enable/disable, reset the circuit breaker, edit fields, "verify now" | admin; licence status: owner/admin |
| **Runs** | Pipeline history | Per-run stats and filter reasons, AI batch status and cost, snapshot builds, re-run a job | admin |
| **Taxonomy** | Topics and keywords | Edit keywords, weights and sections (versioned) | admin |
| **Sponsors and events** | Placements and events | Replaces the GitHub-token admin page over time | editor |
| **Submissions** | Form inbox | Read, mark handled; export CSV (values beginning with `=`, `+`, `-` or `@` are escaped, to prevent spreadsheet formula injection) | admin |
| **Takedowns** | Removal requests | Log, action within 24 h, reply | admin |
| **Users** | Team | Invite, change role, suspend, reset 2FA | owner |
| **Audit log** | Accountability | Search by user, story, action or date | admin |

**Review queue (wireframe)**

```
+--------------------------------------------------------------------------------------+
| funds.ae admin   Queue (57)  Published  Sources  Runs  ...              Aisha (editor)|
+--------------------------------------------------------------------------------------+
| Region [All v]  Topic [All v]  Source [All v]  [ ] Needs manual only     Sort: Score v|
+--------------------------------------------------------------------------------------+
| [ ] 0.82  UAE  Private credit  Falcon Ridge closes $750m second private credit fund   |
|           The National + 2 more  ·  9h ago  ·  AI: importance 4, relevant 0.93        |
| [ ] 0.77  GCC  Sovereign       PIF commits $2bn to ... (paywalled source)             |
|           Arab News  ·  5h ago  ·  AI: importance 5                                    |
| [ ] 0.61  World  VC            Berlin start-up raises $60m Series B ...               |
|           Sifted  ·  14h ago  ·  AI unavailable (needs manual)                        |
+--------------------------------------------------------------------------------------+
| [Reject selected]                                                  Page 1 of 3  >    |
+--------------------------------------------------------------------------------------+
```

**Story editor (wireframe)**

```
+---------------------------------------------+----------------------------------------+
| Headline (as published by source)           | Sources in this story                  |
| [Falcon Ridge closes $750m second private   |  * The National  (lead)  9h  [open]   |
|  credit fund                           ]    |  * Gulf News             8h  [open]   |
|                                             |  * Arabian Business      7h  [open]   |
| Summary source: (o) funds.ae  ( ) excerpt   |                                        |
| [The ADGM-registered manager raised $750m   | AI suggestion (enrich-v1, opus-5)      |
|  for its second fund, backed by regional    |  topic: private-credit (+fundraising)  |
|  pension funds and family offices.     ]    |  region: uae  importance: 4            |
|  212/280 chars  ·  copy check: OK           |  "The ADGM-registered manager..."      |
|                                             |  [Use suggestion] [Regenerate]         |
| Topics [private-credit x] [fundraising x]   |                                        |
| Region (o) UAE ( ) GCC ( ) World            | History                                |
| Placements [x] home.uae  [ ] home.featured  |  05:41 system  candidate -> in_review  |
| Pin until [ none      ]                     |                                        |
|                                             | Source licence: terms_reviewed (L3)    |
| [Publish now] [Schedule...] [Reject...]     |                                        |
+---------------------------------------------+----------------------------------------+
```

### F5. The Publish workflow

**What happens when an editor clicks Publish**

```
Browser (htmx)                 Web process                         Database            Worker
    | POST /admin/stories/:id/publish  (form + CSRF token + version)
    |------------------------->|
    |                          | 1. session valid? role >= editor? 2FA passed?
    |                          | 2. CSRF token valid? Origin = admin.funds.ae?
    |                          | 3. validate form (zod): summary <= 280, topics in list, placements valid
    |                          | 4. BEGIN; SELECT story FOR UPDATE ------------------->|
    |                          | 5. checks (below); on failure ROLLBACK, return errors
    |                          | 6. UPDATE stories SET status='published', ..., version=version+1
    |                          | 7. INSERT story_placements, INSERT audit_log
    |                          | 8. boss.send('snapshot.build', {}, {singletonKey:'snapshot', singletonSeconds:20})
    |                          | 9. COMMIT --------------------------------------------->|
    |<-------------------------| 200 OK: updated row HTML (htmx swaps it in)             |
    |                                                                                    | 10. snapshot.build
    |                                                            SELECT published ------>|
    |                                                            write api/v1/*.json      |
    |                                                            upload to R2, meta last  |
    |                                                            purge CDN URLs           |
    |                                                            snapshot_builds row      |
   (story visible on funds.ae about 30-60 s after the click)
```

The job is queued inside the same database transaction (pg-boss can use your transaction), so it is sent **only if** the publish commits. The `singletonKey` debounces rapid clicks into one rebuild.

**Checks before a story may be published** (`editorial/transitions.js`)

| # | Check | Message to editor if it fails |
|---|---|---|
| 1 | The transition is allowed: from `in_review`, `scheduled`, `unpublished` or `candidate` to `published` | "This story is {status} and can't be published." |
| 2 | `version` in the form equals the database version (someone else may have edited it) | "Someone else changed this story. Reload to see their changes." |
| 3 | Lead source `license_status` is `public_sector`, `wire`, `terms_reviewed` or `permission_granted` (owners can override, with a logged reason) | "Source licence is {status}. Ask an owner to review the terms." |
| 4 | `legal_hold` is false | "This story is on legal hold." |
| 5 | Summary ≤ 280 characters, and not empty unless the summary source is `publisher_excerpt` | "Summary is too long / missing." |
| 6 | Copy check: the longest run of words copied from the excerpt is < 8 (funds.ae summaries only) | "Summary copies 9 consecutive words from the source: '…'. Rewrite it." |
| 7 | Original URL is https and passed the last link check | "The original link looks broken." |
| 8 | At least one topic; region set | "Choose a topic and region." |

**Copy check** (`editorial/copycheck.js`)

```js
// Longest run of consecutive words in `summary` that also appears, in order, in `excerpt`.
// Numbers, money amounts and capitalised names don't count towards the run.
const WORD = /[\p{L}\p{N}$%.,'-]+/gu;
const neutral = (w) => /[\d$%]/.test(w) || /^\p{Lu}/u.test(w);

export function longestCopiedRun(summary, excerpt) {
  const a = (summary.match(WORD) || []).map((w) => w.toLowerCase().replace(/[.,]+$/, ''));
  const b = (excerpt.match(WORD) || []).map((w) => w.toLowerCase().replace(/[.,]+$/, ''));
  const original = summary.match(WORD) || [];
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      let counted = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) {
        if (!neutral(original[i + k])) counted++;
        k++;
      }
      best = Math.max(best, counted);
    }
  }
  return best; // publish is blocked when best >= 8
}
```

**The state machine** (`editorial/transitions.js`: the only place that changes `stories.status`)

```js
const ALLOWED = {
  candidate:   ['in_review', 'published', 'rejected', 'expired'],
  in_review:   ['published', 'scheduled', 'rejected', 'expired'],
  scheduled:   ['published', 'in_review', 'rejected'],
  published:   ['unpublished', 'archived'],
  unpublished: ['published', 'rejected'],
  rejected:    ['in_review'],
  expired:     ['in_review'],
  archived:    ['published']
};
export const canTransition = (from, to) => (ALLOWED[from] || []).includes(to);
// transition(client, { storyId, to, actor, reason, version, changes }) runs the checks in F5,
// updates the row, writes audit_log, and enqueues snapshot.build, all in one transaction.
```

**Unpublish** follows the same path in reverse:
- A reason is required.
- The story leaves every placement.
- The next snapshot removes it within about a minute.
- Unpublished stories stay in the database for audit.

**Scheduled publishing.** A pg-boss job, `stories.publish_scheduled`, runs every minute and publishes `scheduled` stories whose `publish_at` has passed. It uses the same transition function.

**Snapshot builder** (`publisher/snapshot.js`)
1. Load published stories, placements, jobs, events and sponsor slots.
2. Build the **same `api/v1` files the website reads today**, using the existing serializers in `src/contracts/serializers.js`. The website needs no change.
3. Write the files to a temporary folder. Validate every file against the contract (`isEnvelope`, DTO field lists) before uploading.
4. Upload to Cloudflare R2 (S3-compatible API) under `api/v1/`, with `Cache-Control: public, max-age=60, stale-while-revalidate=300`. Upload `meta.json` **last**, so readers never see new versions pointing at files that aren't there yet.
5. Purge the changed URLs through the Cloudflare API.
6. Record the build in `snapshot_builds`.
7. On failure the previous files stay live. The job retries 5 times with backoff, then alerts.

**Topic (category) pages.**
- Add `frontend_demo/topic.html?topic=private-credit`. It reads `api/v1/news/topics/{id}.json`, which is already produced for every topic.
- Link topic labels on the home page to it.
- The snapshot builder writes topic files from **published** stories only.

### F6. Permissions and moderation

**Roles**

| Capability | viewer | reviewer | editor | admin | owner |
|---|:-:|:-:|:-:|:-:|:-:|
| See dashboard, queue, published | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit story drafts, recommend publish/reject | | ✓ | ✓ | ✓ | ✓ |
| Publish, schedule, reject, unpublish, pin | | | ✓ | ✓ | ✓ |
| Manage sponsors, events, placements | | | ✓ | ✓ | ✓ |
| Manage sources (enable, fields) and taxonomy | | | | ✓ | ✓ |
| Set source licence status; override licence check | | | | | ✓ |
| Read submissions; handle takedowns; view audit log | | | | ✓ | ✓ |
| Invite users, change roles, reset 2FA | | | | | ✓ |

**Authentication rules**
- **Accounts:** invite only. The invite link expires in 48 hours.
- **Passwords:** Argon2id, minimum 12 characters, checked against a list of common passwords.
- **Two-factor authentication:** TOTP (authenticator app) is **required** for editor, admin and owner.
- **Lockout:** 5 failed logins lock the account for 15 minutes. Login is also rate-limited per IP.
- **Session cookie:**
  - name `__Host-fundsae_admin`: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`;
  - 12-hour idle timeout and 7-day maximum;
  - rotated at login and when 2FA passes;
  - stored as a hash only.
- **CSRF:** a token on every form (`@fastify/csrf-protection`), plus an Origin check on every `POST`.
- **Every admin request is authorised on the server.** Hiding a button is not security.

**Moderation rules**
- **Locking.** Opening a story in the editor sets `locked_by` for 10 minutes. Others see "Aisha is editing", and optimistic versioning prevents lost updates.
- **Four-eyes option.** Stories flagged `sensitive` need a second editor to confirm before publishing. Use this for legal risk, allegations, or unconfirmed big numbers.
- **Corrections.**
  - Edits to a published story are logged as corrections.
  - Material corrections show "Updated {date}" on the site.
- **Legal hold.** Admins can freeze a story (it can't be published or edited) while a complaint is assessed.
- **Takedowns.** Handled within 24 hours (Part H5). Actioned requests unpublish the story and can block the source.
- **Audit log.** Append-only (the application role can't update or delete it). Kept for at least 2 years.


---

## Part G: Automation, monitoring and error handling

### G1. Scheduling with pg-boss

The worker process owns every schedule. pg-boss stores jobs and cron schedules in PostgreSQL, so they survive restarts, and only one worker runs each scheduled job even if you run two workers.

`backend/src/worker/index.js` (shape; check option names against the pg-boss version you install):

```js
import PgBoss from 'pg-boss';
import { log } from '../lib/logger.js';
import * as jobs from './jobs.js';          // one handler per job name

const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: 'pgboss' });
boss.on('error', (err) => log.error('pgboss.error', { detail: err.message }));
await boss.start();

const TZ = 'Asia/Dubai';
const QUEUES = {
  // name                     cron (GST)       retry  timeout(s)
  'ingest.news':            { cron: '30 5 * * *', retryLimit: 2, expireInSeconds: 900 },
  'ingest.news.light':      { cron: '0 * * * *',  retryLimit: 1, expireInSeconds: 300 },
  'ingest.jobs':            { cron: '35 5 * * *', retryLimit: 2, expireInSeconds: 600 },
  'ai.enrich.submit':       { cron: '40 5 * * *', retryLimit: 3, expireInSeconds: 300 },
  'ai.enrich.collect':      { cron: '*/10 * * * *', retryLimit: 3, expireInSeconds: 300 },
  'rank.recompute':         { cron: '5 * * * *',  retryLimit: 2, expireInSeconds: 300 },
  'stories.publish_scheduled': { cron: '* * * * *', retryLimit: 3, expireInSeconds: 60 },
  'snapshot.build':         { cron: null,         retryLimit: 5, expireInSeconds: 120 },
  'housekeeping':           { cron: '0 2 * * *',  retryLimit: 2, expireInSeconds: 900 }
};

for (const [name, q] of Object.entries(QUEUES)) {
  await boss.createQueue(name, { retryLimit: q.retryLimit, retryBackoff: true, expireInSeconds: q.expireInSeconds });
  if (q.cron) await boss.schedule(name, q.cron, {}, { tz: TZ });
  await boss.work(name, async ([job]) => jobs[name](job));
}

process.on('SIGTERM', async () => { await boss.stop({ graceful: true }); process.exit(0); });
```

Until the worker is live in production, **keep the existing GitHub Actions daily workflow** (`.github/workflows/daily-ingest.yml`) as the scheduler. Turn it off only when the worker has run cleanly on staging for 3 consecutive days.

### G2. Job rules

| Rule | How |
|---|---|
| **Idempotent** | Running a job twice changes nothing the second time. Writes are upserts on natural keys (`canonical_url`, `(source_id, guid)`, `story_id`, `batch_id`) |
| **Isolated** | One failing source, story or AI item never fails the whole job. Record the error against that item and continue |
| **Bounded** | Every job has a timeout (`expireInSeconds`); every HTTP call has a timeout; AI batches expire after 24 h on Anthropic's side |
| **Retried** | pg-boss retries with exponential backoff. Items that still fail are retried on the next scheduled run |
| **Visible** | Every run writes a row to `ingestion_runs` (counts, warnings, errors, duration). The admin **Runs** page reads it |
| **Safe to deploy** | `SIGTERM` stops the worker gracefully. Jobs in flight finish or are retried |

### G3. Monitoring and alerts

| Signal | Where | Alert when | Channel |
|---|---|---|---|
| Web liveness | `GET /health` (process up) | 2 failures in a row (1-minute checks) | Uptime monitor → email + phone push |
| Web readiness | `GET /ready` (database reachable, migrations current) | Failing for 3 minutes | Uptime monitor |
| Unhandled errors | Sentry (web + worker) | New issue, or more than 20 events an hour | Sentry → email/Slack |
| Ingestion run | `ingestion_runs` | Run `crashed` or `all-sources-failed`; no successful run in 26 h | Worker sends webhook |
| Source health | `sources` | More than 20% of enabled sources failing; any tier-1 UAE source paused | Daily digest email |
| AI | `llm_runs` | Batch not ended after 6 h; more than 10% invalid or refused; monthly spend above budget | Webhook |
| Queue | `stories` | `in_review` above 200 (editors can't keep up), or 0 new candidates in 24 h | Daily digest |
| Snapshot | `snapshot_builds` | Build `failed` after retries; last success more than 26 h ago | Webhook (urgent) |
| Public API | Cloudflare analytics | 5xx rate above 1% for 5 minutes | Cloudflare notification |

- **Alert delivery:**
  - Send one webhook to a Slack or Microsoft Teams channel (or Telegram) and email the owner.
  - Put the webhook URL in `ALERT_WEBHOOK_URL`.
  - Every alert names the job, the error and the runbook (G5) to follow.

### G4. Logging

- **pino JSON logs.** Every line has `time`, `level`, `msg`, `service` (web/worker), `requestId` or `jobId`.
- **Redaction.** Configure pino `redact` for:
  - `req.headers.authorization` and `req.headers.cookie`;
  - `*.password` and `*.totp`;
  - `*.email` and `*.message` (form contents).
  Never log submission payloads or tokens.
- **Levels.** `info` in production, `debug` locally. Every error path logs at `error` with enough context to act: source id, story id, job name.
- **Shipping.** Forward stdout to Better Stack (or your host's log search). Keep logs for 30 days.
- **Correlation.** The admin request id is stored on audit rows. The job id is stored on `ingestion_runs`.

### G5. Runbooks (keep these in `docs/runbooks.md`)

| Situation | Steps |
|---|---|
| **A source keeps failing** | 1. Admin → Sources → open it; read `last_error`. 2. 404: find the new feed URL (C6), update it, "reset circuit breaker". 3. 403: the publisher blocked you. Disable the source and email them; never bypass. 4. Timeouts: leave it; it retries and pauses itself |
| **Site shows stale news** | 1. Runs page: did the morning run succeed? 2. Snapshot builds: last `ok`? 3. If the build failed, read the error, fix it, press "Rebuild snapshot". 4. Purge the CDN cache for `/api/v1/*` |
| **AI costs jumped** | 1. `llm_runs`: requests per batch; was there a surge of candidates? 2. Check a feed didn't start sending hundreds of items (raise its relevance threshold). 3. The monthly spend limit in the Anthropic Console stops runaway spend |
| **Takedown request received** | Follow H5 within 24 hours |
| **Bad deploy** | 1. Render/host dashboard → roll back to the previous release. 2. If a migration ran, run its `down` only if it is safe (the migration-reviewer notes this). 3. Open an incident note |
| **Suspected account compromise** | 1. Owner suspends the user. 2. Delete all their sessions (`DELETE FROM sessions WHERE user_id = ...`). 3. Review the audit log for their actions since the last known-good login. 4. Rotate secrets if an admin or owner was affected |

---

## Part H: Legal and compliance

> **Not legal advice.** This part lists the questions a UAE-based aggregator must answer, and the engineering controls that support the answers. Confirm each point with a lawyer before launch.

### H1. The rules that apply

| Area | Law or rule (UAE unless noted) | What it means for funds.ae |
|---|---|---|
| Copyright | Federal Decree-Law No. 38 of 2021 on Copyrights and Neighbouring Rights | News articles are protected works. Aggregation must stay at headline + short excerpt + link, with attribution. Never the substance of the article. Honour publishers' terms and removal requests |
| Media activity | Federal Decree-Law No. 55 of 2023 on Media Regulation (UAE Media Council) | Publishing news online can be a licensed media activity. **Ask your lawyer whether funds.ae needs a Media Council licence**, and how its content standards apply (accuracy, advertising rules) |
| Accuracy and false information | Federal Decree-Law No. 34 of 2021 on Combatting Rumours and Cybercrimes | Summaries must not add or distort facts. Keep the "no new facts" rule (D6), a corrections process (F6), and fast takedown |
| Personal data | Federal Decree-Law No. 45 of 2021 on Personal Data Protection. If your company is in the DIFC: DIFC Data Protection Law No. 5 of 2020. In ADGM: Data Protection Regulations 2021. EU/UK visitors: GDPR / UK GDPR | Applies to form submissions, newsletter emails, admin users and analytics cookies. Privacy notice, lawful basis, retention limits, processor contracts, data-subject requests |
| Financial promotions | SCA rules (onshore), DFSA (DIFC), FSRA (ADGM) | Sponsored content that promotes funds or investments can be a regulated financial promotion. Accept it only from appropriately licensed firms, label it "Sponsored", add risk wording, and avoid "investment advice" in your own copy |
| Advertising disclosure | UAE Media Council advertising standards | Label every paid placement clearly. The site already marks sponsored links with `rel="sponsored"` |
| Feed terms | Each publisher's terms of use | See C1 tiers. Record the decision per source |

### H2. What to store and show, and what never to

| ✅ Allowed | ❌ Never |
|---|---|
| Headline as published | Full article text, even "temporarily" (`content:encoded` is discarded in memory) |
| Link to the original article | Scraping article pages; bypassing paywalls; using cached or archived copies |
| Publisher name, author (if in the feed), publication date | Copying publisher images to your servers. Hot-link feed images only where `allowImages` is true |
| Publisher-supplied feed excerpt, ≤ 280 characters, attributed | Rewriting ("spinning") whole articles, or AI summaries generated from full text |
| funds.ae's own 1-2 sentence summary written from headline + excerpt (D6) | Removing or obscuring attribution; framing publisher pages inside funds.ae |
| Structured facts: company names, amounts, deal type | Translating full articles |
| Metadata for dedupe (canonical URL, GUID, hashes) | Fake user-agents, proxies or IP rotation to evade blocking |

### H3. Summarisation rules (for editors and the AI prompt)

1. Source material is the headline and feed excerpt only.
2. One or two sentences, **≤ 280 characters**.
3. Own words. The publish check blocks 8 or more consecutive copied words.
4. Only facts present in the source material. No new numbers, names, causes or predictions.
5. Neutral: no adjectives such as "stunning" or "massive", no advice, no opinion.
6. If unsure, use the publisher's excerpt (attributed) instead of a summary.
7. Summaries are labelled "Summary: funds.ae". The About page says summaries may be AI-assisted and are editor-reviewed.

### H4. Attribution system

Every story card on the site, and every item in the API, carries these fields. The API contract (`src/contracts/models.js`) already enforces them.

| Element | Display rule |
|---|---|
| Headline | Links to the **original publisher URL** (`target=_blank`, `rel="noopener noreferrer"`) |
| Source | "Source: {Publisher}" on the card; the lead source is the most authoritative |
| Other outlets | "Also reported by: A, B" with a link to each |
| Date | The publisher's publication date (UAE time) |
| Summary | Label "Summary: funds.ae", or the excerpt in quotation marks with "Excerpt: {Publisher}" |
| Detail pages | None. funds.ae never hosts an article page that could substitute for the original. The click goes to the publisher |

**Optional courtesy:** append `utm_source=funds.ae` to outbound links so publishers can see the traffic you send. Some publishers welcome this; drop it for any that object.

### H5. Takedowns and publisher opt-out

- **Public contact.**
  - A "Content removal" section on the Contact page and a `legal@funds.ae` mailbox.
  - A `/about/bot` page describing `FundsAeNewsBot` and how to opt out.
- **Service level:** acknowledge within 1 business day, act within 24 hours.
- **Process.**
  1. Log the request in `takedown_requests`.
  2. Put the story on `legal_hold` and unpublish it.
  3. Decide:
     - For a **source-level opt-out**, set `license_status = 'blocked'`, disable the source, and unpublish all its stories.
     - If you decline, record the reason (lawyer advice).
  4. Reply to the requester. Close the request.
- **Records** are kept for 2 years.

### H6. Privacy (forms, newsletter, admin, analytics)

- **Privacy policy.** Update `Privacy.dc.html` to say:
  - what each form collects;
  - why (lawful basis);
  - who processes it: hosting, CDN, email provider;
  - that **no personal data is sent to the AI provider** (only public headlines and excerpts are);
  - how long each item is kept (180 days for forms, until unsubscribe for the newsletter);
  - how to request access or deletion;
  - how to contact you.
- **Cookies.** The public site sets no cookies today. If you add analytics, prefer a cookieless tool (Plausible or Cloudflare Web Analytics). Otherwise add a consent banner before any tracking.
- **Newsletter.** Use double opt-in (a confirmation email) and one-click unsubscribe when you add email sending.
- **Data subject requests.** An admin can find and delete a person's submissions by email address (build this in Phase 9).
- **Cross-border transfers.** If you host outside the UAE (for example Render in Frankfurt), ask your lawyer about PDPL transfer requirements. For strict data residency, host the database in a UAE cloud region (AWS me-central-1, Azure UAE North).

### H7. Legal checklist before launch

- [ ] Lawyer reviewed: media licence need, copyright approach, privacy policy, terms of use, sponsored-content rules.
- [ ] Every enabled source has `license_status` recorded, and `pending_review` sources are blocked from publishing.
- [ ] Terms of Use updated: aggregation, links to third parties, no advice, corrections and removal contact.
- [ ] About page: how funds.ae works, AI-assisted summaries, editorial policy, corrections policy.
- [ ] `/about/bot` page live, with the contact address in the user-agent.
- [ ] Takedown process tested end to end on staging.
- [ ] Sponsored placements labelled; the sponsor contract template includes a licensing warranty for financial promotions.

---

## Part I: Deployment to production

### I1. Environments

| Environment | Where | Data | Who deploys |
|---|---|---|---|
| **Local** | Your machine; PostgreSQL in Docker (`docker compose up -d db`) | Demo fixtures | You / Claude Code |
| **Staging** | Same host as production, separate services and database; `staging.funds.ae` and `admin-staging.funds.ae`, protected by Cloudflare Access and `noindex` | Live feeds, test users | Automatic on merge to `main` |
| **Production** | `funds.ae`, `api.funds.ae` (or `data.funds.ae`), `admin.funds.ae` | Live | CI after a manual approval |

### I2. Recommended hosting setup

**Option A (recommended to start): Render + Cloudflare.**

1. **Render**
   - PostgreSQL 17 instance, in the region nearest your team and readers (Frankfurt or Singapore). Daily backups plus point-in-time recovery on a paid plan.
   - **Web service** `fundsae-web`:
     - start `npm --prefix backend run start:web`
     - health check `/ready`
     - 1 instance to start
   - **Background worker** `fundsae-worker`: start `npm --prefix backend run start:worker`.
   - Environment groups for secrets (Appendix 1). Auto-deploy **off** for production (CI triggers deploys through deploy hooks).
2. **Cloudflare**
   - DNS for `funds.ae`, proxied (orange cloud).
   - **Pages** project for the website (`frontend_demo/`, `js/`, `i18n.js`, `index.html`).
   - **R2** bucket `fundsae-public`, with custom domain `data.funds.ae`, holding the `api/v1/` snapshot. Point the website at it with `window.FUNDSAE_CONFIG = { apiBase: 'https://data.funds.ae/api/v1/' }`, and allow that origin in the page CSP `connect-src`.
   - `api.funds.ae` proxied to the Render web service, for form submissions and filtered API queries.
   - `admin.funds.ae` proxied to the Render web service, and **also behind Cloudflare Access** (Zero Trust). Team members must pass Cloudflare's login before they even reach the app's login.
   - **WAF:**
     - managed rules on;
     - rate-limit rule on `/api/v1/submissions/*` (for example 10 a minute per IP);
     - bot fight mode on the admin hostname.
   - **Turnstile** on all five forms; the server verifies the token before accepting a submission.
   - SSL mode "Full (strict)"; HSTS enabled after launch.

**Option B (UAE data residency):** AWS me-central-1 (UAE):
- RDS PostgreSQL (Multi-AZ);
- ECS Fargate services for web and worker;
- S3 + CloudFront for the snapshot.

It costs more and takes more to operate. Choose it if legal advice requires personal data to stay in the UAE.

### I3. CI/CD with GitHub Actions

`.github/workflows/ci.yml` (every pull request and push):

```yaml
name: CI
on: [pull_request, push]
permissions: { contents: read }
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_PASSWORD: test, POSTGRES_DB: fundsae_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgres://postgres:test@localhost:5432/fundsae_test
    defaults: { run: { working-directory: backend } }
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: npm, cache-dependency-path: backend/package-lock.json }
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm run lint
      - run: npm run validate
      - run: npm run migrate up
      - run: npm test
      - run: npm audit --omit=dev --audit-level=high
```

`.github/workflows/deploy.yml` (on merge to `main`):

```yaml
name: Deploy
on:
  push: { branches: [main] }
permissions: { contents: read }
concurrency: { group: deploy, cancel-in-progress: false }
jobs:
  staging:
    runs-on: ubuntu-latest
    environment: staging
    defaults: { run: { working-directory: backend } }
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm run migrate up
        env: { DATABASE_URL: '${{ secrets.STAGING_MIGRATOR_DATABASE_URL }}' }
      - run: curl -fsS -X POST "$HOOK_WEB" && curl -fsS -X POST "$HOOK_WORKER"
        env: { HOOK_WEB: '${{ secrets.STAGING_DEPLOY_HOOK_WEB }}', HOOK_WORKER: '${{ secrets.STAGING_DEPLOY_HOOK_WORKER }}' }
      - run: node scripts/smoke.mjs https://admin-staging.funds.ae https://staging-api.funds.ae
  production:
    needs: staging
    runs-on: ubuntu-latest
    environment: production        # configure "required reviewers" on this environment in GitHub
    defaults: { run: { working-directory: backend } }
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm run migrate up
        env: { DATABASE_URL: '${{ secrets.PROD_MIGRATOR_DATABASE_URL }}' }
      - run: curl -fsS -X POST "$HOOK_WEB" && curl -fsS -X POST "$HOOK_WORKER"
        env: { HOOK_WEB: '${{ secrets.PROD_DEPLOY_HOOK_WEB }}', HOOK_WORKER: '${{ secrets.PROD_DEPLOY_HOOK_WORKER }}' }
      - run: node scripts/smoke.mjs https://admin.funds.ae https://api.funds.ae
```

**GitHub settings**
- Protect `main`: require the CI check and one approving review, and no force-push.
- Enable Dependabot (npm + GitHub Actions) and CodeQL code scanning.
- Put secrets in GitHub **Environments** (staging, production), never in files.

**Migrations must be backwards-compatible with the running code:**
1. Add columns (nullable or with defaults) and deploy the code that uses them.
2. Only then remove old columns, in a later release.

The migration-reviewer agent (E5) checks this.

### I4. Security checklist

- [ ] **Secrets.** Only in the host's secret store or GitHub Environments. `.env` is git-ignored; `.env.example` documents every variable. Rotate on staff changes.
- [ ] **HTTPS everywhere.** HSTS on; cookies `Secure`.
- [ ] **Headers.** `@fastify/helmet` with a strict CSP on the admin: `default-src 'self'`, no inline scripts; htmx is loaded from `'self'`. The public site's CSP is as documented in `backend/src/server/static.js`.
- [ ] **Authentication.** Invite-only, Argon2id, TOTP for editors and above, lockout, Cloudflare Access in front of the admin.
- [ ] **Authorisation.** Server-side role checks on every admin route; tests cover each role's forbidden actions.
- [ ] **Input.** Validate every request body and query (zod); parameterised SQL only; output escaped by templates.
- [ ] **Forms.** Turnstile, rate limits, honeypot, size limits (already built).
- [ ] **Dependencies.** `npm audit` in CI, Dependabot, lockfile committed, `--ignore-scripts` in CI installs.
- [ ] **Database.** Separate migrator/app/read-only roles; SSL connections; no public network access where the host allows private networking.
- [ ] **Backups.** Daily plus point-in-time recovery. **Test a restore every month** into a scratch database.
- [ ] **Logging.** No secrets or personal data in logs (redaction configured and tested).
- [ ] **Admin audit.** The audit log is append-only.
- [ ] **Incident plan.** Who to call; how to suspend users, rotate secrets, roll back.

### I5. Scaling path

| Stage | Traffic (rough) | Setup | Change when |
|---|---|---|---|
| Launch | Up to about 1M page views a month | 1 web, 1 worker, 1 small PostgreSQL; website and snapshot on the CDN | The CDN serves almost all reads, so the web process mostly handles admin and forms |
| Growth | 1-10M | 2+ web instances (sessions are in the database, so any instance serves any user); larger PostgreSQL; Cloudflare rate limiting replaces in-process limits | CPU above 70% sustained, or p95 admin latency above 500 ms |
| Scale | 10M+, many editors, Stage 3 data products | Read replica for analytics; separate workers per queue; PostgreSQL full-text search or Meilisearch for search; pgvector for semantic dedupe; object storage for exports | Queries slow the admin; ingestion takes longer than 15 minutes |

The code rules that make this painless are already in place:
- no state in memory that must be shared;
- all data access through repositories;
- idempotent jobs;
- a static API contract served from a CDN.

### I6. Go-live checklist

- [ ] All Part J phases done, with their checks passing.
- [ ] Staging has run ingestion plus the review workflow for 7 consecutive days without a critical alert.
- [ ] 100 sources verified in the last 7 days; licence status recorded for every enabled source.
- [ ] Load test: `k6` at 50 requests/second against `api.funds.ae/api/v1/news` for 5 minutes, p95 under 300 ms, no errors.
- [ ] Restore test from backup completed.
- [ ] Monitoring and alerts proven by a deliberate test failure.
- [ ] Legal checklist (H7) complete.
- [ ] DNS TTLs lowered 24 hours before cut-over; rollback plan written down.
- [ ] Launch day: publish the first batch by hand; watch the dashboard; check the site from a UAE mobile network.

---

## Part J: Execution plan, phase by phase

- **Estimates:** part-time, one person with Claude Code: about **5-7 weeks** in total.
- **Human tasks** are things Claude Code can't do for you: accounts, legal decisions, emails to publishers.
- **Every phase follows the E4 loop.** Branch, plan mode, prompt, review, checks, PR.

### Phase 0: Foundations (half a day)

**Goal:** a clean repository, correct Claude Code instructions, and CI running.

**Human tasks**
- Rename `C:\Users\ishan\Downloads\CLAUDE.md`, or move `funds.ae` out of `Downloads`.
- Create a private GitHub repository if you don't have one.
- Turn on branch protection for `main`.
- Enable Dependabot.

**Prompt**
```
Read docs/FUNDS-AE-BUILD-GUIDE.md Parts A, B and E. The working tree has the HTML pages moved from
the repo root into frontend_demo/ and new folders (backend/, api/, admin/, js/, .github/) not yet
committed. Plan: (1) commit the current state in sensible commits, (2) create CLAUDE.md and
.claude/settings.json from Part E3, (3) create .claude/agents/ files and .claude/commands/ files
from Part E5, (4) add .github/workflows/ci.yml from Part I3 but without the postgres service and
migrate step yet (we add those in Phase 2). Do not change application code.
```

**Done when**
- `git status` is clean.
- The CI workflow is green on GitHub.
- `claude` in the repo shows no instructions from the other project.

### Phase 1: Source registry v2 (1-2 days)

**Goal:** the 100 verified sources from Part C are in config with licence fields, broken ones are fixed, and a verification script exists.

**Human tasks**
- For each enabled L3 source, open its terms and record `termsUrl`. You can do this over the next weeks; until then they stay `pending_review`.

**Prompt**
```
Implement Phase 1 of docs/FUNDS-AE-BUILD-GUIDE.md.
1. Add backend/scripts/check-sources.mjs from Appendix 3 (checks one URL, or every enabled
   source in the config with --config; prints status, format, item count, newest date; exits 1
   if any enabled source fails or its newest item is older than 14 days).
2. Extend source config validation in backend/src/config.js for the Part C5 fields (tier,
   licenseStatus, termsUrl, termsReviewedAt, allowExcerpt, language, pollEveryHours) with clear
   error messages, and apply allowExcerpt/allowImages in the news pipeline.
3. Replace the live "sources" list in backend/config/sources.news.json with the 100 sources in
   Part C3 (categories A-F as rss sources; E/G APIs as disabled entries with notes), using:
   tier L1 for regulators, L2 for wires, L3 otherwise; licenseStatus "public_sector" for L1,
   "wire" for L2, "pending_review" for L3/L4; allowImages false everywhere; region "uae" for
   section C, else "global"; focus "private-markets" for sections A and B, else
   "general-business"; priority 1 for FT, Bloomberg, The National, PE Hub, PEI, SEC; 2 for most;
   3 for broad feeds (Al Jazeera, PR Newswire All news, Business Wire Home).
   Keep demoSources unchanged.
4. Add tests for the new config validation and the excerpt/image behaviour.
Run npm run validate, npm test and npm run check-sources -- --config; show me the output.
```

**Done when**
- `npm run validate` and `npm test` pass.
- `npm run check-sources -- --config` passes, or its failures are explained and those sources disabled.

### Phase 2: PostgreSQL (3-4 days)

**Goal:** data lives in PostgreSQL through the existing repository interface. JSON storage stays available for demo mode and tests.

**Human tasks**
- Install Docker Desktop.

**Prompt**
```
Implement Phase 2 of docs/FUNDS-AE-BUILD-GUIDE.md.
1. Add docker-compose.yml with PostgreSQL 17 (local only) and backend/.env.example DATABASE_URL.
2. Add node-pg-migrate; create migrations/0001_base.sql from backend/schema/schema.sql and
   0002_editorial.sql from Part F3 (users, sessions, source and story columns, story_enrichments,
   llm_runs, story_placements, audit_log, snapshot_builds, takedown_requests). Keep
   schema/schema.sql as the combined reference and update test/contract.test.js if needed.
3. Add src/db/pool.js (pg Pool, statement timeout 10s, SSL when DATABASE_SSL=true).
4. Implement src/repositories/pg/ with the SAME methods as src/repositories/index.js and
   submissions.js, using parameterised SQL only. Select the implementation with
   FUNDSAE_STORE=json|pg (default json so existing tests keep passing).
5. Add scripts/import-json-to-pg.mjs to copy backend/data/*.json into PostgreSQL (idempotent upserts).
6. Add integration tests in test/pg/ that run only when DATABASE_URL is set, and update
   .github/workflows/ci.yml with the postgres service and migrate step from Part I3.
Rules: no SQL outside src/repositories/pg; every query parameterised; transactions for multi-row
writes. Show npm test output with and without DATABASE_URL.
```

**Done when**
- `docker compose up -d db && npm run migrate up && FUNDSAE_STORE=pg npm run ingest` works, and the rows are visible with `psql`.
- All tests pass locally and in CI.
- The migration-reviewer agent reports no issues.

### Phase 3: Worker and scheduler (2 days)

**Goal:** the pg-boss worker runs the schedule in D1, with retries and run records.

**Prompt**
```
Implement Phase 3 of docs/FUNDS-AE-BUILD-GUIDE.md: src/worker/index.js and src/worker/jobs.js
per Part G1/G2 (queues, cron in Asia/Dubai, retries, timeouts, graceful SIGTERM). Jobs call the
existing pipeline functions with the pg repositories. ingest.news.light processes only sources
with priority 1 and region uae. Every job writes ingestion_runs. Add an ALERT_WEBHOOK_URL
notifier (src/lib/alert.js) used for the G3 worker alerts. Add /ready to the web server
(database reachable, migrations current). Tests: job handlers with a fake boss; alert formatting.
```

**Done when**
- The worker starts locally and schedules appear in `pgboss.schedule`.
- A forced failure (a bad feed URL in a test source) is retried, then recorded.
- The alert webhook fires in a test channel.

### Phase 4: AI enrichment and ranking (3 days)

**Goal:** candidates are enriched by Claude in a daily batch, ranked, and queued for review.

**Human tasks**
- Create an Anthropic API key with a monthly spend limit.
- Put it in `.env` as `ANTHROPIC_API_KEY`.

**Prompt**
```
Implement Phase 4 of docs/FUNDS-AE-BUILD-GUIDE.md using the build prompt "classification (AI
enrichment)" in Part E6 and the reference code there (src/ai/enrich.js), plus
src/editorial/ranking.js implementing the Part D7 formula and thresholds, the rank.recompute
job, and the D5 merge rules. Candidates with score >= REVIEW_THRESHOLD (env, default 0.35) move
to in_review through src/editorial/transitions.js. Record llm_runs with token counts and a cost
estimate using per-model prices from config (not hard-coded in logic). Unit tests mock the
Anthropic client; no real API calls in tests.
```

**Done when**
- Tests pass.
- On staging, one morning run enriches at least 95% of candidates.
- `llm_runs` shows cost.
- The queue has 40-80 stories. Tune the threshold if not.

### Phase 5: Admin: authentication and users (3 days)

**Goal:** a secure admin shell with login, 2FA, roles, invites and audit.

**Prompt**
```
Implement Phase 5 of docs/FUNDS-AE-BUILD-GUIDE.md: src/web.js (Fastify with @fastify/helmet,
@fastify/rate-limit, @fastify/cookie, @fastify/formbody, @fastify/csrf-protection, @fastify/view
with Eta), mounting the existing public API/forms (src/server) as a plugin and a new admin plugin
at /admin. Admin auth per Part F6: invite-only users (owner creates invite links, 48h expiry),
Argon2id passwords (min 12 chars), TOTP enrolment and verification (otplib, secret encrypted with
APP_ENCRYPTION_KEY), session table with hashed tokens and the cookie settings in F6, lockout after
5 failures, role checks per the F6 matrix on every route, audit_log for every login, role change
and invite. Pages: login, 2FA, dashboard shell, users. Add scripts/create-owner.mjs to create the
first owner from the command line. Tests: every role cannot reach routes above its level; CSRF
rejected without token; lockout works; session expiry works. Then run /security-review.
```

**Done when**
- `npm test` passes.
- You can create an owner, log in, and enrol 2FA.
- A viewer account gets 403 on the users page.
- `/security-review` has no high-severity findings open.

### Phase 6: Admin: review queue and Publish (4-5 days)

**Goal:** the editor's workflow from Part F4-F5, end to end.

**Prompt**
```
Implement Phase 6 of docs/FUNDS-AE-BUILD-GUIDE.md: the Review queue, Story editor, Published and
Sources pages from Part F4 (server-rendered Eta + htmx), the state machine and publish checks in
src/editorial/transitions.js exactly as Part F5 specifies (including optimistic locking, licence
check, legal hold, copy check via src/editorial/copycheck.js, audit log, and enqueueing
snapshot.build in the same transaction), scheduling (stories.publish_scheduled job), unpublish
with reason, placements and pins, edit locks, and the "Suggest summary" button using
src/ai/suggest.js (Part E6). Keyboard shortcuts J/K/P/R on the queue. Add Playwright end-to-end
tests: login -> open queue -> publish a story -> it appears in the next snapshot; reject requires
a reason; a reviewer cannot publish.
```

**Done when**
- The end-to-end tests pass.
- Publishing a story locally changes the generated `api/v1/news.json` within 60 seconds.
- The compliance-reviewer agent passes.

### Phase 7: Snapshot publisher, CDN and topic pages (2-3 days)

**Goal:** the public site shows **only published** stories, from the CDN, including topic pages.

**Human tasks**
- Create the Cloudflare account and R2 bucket.
- Create an API token scoped to R2 write and cache purge for your zone.

**Prompt**
```
Implement Phase 7 of docs/FUNDS-AE-BUILD-GUIDE.md: src/publisher/snapshot.js per Part F5
(build api/v1 from published stories using src/contracts/serializers.js; validate every file
against the contract; upload to R2 via its S3-compatible API with the cache headers in F5,
meta.json last; purge changed URLs through the Cloudflare API; record snapshot_builds; keep a
local-disk mode for development). Add frontend_demo/topic.html (?topic=<id>) reading
news/topics/<id>.json through js/fundsae-api.js, styled like the other subpages, linked from
topic labels on the home page. Update the contract tests and website slot tests.
```

**Done when**
- Unpublishing a story removes it from the site within about a minute.
- Topic pages load.
- `test/contract.test.js` passes.

### Phase 8: Monitoring and operations (2 days)

**Prompt**
```
Implement Phase 8 of docs/FUNDS-AE-BUILD-GUIDE.md: pino logging with the redaction list in Part
G4 across web and worker; Sentry for both processes (DSN from env, no PII); the dashboard and
Runs pages from Part F4 fed by ingestion_runs, llm_runs and snapshot_builds; the alert rules in
Part G3 (worker-side checks as an hourly "monitor" job); docs/runbooks.md from Part G5.
Tests: redaction removes cookies, authorization, email and message fields.
```

**Done when**
- A deliberately broken feed and a failed snapshot each produce an alert with a runbook link.
- Logs show no personal data.

### Phase 9: Security and legal hardening (2 days)

**Human tasks**
- Lawyer review (H7).
- Record licence decisions for every enabled L3 source.
- Write the About, Privacy and Terms page text (Claude Code can draft it for your lawyer to edit).

**Prompt**
```
Implement Phase 9 of docs/FUNDS-AE-BUILD-GUIDE.md: Cloudflare Turnstile verification on all five
form endpoints (server-side token check, TURNSTILE_SECRET_KEY); data-subject tools (find/delete
submissions by email, owner only, audited); takedown_requests admin page and process from Part
H5; /about/bot page; attribution display rules from Part H4 on the website (Also reported by,
summary label); a draft privacy/terms/about text in docs/legal-drafts/ for lawyer review (do not
publish them). Then run the compliance-reviewer agent and /security-review and fix findings.
```

**Done when**
- Both reviews come back clean.
- The takedown process works end to end on staging.
- The drafts have been handed to your lawyer.

### Phase 10: Staging and production launch (2 days)

**Human tasks**
- Create the Render services and database.
- Set up Cloudflare DNS, Pages and Access.
- Create the GitHub Environments with required reviewers.
- Add the secrets.

**Prompt**
```
Implement Phase 10 of docs/FUNDS-AE-BUILD-GUIDE.md: .github/workflows/deploy.yml from Part I3,
backend/scripts/smoke.mjs (checks /ready, /api/v1/meta, an admin login page, and that the
snapshot meta.json is fresh), a k6 script in backend/test/load/ for the I6 load test, and
docs/deploy.md describing the exact Render and Cloudflare settings in Part I2 for this repo.
Do not run anything against production.
```

**Done when**
- Staging deploys automatically.
- Production deploys only after your approval.
- Every item in the I6 go-live checklist is ticked.

---

## Appendices

### Appendix 1: Environment variables

| Variable | Process | Purpose |
|---|---|---|
| `NODE_ENV` | both | `production` in staging and production |
| `DATABASE_URL` | both | App role connection string (SSL) |
| `DATABASE_SSL` | both | `true` in hosted environments |
| `FUNDSAE_STORE` | both | `pg` (hosted) or `json` (demo/tests) |
| `FUNDSAE_MODE` | both | `live` or `demo` |
| `ANTHROPIC_API_KEY` | worker, web | Claude API (runtime enrichment and the Suggest button) |
| `FUNDSAE_AI_MODEL` | worker, web | Default `claude-opus-5` |
| `REVIEW_THRESHOLD` | worker | Default `0.35` (D7) |
| `APP_ENCRYPTION_KEY` | web | 32-byte key encrypting TOTP secrets |
| `SESSION_SECRET` | web | Cookie signing and CSRF secret |
| `ADMIN_ORIGIN` | web | `https://admin.funds.ae` (Origin checks) |
| `ALLOWED_ORIGINS` | web | Public site origins allowed to call the API |
| `TURNSTILE_SECRET_KEY` | web | Form bot checks |
| `SUBMISSIONS_HASH_SALT` | web | Hashing IPs on submissions |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | worker | Snapshot upload |
| `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN` | worker | CDN purge |
| `PUBLIC_DATA_BASE` | worker | `https://data.funds.ae/api/v1/` (URLs to purge) |
| `ALERT_WEBHOOK_URL` | worker | Slack/Teams/Telegram webhook |
| `SENTRY_DSN` | both | Error tracking |
| `LOG_LEVEL` | both | `info` |
| `TRUST_PROXY`, `HSTS` | web | Behind Cloudflare/Render: `true` |

### Appendix 2: Glossary

| Term | Meaning |
|---|---|
| **Aggregator** | A site that collects headlines and links from many publishers |
| **RSS / Atom / RDF** | Standard XML formats publishers use to list their latest articles |
| **Conditional GET** | Asking a server "only send it if it changed" (ETag, Last-Modified), which saves both sides bandwidth |
| **Canonical URL** | The cleaned, standard form of a link, used to detect duplicates |
| **Story** | One real-world event, grouping one or more articles from different publishers |
| **Snapshot** | The set of `api/v1/*.json` files the website reads, rebuilt on every publish |
| **Idempotent** | Safe to run twice: the second run changes nothing |
| **pg-boss** | A job queue and scheduler that stores its jobs in PostgreSQL |
| **Message Batch** | Sending many Claude requests together, processed asynchronously at a lower price |
| **CSRF** | An attack that tricks a logged-in browser into submitting a form. Blocked with tokens and Origin checks |
| **TOTP** | Time-based one-time passwords from an authenticator app (2FA) |
| **Circuit breaker** | Automatically pausing a failing source instead of retrying forever |
| **CDN** | Servers around the world that cache your files close to readers |

### Appendix 3: Feed verification script

This is the script used to verify the 100 sources in Part C3. Save it as `backend/scripts/check-sources.mjs`.

```js
#!/usr/bin/env node
// Checks that feed URLs answer with a real, current RSS/Atom/RDF feed.
//   node scripts/check-sources.mjs https://www.pehub.com/feed/     one URL
//   node scripts/check-sources.mjs --config                         every enabled live source
// Exit code 1 if any checked source fails or is stale (newest item older than 14 days).
import { readFileSync } from 'node:fs';

const UA = 'FundsAeNewsBot/1.0 (+https://funds.ae/about/bot) source-check';
const STALE_DAYS = 14;

async function check(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' } });
    const text = (await res.text()).slice(0, 500000);
    const head = text.slice(0, 3000).toLowerCase();
    const isFeed = /<rss[\s>]|<feed[\s>]|<rdf:rdf/.test(head);
    const items = (text.match(/<item[\s>]/gi) || []).length + (text.match(/<entry[\s>]/gi) || []).length;
    const raw = (text.match(/<(pubDate|updated|published|dc:date)>([^<]{8,40})</i) || [])[2];
    const newest = raw ? new Date(raw) : null;
    const ageDays = newest && !Number.isNaN(newest.getTime()) ? (Date.now() - newest.getTime()) / 864e5 : null;
    const ok = res.ok && isFeed && items > 0 && (ageDays === null || ageDays <= STALE_DAYS);
    return { url, ok, status: res.status, format: isFeed ? 'feed' : 'not-a-feed', items,
      newest: newest && !Number.isNaN(newest.getTime()) ? newest.toISOString().slice(0, 10) : 'unknown',
      note: res.status === 403 ? 'blocked: ask the publisher for access; do not bypass' : ageDays > STALE_DAYS ? 'stale' : '' };
  } catch (err) {
    return { url, ok: false, status: 0, format: 'error', items: 0, newest: 'unknown', note: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

const args = process.argv.slice(2);
let urls = args.filter((a) => a.startsWith('http'));
if (args.includes('--config')) {
  const cfg = JSON.parse(readFileSync(new URL('../config/sources.news.json', import.meta.url), 'utf8'));
  urls = cfg.sources.filter((s) => s.enabled !== false && s.type === 'rss').map((s) => s.url);
}
let failed = 0;
for (const url of urls) {
  const r = await check(url);
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${String(r.status).padEnd(3)} ${r.format.padEnd(10)} items=${String(r.items).padEnd(4)} newest=${r.newest}  ${r.url}${r.note ? '  (' + r.note + ')' : ''}`);
}
console.log(`\n${urls.length - failed}/${urls.length} passed`);
process.exitCode = failed ? 1 : 0;
```

### Appendix 4: Operating rhythm

| When | Task | Who |
|---|---|---|
| Daily 07:00 GST | Review queue; publish; check the dashboard for red items | Editor |
| Daily | Glance at alerts; act using the runbooks | Owner/admin |
| Weekly | Review filter stats and publish rate; tune the review threshold and taxonomy keywords | Admin |
| Weekly | Read editor corrections to AI output; note patterns in `docs/ai-evals.md` | Admin |
| Monthly | Backup restore test; dependency updates (Dependabot PRs); AI spend review | Admin |
| Quarterly | `npm run check-sources -- --config`; re-check terms of the 10 highest-traffic sources; update Part C of this guide | Admin |
| Yearly | Legal review of sources, privacy policy and sponsored-content practice | Owner + lawyer |

### Appendix 5: Documentation to keep open

- Claude Code: `https://code.claude.com/docs`
- Claude API (Messages, Batches, structured outputs): `https://platform.claude.com/docs`
- Fastify: `https://fastify.dev/docs/latest/`
- pg-boss: `https://github.com/timgit/pg-boss` (docs folder)
- node-pg-migrate: `https://salsita.github.io/node-pg-migrate/`
- PostgreSQL: `https://www.postgresql.org/docs/17/`
- Cloudflare R2, Pages, Access, Turnstile: `https://developers.cloudflare.com/`
- Render: `https://render.com/docs`
- OWASP Cheat Sheet Series (sessions, CSRF, passwords): `https://cheatsheetseries.owasp.org/`
