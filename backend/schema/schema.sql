-- Funds.ae database schema, PostgreSQL 14+.
--
-- Today the same records live as JSON in backend/data/ (see src/repositories/).
-- This schema mirrors src/contracts/models.js exactly, so moving to PostgreSQL
-- is a straight copy plus a second repository implementation.
-- test/contract.test.js fails if a model field has no column here.
--
-- Naming rule: camelCase field in JSON  ->  snake_case column here
--   (articleId -> article_id, publishedAt -> published_at, ...).
-- Exceptions, where JSON holds one side of a relationship:
--   stories.articleIds    -> articles.story_id (one story, many articles)
--   sources "kind"        -> which config file the source came from (news/jobs)
--   sponsor_items.slot    -> the group name in config/sponsors.json
--   sponsor_items.position-> the item's order within its group
--
-- Every query issued against this schema must be parameterised ($1, $2, ...);
-- never build SQL by concatenating request input.

CREATE TABLE IF NOT EXISTS sources (
    id                    TEXT NOT NULL,                        -- e.g. 'gulf-business'
    kind                  TEXT NOT NULL CHECK (kind IN ('news', 'jobs')),
    name                  TEXT NOT NULL,
    type                  TEXT NOT NULL CHECK (type IN ('rss', 'greenhouse', 'lever', 'ashby')),
    url                   TEXT CHECK (url IS NULL OR url ~* '^https://'),
    board                 TEXT,
    company               TEXT,
    homepage              TEXT,
    region                TEXT CHECK (region IN ('uae', 'global')),
    focus                 TEXT CHECK (focus IN ('private-markets', 'general-business')),
    priority              SMALLINT NOT NULL DEFAULT 5,
    allow_images          BOOLEAN NOT NULL DEFAULT TRUE,
    enabled               BOOLEAN NOT NULL DEFAULT TRUE,
    verified              BOOLEAN,
    require_uae_location  BOOLEAN NOT NULL DEFAULT TRUE,
    relevance_filter      BOOLEAN NOT NULL DEFAULT FALSE,
    title_pattern         TEXT,
    -- health / circuit breaker (feed-state.json)
    status                TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'ok', 'not-modified', 'error', 'not-found', 'paused')),
    etag                  TEXT,
    last_modified         TEXT,
    format                TEXT,
    consecutive_failures  INTEGER NOT NULL DEFAULT 0,
    last_error            TEXT,
    last_fetched_at       TIMESTAMPTZ,
    last_success_at       TIMESTAMPTZ,
    last_failure_at       TIMESTAMPTZ,
    paused_until          TIMESTAMPTZ,
    last_item_count       INTEGER,
    PRIMARY KEY (kind, id)
);

CREATE TABLE IF NOT EXISTS stories (
    story_id            TEXT PRIMARY KEY,                       -- 's_' + hash
    lead_article_id     TEXT,
    headline            TEXT NOT NULL,
    summary             TEXT NOT NULL DEFAULT '',
    image_url           TEXT CHECK (image_url IS NULL OR image_url ~* '^https://'),
    category            TEXT NOT NULL CHECK (category IN ('uae', 'world')),
    topic               TEXT NOT NULL,
    topics              TEXT[] NOT NULL DEFAULT '{}',
    source_ids          TEXT[] NOT NULL DEFAULT '{}',
    first_published_at  TIMESTAMPTZ NOT NULL,
    last_published_at   TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS articles (
    article_id        TEXT PRIMARY KEY,                         -- 'a_' + sha256(canonical_url)
    title             TEXT NOT NULL,
    source_id         TEXT NOT NULL,                            -- sources.id where kind = 'news'
    source_name       TEXT NOT NULL,
    original_url      TEXT NOT NULL CHECK (original_url ~* '^https?://'),  -- always links to the publisher
    canonical_url     TEXT NOT NULL UNIQUE,                     -- used for de-duplication
    guid              TEXT,
    published_at      TIMESTAMPTZ NOT NULL,
    date_estimated    BOOLEAN NOT NULL DEFAULT FALSE,
    category          TEXT NOT NULL CHECK (category IN ('uae', 'world')),
    topic             TEXT NOT NULL,
    topics            TEXT[] NOT NULL DEFAULT '{}',
    topic_scores      JSONB NOT NULL DEFAULT '{}',
    uae_score         INTEGER NOT NULL DEFAULT 0,
    relevance_score   INTEGER NOT NULL DEFAULT 0,
    summary           TEXT NOT NULL DEFAULT '' CHECK (char_length(summary) <= 300), -- excerpt only
    image_url         TEXT CHECK (image_url IS NULL OR image_url ~* '^https://'),   -- only when supplied in the publisher's feed
    is_press_release  BOOLEAN NOT NULL DEFAULT FALSE,
    story_id          TEXT REFERENCES stories(story_id) ON DELETE SET NULL,
    ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE stories
    DROP CONSTRAINT IF EXISTS stories_lead_article_fk,
    ADD CONSTRAINT stories_lead_article_fk FOREIGN KEY (lead_article_id)
        REFERENCES articles(article_id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

-- One item per source GUID, even if the publisher changes the URL.
CREATE UNIQUE INDEX IF NOT EXISTS articles_source_guid ON articles (source_id, guid) WHERE guid IS NOT NULL AND guid <> '';
CREATE INDEX IF NOT EXISTS articles_published ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS articles_story ON articles (story_id);
CREATE INDEX IF NOT EXISTS stories_category_date ON stories (category, first_published_at DESC);
CREATE INDEX IF NOT EXISTS stories_topic ON stories (topic);
CREATE INDEX IF NOT EXISTS stories_topics_gin ON stories USING GIN (topics);

CREATE TABLE IF NOT EXISTS jobs (
    job_id           TEXT PRIMARY KEY,                          -- 'j_' + hash(canonical url)
    employer_id      TEXT NOT NULL,                             -- 'emp_' + hash(normalised company)
    source_id        TEXT NOT NULL,
    source_name      TEXT NOT NULL,
    external_id      TEXT,
    title            TEXT NOT NULL,
    company          TEXT NOT NULL,
    location         TEXT NOT NULL DEFAULT '',
    url              TEXT NOT NULL CHECK (url ~* '^https?://'),
    canonical_url    TEXT,
    department       TEXT NOT NULL DEFAULT '',
    employment_type  TEXT CHECK (employment_type IN ('Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary')),
    featured         BOOLEAN NOT NULL DEFAULT FALSE,
    status           TEXT NOT NULL CHECK (status IN ('open', 'closed', 'expired')),
    posted_at        TIMESTAMPTZ NOT NULL,
    expires_at       TIMESTAMPTZ,
    first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS jobs_open ON jobs (status, featured DESC, posted_at DESC);
CREATE INDEX IF NOT EXISTS jobs_employer ON jobs (employer_id) WHERE status = 'open';

-- Editor-maintained (config/events.json). Status (upcoming/past) is computed
-- from the dates at read time, never stored.
CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
    title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 90),
    event_type  TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 2 AND 40),
    start_date  DATE NOT NULL,
    end_date    DATE,
    city        TEXT NOT NULL CHECK (char_length(city) BETWEEN 2 AND 60),
    venue       TEXT,
    url         TEXT CHECK (url IS NULL OR url ~* '^https://'),
    organiser   TEXT,
    featured    BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT events_dates CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS events_start ON events (start_date);

-- Editor-maintained (config/sponsors.json, usually through admin/).
CREATE TABLE IF NOT EXISTS sponsor_items (
    slot        TEXT NOT NULL CHECK (slot IN ('founding', 'platinum', 'gold', 'sponsoredPosts', 'sponsoredMedia', 'professionalServices', 'careerResources')),
    id          TEXT NOT NULL CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,60}$'),
    position    INTEGER NOT NULL DEFAULT 0,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    title       TEXT,
    blurb       TEXT,
    label       TEXT,
    logo_text   TEXT,
    website     TEXT,                                           -- display text only, never a link
    url         TEXT CHECK (url IS NULL OR url ~* '^https://'),
    image       TEXT CHECK (image IS NULL OR image ~* '^(https://|assets/sponsors/)'),
    color_from  TEXT CHECK (color_from IS NULL OR color_from ~* '^#[0-9a-f]{6}$'),
    color_to    TEXT CHECK (color_to IS NULL OR color_to ~* '^#[0-9a-f]{6}$'),
    PRIMARY KEY (slot, id)
);

-- Editorial content managed in Sanity (studio/), pulled into config/content.json by `npm run cms:pull`.
-- Home "Top Tweets": an editor-written line and a link to the post, never the post's text.
CREATE TABLE IF NOT EXISTS social_highlights (
    id            TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
    position      INTEGER NOT NULL DEFAULT 0,
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    account_name  TEXT NOT NULL CHECK (char_length(account_name) BETWEEN 2 AND 40),
    handle        TEXT NOT NULL CHECK (handle ~ '^[A-Za-z0-9_]{2,16}$'),
    text          TEXT NOT NULL CHECK (char_length(text) BETWEEN 10 AND 140),
    url           TEXT NOT NULL CHECK (url ~* '^https://(www\.)?(x|twitter)\.com/'),
    initials      TEXT NOT NULL CHECK (initials ~ '^[A-Z0-9]{1,3}$'),
    color         TEXT CHECK (color IS NULL OR color ~* '^#[0-9a-f]{6}$')
);

-- Advertise page package cards. id is the tier the enquiry form sends.
CREATE TABLE IF NOT EXISTS advertise_tiers (
    id          TEXT PRIMARY KEY CHECK (id IN ('silver', 'gold', 'platinum', 'exclusive')),
    position    INTEGER NOT NULL DEFAULT 0,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
    badge       TEXT CHECK (badge IS NULL OR char_length(badge) BETWEEN 2 AND 20),
    price       TEXT NOT NULL CHECK (char_length(price) BETWEEN 2 AND 30),
    price_note  TEXT CHECK (price_note IS NULL OR char_length(price_note) BETWEEN 2 AND 40),
    features    TEXT[] NOT NULL CHECK (cardinality(features) BETWEEN 1 AND 8),
    featured    BOOLEAN NOT NULL DEFAULT FALSE
);

-- About, Privacy and Terms body copy: a safe subset of Portable Text (see PageBlock in models.js).
CREATE TABLE IF NOT EXISTS pages (
    slug        TEXT PRIMARY KEY CHECK (slug IN ('about', 'privacy', 'terms')),
    title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 80),
    intro       TEXT CHECK (intro IS NULL OR char_length(intro) <= 400),
    updated_at  DATE,
    blocks      JSONB NOT NULL
);

-- Website form submissions. Personal data: never published, never logged,
-- deleted after settings.submissions.retentionDays (npm run submissions:prune).
CREATE TABLE IF NOT EXISTS submissions (
    id          TEXT PRIMARY KEY CHECK (id ~ '^sub_[a-f0-9]{20}$'),
    kind        TEXT NOT NULL CHECK (kind IN ('contact', 'newsletter', 'advertise', 'event', 'job')),
    status      TEXT NOT NULL CHECK (status IN ('new', 'pending-review', 'approved', 'rejected', 'spam')),
    payload     JSONB NOT NULL,                                 -- validated plain-text fields
    email       TEXT CHECK (email IS NULL OR char_length(email) <= 254),
    ip_hash     TEXT NOT NULL,                                  -- HMAC of the client IP, never the IP itself
    user_agent  TEXT NOT NULL DEFAULT '' CHECK (char_length(user_agent) <= 200),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submissions_kind_date ON submissions (kind, created_at DESC);
-- One newsletter sign-up per address (the API answers repeat sign-ups with 202 and stores nothing).
CREATE UNIQUE INDEX IF NOT EXISTS submissions_newsletter_email ON submissions (lower(email)) WHERE kind = 'newsletter';

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id           BIGSERIAL PRIMARY KEY,
    command      TEXT NOT NULL,
    mode         TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
    status       TEXT NOT NULL,                                 -- ok | partial | all-sources-failed | invalid-content | crashed
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ,
    duration_ms  INTEGER,
    steps        JSONB NOT NULL DEFAULT '{}',
    warnings     JSONB NOT NULL DEFAULT '[]',
    errors       JSONB NOT NULL DEFAULT '[]',
    error        TEXT
);
