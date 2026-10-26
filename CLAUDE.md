# funds.ae: instructions for Claude Code

## What this is
funds.ae aggregates UAE and global private-capital news (PE, VC, private credit, hedge funds,
institutional investors), jobs and events. Stories are ingested automatically into the News Review
Queue in Sanity, classified (Capital Type, Asset Class), and published ONLY after an approver
publishes them there (docs/NEWS-REVIEW-GUIDE.md). Build guide: docs/FUNDS-AE-BUILD-GUIDE.md
(its Part J phases; the news parts of Phases 2, 5 and 6 are replaced by the Sanity queue).

## Stack
Target: Node.js 24 (ES modules, JavaScript + JSDoc), Fastify 5, PostgreSQL 17 (pg +
node-pg-migrate), pg-boss (jobs/cron), @anthropic-ai/sdk + zod, pino, node:test. Website: static
HTML in frontend_demo/ + js/fundsae-*.js reading /api/v1 JSON.
Today (before Phase 2): storage is JSON files behind backend/src/repositories/, the optional
server in backend/src/server/ uses Node's http module, and GitHub Actions runs the ingest. The news
queue lives in Sanity when settings news.review.store is "sanity" (live) and in backend/data when it
is "file" (demo mode and tests).
Items marked "(Phase N)" below do not exist yet.

## Commands (run from backend/)
- npm test                 all tests (must pass before any commit)
- npm run validate         check config files
- npm run ingest           one ingestion run (demo mode by default)
- npm run serve            optional server: pages + API + forms on http://localhost:8080
- npm run publish:content  validate + publish sponsors, events and content.json
- npm run cms:pull         copy published Sanity content into config/ (needs content.source "sanity" + SANITY_* env)
- npm run cms:seed         build studio/seed/fundsae-seed.ndjson from today's content (for sanity dataset import)
- (from studio/) npm run dev | build | deploy | schema:validate   Sanity Studio (docs/SANITY-CMS-GUIDE.md)
- npm run migrate up       apply database migrations, local/staging only (Phase 2)
- npm run dev:web / dev:worker   run web and worker processes locally (Phases 3 and 5)

## Architecture rules
- Data access ONLY through src/repositories/. No SQL anywhere else.
- Every SQL query is parameterised ($1, $2). Never build SQL with string concatenation.
- Record -> API mapping ONLY in src/contracts/serializers.js. The API contract is
  src/contracts/models.js; changing a field means updating models, schema (migration),
  serializers, js/ scripts and tests together (test/contract.test.js enforces this).
- Web process (src/server, src/admin) never runs ingestion; worker (src/worker, Phase 3) does.
- Story status changes happen ONLY through the Studio's workflow actions. Their logic and rules are
  studio/schemaTypes/newsWorkflow.js and newsRules.js, mirrored in backend/src/news/ (test/cms.test.js
  proves they match). The importer may only create pending_review stories and patch ingest-owned
  fields; nothing automated ever changes a status. Only the news publisher writes api/v1/news*, and only
  stories that are published, due, approved by an id in settings news.review.approverIds, unchanged
  since approval (content hash) and from a source whose licence is cleared.
- Sanity (studio/) holds hand-written content (sponsors, events, Top Tweets, Advertise packages,
  About/Privacy/Terms copy) and the news review queue (stories under private `queue.*` ids, news
  sources, Capital Types, Asset Classes). Never jobs. The dataset is public (Free plan): any document
  without a dot in its id is readable by anyone. Sanity data enters ONLY through src/cms/mapping.js and
  is validated by the existing pipeline validators before any file is written. Studio limits live in
  studio/schemaTypes/rules.js and must equal the backend's (test/cms.test.js enforces this).
- Website scripts insert data with textContent only; pages expose data-fundsae-slot hooks and
  forms use data-fundsae-form with field names equal to the API's.

## Legal rules (never break these)
- Never fetch or store full article text. Store headline, link, publisher excerpt <= 280 chars,
  metadata, and our own summary only. Discard content:encoded after extracting an excerpt.
- Never download publisher images; hot-link only when source.allowImages is true.
- Every published item shows source name + link to the original.
- Publish only from sources whose licenseStatus is public_sector, wire, terms_reviewed or
  permission_granted (PUBLISHABLE_LICENSE_STATUSES); the Studio and the publisher both refuse others.
- AI summaries are written from headline + excerpt only, <= 280 chars, and are editor-approved.
- Never bypass bot blocking (no fake user-agents, no proxies).

## Security rules
- Secrets only from environment variables; never commit .env; never log secrets or personal data.
- The Sanity write token (SANITY_WRITE_TOKEN) is used only by the news importer; everything else,
  including the news publisher, uses the read-only token.
- Admin routes require login + role check + CSRF token; 2FA required for editor and above.
- Validate every input (zod or src/validation). Escape all output (templates auto-escape; the
  website uses textContent only).

## Working agreement
- Start each task in plan mode; wait for approval.
- Write or update tests with every change; run npm test and show the result.
- Small commits with conventional messages (feat:, fix:, chore:, docs:, test:, ci:).
- Never run migrations, deploys or destructive commands against production.
- If a requirement is unclear, ask instead of guessing.
