// Demo mode reads sample feeds from backend/fixtures/ instead of the internet.
// Dates inside fixtures are written as tokens relative to "now", e.g.
//   {{RFC822:-2d3h}}  -> RSS date 2 days 3 hours ago
//   {{ISO:-5h}}       -> ISO 8601 date 5 hours ago
//   {{EPOCHMS:-1d}}   -> milliseconds since 1970, 1 day ago
//   {{DATE:+14d}}     -> calendar date (YYYY-MM-DD, UTC) 14 days from now
// so the demo never goes stale.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURES_DIR } from '../config.js';

function offsetMs(spec) {
  const sign = spec.startsWith('-') ? -1 : 1;
  let total = 0;
  for (const [, n, unit] of spec.matchAll(/(\d+)([dhm])/g)) {
    total += Number(n) * { d: 86_400_000, h: 3_600_000, m: 60_000 }[unit];
  }
  return sign * total;
}

export function renderFixture(raw, now = new Date()) {
  return raw.replace(/\{\{(RFC822|ISO|EPOCHMS|DATE):([-+]?[0-9dhm]+)\}\}/g, (_, fmt, spec) => {
    const d = new Date(now.getTime() + offsetMs(spec));
    if (fmt === 'RFC822') return d.toUTCString();
    if (fmt === 'EPOCHMS') return String(d.getTime());
    if (fmt === 'DATE') return d.toISOString().slice(0, 10);
    return d.toISOString();
  });
}

export function loadFixture(relPath, now = new Date()) {
  const file = path.resolve(FIXTURES_DIR, relPath);
  if (!file.startsWith(FIXTURES_DIR + path.sep)) throw new Error(`Fixture path escapes fixtures folder: ${relPath}`);
  return renderFixture(readFileSync(file, 'utf8'), now);
}
