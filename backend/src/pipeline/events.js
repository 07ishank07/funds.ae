// Events pipeline: config/events.json (live) or fixtures/events/demo-events.json
// (demo) -> validate -> keep upcoming and recent -> api/v1/events.json.
//
// Events are editor-maintained. Suggestions sent through the website's
// "Submit your event" form land in the submissions store for review; they are
// never published automatically.
//
// Invalid entries fail the step with a plain-language message and the previous
// api/v1/events.json stays live (same behaviour as sponsors).

import { loadFixture } from '../lib/fixtures.js';
import { rules, validate } from '../validation/validate.js';
import { log } from '../lib/logger.js';

const { id, text, httpsUrl, isoDate, bool } = rules;

// Wide date bounds: editors may keep past events for a while.
const EVENT_SCHEMA = {
  fields: {
    id: id(),
    title: text({ min: 3, max: 90 }),
    eventType: text({ min: 2, max: 40 }),
    startDate: isoDate({ minDays: -3650, maxDays: 1100 }),
    endDate: isoDate({ required: false, minDays: -3650, maxDays: 1130 }),
    city: text({ min: 2, max: 60 }),
    venue: text({ min: 2, max: 120, required: false }),
    url: httpsUrl({ required: false }),
    organiser: text({ min: 2, max: 120, required: false }),
    featured: bool(),
    demoOnly: bool()
  },
  check: (v) => (v.endDate && v.endDate < v.startDate ? { endDate: 'must be on or after startDate' } : null)
};

/** Reads the raw list for the current mode. Demo dates are relative to "now" so the demo never goes stale. */
export function loadEventList(ctx) {
  const cfg = ctx.eventsConfig || {};
  if (ctx.demo) {
    if (!cfg.demoFixture) return [];
    const data = JSON.parse(loadFixture(cfg.demoFixture, ctx.now));
    return Array.isArray(data.events) ? data.events : [];
  }
  return Array.isArray(cfg.events) ? cfg.events : [];
}

export function validateEvents(list, { now, demo }) {
  const errors = [];
  const events = [];
  const seen = new Set();
  list.forEach((raw, i) => {
    const where = `event #${i + 1} (${raw?.id || 'no id'})`;
    // "#" is the documented placeholder for "no link yet".
    const input = raw && typeof raw === 'object' ? { ...raw, url: raw.url === '#' ? null : raw.url } : raw;
    const result = validate(EVENT_SCHEMA, input, { now });
    if (!result.ok) {
      for (const [field, message] of Object.entries(result.fields)) errors.push(`${where}: "${field}" ${message}`);
      return;
    }
    if (seen.has(result.value.id)) errors.push(`${where}: duplicate id.`);
    seen.add(result.value.id);
    // Example events never reach the live site.
    if (!demo && result.value.demoOnly) return;
    const { demoOnly, ...event } = result.value;
    events.push(event);
  });
  return { errors, events };
}

/** Upcoming and ongoing events first (soonest first), plus anything that ended within keepPastDays. */
export function selectPublishableEvents(events, now, { keepPastDays, maxPublished }) {
  const cutoff = new Date(now.getTime() - keepPastDays * 86_400_000).toISOString().slice(0, 10);
  return events
    .filter((e) => (e.endDate || e.startDate) >= cutoff)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
    .slice(0, maxPublished);
}

export function runEvents(ctx) {
  const { errors, events } = validateEvents(loadEventList(ctx), { now: ctx.now, demo: ctx.demo });
  if (errors.length) {
    for (const e of errors) log.error('events.invalid', { detail: e });
    return { ok: false, errors };
  }
  const published = selectPublishableEvents(events, ctx.now, ctx.settings.events);
  log.info('events.ready', { configured: events.length, published: published.length });
  return { ok: true, events: published };
}
