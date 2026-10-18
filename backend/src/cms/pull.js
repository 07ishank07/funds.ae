// `npm run cms:pull`: Sanity -> backend/config/{sponsors,events,content}.json.
//
// All three files are validated with the same rules `npm run publish:content`
// uses, and written only if ALL of them pass. On any problem nothing is written,
// so the site keeps showing the last good content. The GitHub Action then runs
// `npm run publish:content`, which turns the config files into api/v1 JSON.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, readJson } from '../config.js';
import { writeJsonAtomic } from '../store/jsonStore.js';
import { validateSponsors } from '../pipeline/sponsors.js';
import { validateEvents } from '../pipeline/events.js';
import { validateContent } from '../pipeline/content.js';
import { CONTENT_QUERY } from './queries.js';
import { mapSanityContent } from './mapping.js';
import { querySanity, sanityConfigFromEnv } from './sanity.js';

export const GENERATED_NOTE = 'Written by `npm run cms:pull` from Sanity. Edit the content in the Studio (studio/), not here: the next publish overwrites this file. See docs/SANITY-CMS-GUIDE.md.';

const CONTENT_HELP = [
  'Editorial content shown on the website: socialHighlights (home "Top Tweets"), advertiseTiers (Advertise page packages) and pages (About, Privacy, Terms body copy).',
  'Normally written from Sanity by `npm run cms:pull`. While settings.json content.source is "file" you can edit it by hand; `npm run publish:content` validates and publishes it.',
  'An empty list keeps the page\'s built-in content (Advertise packages, page copy) or, in live mode, shows a short "nothing yet" note (Top Tweets).'
];

function readIfExists(file) {
  return existsSync(file) ? readJson(file) : {};
}

/**
 * @param {object} o
 * @param {object} o.settings     loadSettings() result (userAgent)
 * @param {Date}   [o.now]
 * @param {object} [o.env]        defaults to process.env
 * @param {string} [o.configDir]  defaults to backend/config
 * @param {object} [o.http]       extra querySanity options (tests: baseUrl, retries)
 * @returns {Promise<{ ok: true, counts: object } | { ok: false, errors: string[] }>}
 */
export async function pullFromSanity({ settings, now = new Date(), env = process.env, configDir = CONFIG_DIR, http = {} }) {
  const sanity = sanityConfigFromEnv(env);
  const result = await querySanity(sanity, CONTENT_QUERY, { userAgent: settings.userAgent, ...http });
  const mapped = mapSanityContent(result);

  const sponsors = validateSponsors(mapped.sponsors);
  const events = validateEvents(mapped.events, { now, demo: false });
  const content = validateContent(mapped.content, { now });
  const errors = [...mapped.errors, ...sponsors.errors, ...events.errors, ...content.errors];
  if (errors.length) return { ok: false, errors };

  const files = {
    sponsors: path.join(configDir, 'sponsors.json'),
    events: path.join(configDir, 'events.json'),
    content: path.join(configDir, 'content.json')
  };
  const previousEvents = readIfExists(files.events);
  writeJsonAtomic(files.sponsors, { _generated: GENERATED_NOTE, ...mapped.sponsors });
  // demoFixture and its notes stay: demo mode keeps using the fictional events.
  writeJsonAtomic(files.events, {
    _generated: GENERATED_NOTE,
    ...(previousEvents._help ? { _help: previousEvents._help } : {}),
    ...(previousEvents.demoFixture ? { demoFixture: previousEvents.demoFixture } : {}),
    events: mapped.events
  });
  writeJsonAtomic(files.content, { _generated: GENERATED_NOTE, _help: CONTENT_HELP, ...mapped.content });

  return {
    ok: true,
    counts: {
      sponsors: Object.fromEntries(Object.entries(sponsors.slots).map(([k, v]) => [k, v.length])),
      events: events.events.length,
      socialHighlights: content.content.slots.socialHighlights.length,
      advertiseTiers: content.content.slots.advertiseTiers.length,
      pages: Object.keys(content.content.pages)
    }
  };
}

export { CONTENT_HELP };
