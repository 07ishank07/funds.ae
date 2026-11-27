// Gulf Economy box: IMF figures (src/pipeline/economy.js). No network: the IMF is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEconomy, editionOf, runEconomy, IMF_API, IMF_SOURCE } from '../src/pipeline/economy.js';
import { DTO_FIELDS } from '../src/contracts/models.js';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sample = JSON.parse(readFileSync(path.join(backend, 'fixtures', 'economy', 'imf-weo.json'), 'utf8'));
const settings = JSON.parse(readFileSync(path.join(backend, 'config', 'settings.json'), 'utf8'));
const COUNTRIES = ['ARE', 'SAU', 'QAT', 'KWT', 'OMN', 'BHR', 'EGY', 'MAR'];
const now = new Date('2026-11-28T08:00:00Z');
const clone = (x) => JSON.parse(JSON.stringify(x));

/** An IMF stand-in that answers like the DataMapper API from the sample. */
function stubImf(imf = sample) {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url === IMF_API + 'indicators') return { indicators: imf.indicators };
    const id = url.slice(IMF_API.length);
    return { values: { [id]: imf.values[id] } };
  };
  return { fetchJson, calls };
}

test('settings list the Gulf and MENA countries the box shows', () => {
  assert.deepEqual(settings.economy.countries, COUNTRIES);
  assert.equal(settings.economy.live, true);
});

test('buildEconomy: the configured countries in order, this year, exactly the contract fields', () => {
  const r = buildEconomy(sample, { countries: COUNTRIES, now });
  assert.ok(r.ok);
  assert.equal(r.economy.year, 2026);
  assert.deepEqual(r.economy.source, { ...IMF_SOURCE, dataset: 'World Economic Outlook (October 2026)' });
  assert.deepEqual(r.economy.items.map((i) => i.id), COUNTRIES);
  for (const item of r.economy.items) assert.deepEqual(Object.keys(item).sort(), [...DTO_FIELDS.economyItem].sort());
  assert.deepEqual(r.economy.items[0], { id: 'ARE', country: 'UAE', code: 'AE', gdpGrowth: -3.9, inflation: 4.5, year: 2026 });
  assert.equal(r.economy.items.find((i) => i.id === 'EGY').inflation, 13.3);
});

test('buildEconomy: rounds to one decimal and falls back to the latest earlier year', () => {
  const imf = clone(sample);
  imf.values.NGDP_RPCH.OMN['2026'] = 4.0749;
  delete imf.values.PCPIPCH.MAR['2026'];
  const r = buildEconomy(imf, { countries: COUNTRIES, now });
  assert.ok(r.ok);
  assert.equal(r.economy.items.find((i) => i.id === 'OMN').gdpGrowth, 4.1);
  const mar = r.economy.items.find((i) => i.id === 'MAR');
  assert.equal(mar.year, 2025);
  assert.equal(mar.gdpGrowth, 4.9);
  assert.equal(r.economy.year, 2026);
});

test('buildEconomy: skips broken countries and refuses when fewer than four are left', () => {
  const imf = clone(sample);
  imf.values.NGDP_RPCH.QAT['2026'] = 999;
  imf.values.PCPIPCH.KWT['2026'] = 'n/a';
  const r = buildEconomy(imf, { countries: COUNTRIES, now });
  assert.ok(r.ok);
  assert.ok(!r.economy.items.some((i) => i.id === 'QAT'));
  assert.equal(r.economy.items.find((i) => i.id === 'KWT').year, 2025);

  const empty = buildEconomy({ values: {} }, { countries: COUNTRIES, now });
  assert.equal(empty.ok, false);
  assert.match(empty.errors.at(-1), /only 0 countries/);
  assert.equal(buildEconomy(sample, { countries: ['ARE', 'SAU', 'QAT'], now }).ok, false);
});

test('editionOf: only a well-formed WEO edition is shown, else the plain dataset name', () => {
  assert.equal(editionOf(sample.indicators), 'World Economic Outlook (October 2026)');
  assert.equal(editionOf({ NGDP_RPCH: { source: '<b>Click here</b>' } }), 'World Economic Outlook');
  assert.equal(editionOf(undefined), 'World Economic Outlook');
});

test('runEconomy: live reads the IMF (two indicators and the edition)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fundsae-econ-'));
  try {
    const { fetchJson, calls } = stubImf();
    const r = await runEconomy({ settings: { ...settings, economy: { live: true, countries: COUNTRIES } }, now }, { fetchJson, apiDir: dir });
    assert.ok(r.ok);
    assert.equal(r.from, 'imf');
    assert.deepEqual(calls, [IMF_API + 'NGDP_RPCH', IMF_API + 'PCPIPCH', IMF_API + 'indicators']);
    assert.ok(calls.every((u) => u.startsWith('https://www.imf.org/')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runEconomy: when the IMF fails, the published file is kept; on a first run the sample is used', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fundsae-econ-'));
  try {
    const ctx = { settings: { ...settings, economy: { live: true, countries: COUNTRIES } }, now };
    const failing = async () => { throw new Error('HTTP 503'); };
    const first = await runEconomy(ctx, { fetchJson: failing, apiDir: dir });
    assert.ok(first.ok);
    assert.equal(first.from, 'sample');

    writeFileSync(path.join(dir, 'economy.json'), '{}');
    const kept = await runEconomy(ctx, { fetchJson: failing, apiDir: dir });
    assert.deepEqual(kept, { ok: false, kept: true, errors: [] });

    const broken = await runEconomy(ctx, { fetchJson: async () => ({ values: {} }), apiDir: dir });
    assert.equal(broken.kept, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runEconomy: live false never fetches', async () => {
  const r = await runEconomy({ settings: { ...settings, economy: { live: false, countries: COUNTRIES } }, now }, {
    fetchJson: async () => { throw new Error('must not fetch'); }
  });
  assert.ok(r.ok);
  assert.equal(r.from, 'sample');
});
