// Gulf Economy box on the home page: real GDP growth and inflation for the Gulf and MENA countries in
// settings.economy.countries, from the IMF World Economic Outlook (DataMapper API, no key needed).
//
// IMF terms (https://www.imf.org/en/about/copyright-and-terms, "The Use of IMF Data"): published data may
// be reused, also commercially, if it appears accurately and credits the IMF as the source with a link to
// the dataset. So figures are shown as published (rounded to one decimal, as the IMF publishes them) and
// the box always names "International Monetary Fund, World Economic Outlook" and links to it.
//
// These are official figures, not news: they do not go through the review queue. If the IMF cannot be
// read, or what it sends fails the checks below, the published economy.json is left as it is. With
// settings.economy.live false (and in the tests) the bundled sample backend/fixtures/economy/imf-weo.json
// is used instead.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { API_DIR } from '../config.js';
import { fetchText } from '../lib/http.js';
import { loadFixture } from '../lib/fixtures.js';
import { log } from '../lib/logger.js';
import { ECONOMY_COUNTRIES } from '../contracts/models.js';
import { toEconomyItemDto } from '../contracts/serializers.js';

export const IMF_API = 'https://www.imf.org/external/datamapper/api/v1/';
export const IMF_SOURCE = {
  name: 'International Monetary Fund',
  dataset: 'World Economic Outlook',
  url: 'https://www.imf.org/external/datamapper/datasets/WEO'
};
// Our field -> IMF indicator id.
export const ECONOMY_INDICATORS = { gdpGrowth: 'NGDP_RPCH', inflation: 'PCPIPCH' };
export const MIN_COUNTRIES = 4;
// Values outside these ranges are treated as a broken response, not news.
const RANGES = { gdpGrowth: [-60, 60], inflation: [-30, 1000] };
const EDITION = /^World Economic Outlook \((January|April|July|October) (\d{4})\)$/;

const round1 = (n) => Math.round(n * 10) / 10;

/** The dataset name with its edition, e.g. "World Economic Outlook (October 2026)", or the plain name. */
export function editionOf(indicators) {
  const named = Object.values(ECONOMY_INDICATORS).map((id) => String(indicators?.[id]?.source || '').trim());
  return named.find((s) => EDITION.test(s)) || IMF_SOURCE.dataset;
}

/**
 * Builds the published figures from the IMF's answers.
 * @param {{ values: object, indicators?: object }} imf  values: { NGDP_RPCH: { ARE: { "2026": 4.8 } } }
 * @param {{ countries: string[], now: Date }} opts
 * @returns {{ ok: true, economy: object } | { ok: false, errors: string[] }}
 */
export function buildEconomy(imf, { countries, now }) {
  const thisYear = now.getUTCFullYear();
  const errors = [];
  const items = [];
  for (const code of countries) {
    const known = ECONOMY_COUNTRIES[code];
    if (!known) { errors.push(`${code}: not a supported country`); continue; }
    const series = Object.fromEntries(Object.entries(ECONOMY_INDICATORS).map(([field, id]) => [field, imf?.values?.[id]?.[code] || {}]));
    // This year when both figures exist, else the latest earlier year that has both.
    const hasBoth = (y) => Object.values(series).every((s) => typeof s[y] === 'number' && Number.isFinite(s[y]));
    let year = thisYear;
    while (year > thisYear - 5 && !hasBoth(year)) year--;
    if (!hasBoth(year)) { errors.push(`${code}: no figures for ${thisYear - 4}-${thisYear}`); continue; }
    const figures = {};
    let bad = false;
    for (const [field, s] of Object.entries(series)) {
      const [lo, hi] = RANGES[field];
      if (s[year] < lo || s[year] > hi) { errors.push(`${code}: ${field} ${s[year]} is out of range`); bad = true; }
      figures[field] = round1(s[year]);
    }
    if (bad) continue;
    items.push(toEconomyItemDto({ id: code, country: known[1], code: known[0], ...figures, year }));
  }
  if (items.length < MIN_COUNTRIES) {
    return { ok: false, errors: [...errors, `only ${items.length} countries have figures (at least ${MIN_COUNTRIES} needed)`] };
  }
  for (const detail of errors) log.warn('economy.country-skipped', { detail });
  const year = Math.max(...items.map((i) => i.year));
  return { ok: true, economy: { source: { ...IMF_SOURCE, dataset: editionOf(imf.indicators) }, year, items } };
}

/** The live IMF answers: one call per indicator plus the indicator list (for the edition). */
async function fetchImf(fetchJson) {
  const values = {};
  for (const id of Object.values(ECONOMY_INDICATORS)) {
    const doc = await fetchJson(IMF_API + id);
    values[id] = doc?.values?.[id] || {};
  }
  let indicators = {};
  try {
    indicators = (await fetchJson(IMF_API + 'indicators'))?.indicators || {};
  } catch (err) {
    log.warn('economy.edition-unavailable', { detail: err?.message || String(err) });
  }
  return { values, indicators };
}

/** fetchText with the site's own user agent, parsed as JSON. */
export function imfFetcher(settings) {
  return async (url) => {
    const res = await fetchText(url, {
      userAgent: settings.userAgent,
      accept: 'application/json',
      timeoutMs: settings.http?.timeoutMs || 20000,
      retries: 2,
      maxResponseBytes: 10_000_000
    });
    return JSON.parse(res.body);
  };
}

/**
 * @param {{ settings: object, now: Date }} ctx
 * @param {{ fetchJson?: (url: string) => Promise<any>, apiDir?: string }} [opts]
 * @returns {Promise<{ ok: true, economy: object, from: 'imf'|'sample' } | { ok: false, kept: boolean, errors: string[] }>}
 */
export async function runEconomy(ctx, opts = {}) {
  const { countries, live } = ctx.settings.economy;
  const apiDir = opts.apiDir || API_DIR;
  if (live) {
    try {
      const imf = await fetchImf(opts.fetchJson || imfFetcher(ctx.settings));
      const built = buildEconomy(imf, { countries, now: ctx.now });
      if (built.ok) return { ...built, from: 'imf' };
      for (const detail of built.errors) log.warn('economy.invalid', { detail });
    } catch (err) {
      log.warn('economy.fetch-failed', { detail: err?.message || String(err) });
    }
    // Keep the last good figures on the site; the sample is only for a first run.
    if (existsSync(path.join(apiDir, 'economy.json'))) {
      log.warn('economy.kept', { detail: 'The IMF figures could not be refreshed; the site keeps its current economy.json.' });
      return { ok: false, kept: true, errors: [] };
    }
  }
  const sample = JSON.parse(loadFixture('economy/imf-weo.json', ctx.now));
  const built = buildEconomy(sample, { countries, now: ctx.now });
  return built.ok ? { ...built, from: 'sample' } : { ok: false, kept: false, errors: built.errors };
}
