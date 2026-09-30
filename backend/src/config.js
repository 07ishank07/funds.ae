// Loads and validates everything in backend/config/. Keys that start with "_"
// are documentation for humans and are ignored by the code.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(BACKEND_DIR, '..');
export const CONFIG_DIR = path.join(BACKEND_DIR, 'config');
export const DATA_DIR = process.env.FUNDSAE_DATA_DIR || path.join(BACKEND_DIR, 'data');
export const FIXTURES_DIR = path.join(BACKEND_DIR, 'fixtures');
export const API_DIR = process.env.FUNDSAE_API_DIR || path.join(REPO_ROOT, 'api', 'v1');
export const ASSETS_DIR = path.join(REPO_ROOT, 'assets');

export class ConfigError extends Error {}

function stripDocs(value) {
  if (Array.isArray(value)) return value.map(stripDocs);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!k.startsWith('_')) out[k] = stripDocs(v);
    return out;
  }
  return value;
}

export function readJson(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new ConfigError(`Cannot read ${path.relative(REPO_ROOT, file)}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `${path.relative(REPO_ROOT, file)} is not valid JSON (${err.message}). ` +
      'Check for a missing comma, a trailing comma, or an unclosed quote.'
    );
  }
}

const loadConfig = (name) => stripDocs(readJson(path.join(CONFIG_DIR, name)));

const ID_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

function validateSources(list, kind, { demo }) {
  const errors = [];
  const seen = new Set();
  const newsTypes = ['rss'];
  const jobTypes = ['rss', 'greenhouse', 'lever', 'ashby'];
  list.forEach((s, i) => {
    const where = `${kind} source #${i + 1} (${s.id || 'no id'})`;
    if (!s.id || !ID_RE.test(s.id)) errors.push(`${where}: "id" must be lowercase letters, numbers and dashes.`);
    if (seen.has(s.id)) errors.push(`${where}: duplicate id.`);
    seen.add(s.id);
    if (!s.name) errors.push(`${where}: missing "name".`);
    const types = kind === 'news' ? newsTypes : jobTypes;
    if (!types.includes(s.type)) errors.push(`${where}: "type" must be one of ${types.join(', ')}.`);
    if (s.enabled === false) return;
    if (demo) {
      if (!s.fixture) errors.push(`${where}: demo sources need a "fixture" file.`);
    } else if (s.type === 'rss') {
      if (!/^https:\/\//.test(s.url || '')) errors.push(`${where}: "url" must start with https://`);
    } else if (!s.board || /REPLACE/.test(s.board)) {
      errors.push(`${where}: set "board" to the employer's board token, or set enabled to false.`);
    }
    if (kind === 'news') {
      if (!['uae', 'global'].includes(s.region)) errors.push(`${where}: "region" must be "uae" or "global".`);
      if (!['private-markets', 'general-business'].includes(s.focus)) {
        errors.push(`${where}: "focus" must be "private-markets" or "general-business".`);
      }
    }
    if (s.titlePattern) {
      try { new RegExp(s.titlePattern); } catch { errors.push(`${where}: "titlePattern" is not a valid pattern.`); }
    }
  });
  return errors;
}

function validateTaxonomy(taxonomy) {
  const errors = [];
  if (!taxonomy.categories?.length || !taxonomy.topics?.length) {
    errors.push('taxonomy.json: needs "categories" and "topics".');
    return errors;
  }
  const topicIds = new Set(taxonomy.topics.map((t) => t.id));
  const categoryIds = new Set(taxonomy.categories.map((c) => c.id));
  const seen = new Set();
  (taxonomy.sections || []).forEach((s, i) => {
    const where = `taxonomy.json section #${i + 1} (${s.id || 'no id'})`;
    if (!s.id || !ID_RE.test(s.id)) errors.push(`${where}: "id" must be lowercase letters, numbers and dashes.`);
    if (seen.has(s.id)) errors.push(`${where}: duplicate id.`);
    seen.add(s.id);
    if (!s.label) errors.push(`${where}: missing "label".`);
    if (!Array.isArray(s.topics) || !s.topics.length) errors.push(`${where}: "topics" must list at least one topic id.`);
    for (const t of s.topics || []) if (!topicIds.has(t)) errors.push(`${where}: unknown topic "${t}".`);
    if (s.category && !categoryIds.has(s.category)) errors.push(`${where}: unknown category "${s.category}".`);
  });
  return errors;
}

// Safe defaults so an older settings.json keeps working.
const SETTINGS_DEFAULTS = {
  events: { maxPublished: 50, keepPastDays: 30 },
  employers: { maxPublished: 15 },
  submissions: {
    enabled: true,
    retentionDays: 180,
    demoMaxPerKind: 500,
    maxBodyBytes: 16384,
    writeRatePerMinute: 5,
    writeRatePerHour: 30
  }
};

export function loadSettings() {
  const settings = loadConfig('settings.json');
  for (const [key, defaults] of Object.entries(SETTINGS_DEFAULTS)) settings[key] = { ...defaults, ...(settings[key] || {}) };
  const envMode = process.env.FUNDSAE_MODE;
  if (envMode) settings.mode = envMode;
  if (!['demo', 'live'].includes(settings.mode)) {
    throw new ConfigError('settings.json: "mode" must be "demo" or "live".');
  }
  return settings;
}

export function loadAll() {
  const settings = loadSettings();
  const demo = settings.mode === 'demo';

  const newsCfg = loadConfig('sources.news.json');
  const jobsCfg = loadConfig('sources.jobs.json');
  const taxonomy = loadConfig('taxonomy.json');
  const manualJobs = loadConfig('jobs.manual.json');
  const eventsConfig = loadConfig('events.json');

  const newsSources = (demo ? newsCfg.demoSources : newsCfg.sources) || [];
  const jobSources = (demo ? jobsCfg.demoSources : jobsCfg.sources) || [];

  const errors = [
    ...validateSources(newsSources, 'news', { demo }),
    ...validateSources(jobSources, 'jobs', { demo }),
    ...validateTaxonomy(taxonomy)
  ];
  if (errors.length) throw new ConfigError('Configuration problems:\n  - ' + errors.join('\n  - '));

  return {
    settings,
    demo,
    newsSources: newsSources.filter((s) => s.enabled !== false),
    allNewsSources: newsSources,
    jobSources: jobSources.filter((s) => s.enabled !== false),
    allJobSources: jobSources,
    taxonomy,
    eventsConfig,
    // Listings marked demoOnly are examples and never appear in live mode.
    manualJobs: (manualJobs.jobs || []).filter((j) => demo || !j.demoOnly)
  };
}

export function loadSponsorsConfig() {
  return stripDocs(readJson(path.join(CONFIG_DIR, 'sponsors.json')));
}
