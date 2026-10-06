# funds.ae: instructions for Claude Code

## What this is
funds.ae aggregates UAE and global private-capital news (PE, VC, private credit, hedge funds,
institutional investors), jobs and events. Stories are ingested automatically, enriched by AI,
and published ONLY after an editor presses Publish. Build guide: docs/FUNDS-AE-BUILD-GUIDE.md
(follow its Part J phases in order).

## Stack
Target: Node.js 24 (ES modules, JavaScript + JSDoc), Fastify 5, PostgreSQL 17 (pg +
node-pg-migrate), pg-boss (jobs/cron), @anthropic-ai/sdk + zod, pino, node:test. Website: static
HTML in frontend_demo/ + js/fundsae-*.js reading /api/v1 JSON.
Today (before Phase 2): storage is JSON files behind backend/src/repositories/, the optional
server in backend/src/server/ uses Node's http module, and GitHub Actions runs the daily ingest.
Items marked "(Phase N)" below do not exist yet.

## Commands (run from backend/)
- npm test                 all tests (must pass before any commit)
- npm run validate         check config files
- npm run ingest           one ingestion run (demo mode by default)
- npm run serve            optional server: pages + API + forms on http://localhost:8080
- npm run migrate up       apply database migrations, local/staging only (Phase 2)
- npm run dev:web / dev:worker   run web and worker processes locally (Phases 3 and 5)

## Architecture rules
- Data access ONLY through src/repositories/. No SQL anywhere else.
- Every SQL query is parameterised ($1, $2). Never build SQL with string concatenation.
- Record -> API mapping ONLY in src/contracts/serializers.js. The API contract is
  src/contracts/models.js; changing a field means updating models, schema (migration),
  serializers, js/ scripts and tests together (test/contract.test.js enforces this).
- Web process (src/server, src/admin) never runs ingestion; worker (src/worker, Phase 3) does.
- Status changes of stories go through src/editorial/transitions.js (Phase 6): state machine +
  audit log.
- Website scripts insert data with textContent only; pages expose data-fundsae-slot hooks and
  forms use data-fundsae-form with field names equal to the API's.

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
- Small commits with conventional messages (feat:, fix:, chore:, docs:, test:, ci:).
- Never run migrations, deploys or destructive commands against production.
- If a requirement is unclear, ask instead of guessing.
