// Field rules shared by every Studio schema. Plain data with no imports, so the
// backend test suite (backend/test/cms.test.js) can load this file and prove it
// matches the rules the backend enforces before anything is published:
//   SPONSOR_SLOTS      == SLOT_RULES       in backend/src/pipeline/sponsors.js
//   EVENT_LIMITS       == EVENT_SCHEMA     in backend/src/pipeline/events.js
//   HIGHLIGHT/TIER/PAGE == CONTENT_LIMITS  in backend/src/pipeline/content.js
// Change a limit in both places, or the backend tests fail.

/** One entry per sponsor area on the website, in the order the Studio lists them. */
export const SPONSOR_SLOTS = {
  founding: {
    label: 'Elite Founding Sponsor',
    where: 'The banner under the masthead on every page except Careers. Leave it empty to show the "Your firm here" advert.',
    maxItems: 1, sponsored: true, text: { title: 60, blurb: 140 }, required: ['title'], images: ['image'], colors: []
  },
  platinum: {
    label: 'Gold Partners',
    where: 'Home page, third column: 5 large picture tiles. Add an image; dummy pictures show until you do.',
    maxItems: 5, sponsored: true, text: { title: 60 }, required: ['title'], images: ['image'], colors: ['colorFrom', 'colorTo']
  },
  gold: {
    label: 'Gold Sponsors (not shown)',
    where: 'Not shown on the website: the home page Gold Sponsors box was removed.',
    maxItems: 10, sponsored: true, text: { title: 70, label: 20 }, required: ['title'], images: ['image'], colors: ['colorFrom', 'colorTo']
  },
  sponsoredPosts: {
    label: 'Sponsored Posts',
    where: 'Home page, "Sponsored Posts" box.',
    maxItems: 20, sponsored: true, text: { title: 90, blurb: 160, logoText: 4 }, required: ['title'], images: ['image'], colors: ['colorFrom', 'colorTo']
  },
  sponsoredMedia: {
    label: 'Videos and Podcasts',
    where: 'Home page, "Videos and Podcasts" box.',
    maxItems: 15, sponsored: true, text: { label: 20, title: 90, blurb: 160 }, required: ['title'], images: ['image'], colors: []
  },
  professionalServices: {
    label: 'Featured Partners',
    where: 'Home page "Featured Partners" and the scrolling strip at the foot of the Careers page.',
    maxItems: 20, sponsored: true, text: { title: 70, website: 80, logoText: 4 }, required: ['title'], images: ['image'], colors: ['colorFrom', 'colorTo']
  },
  eliteExclusive: {
    label: 'Exclusive Elite Sponsor (Careers and Events)',
    where: 'The sponsor box at the top of the right column on the Careers and Events pages. Name, one line, a 16:9 image, the button text (Label, e.g. "See open roles") and its link. Leave it empty to show the "Space available" advert.',
    maxItems: 1, sponsored: true, text: { title: 60, blurb: 140, label: 24 }, required: ['title'], images: ['image'], colors: []
  },
  careerResources: {
    label: 'Career Resources (editorial)',
    where: 'Home and Careers "Career Resources". Editorial links, not paid placements.',
    maxItems: 12, sponsored: false, text: { title: 70, logoText: 5 }, required: ['title'], images: [], colors: ['colorFrom', 'colorTo'],
    // The kind of resource shown as a label (equals CAREER_RESOURCE_TYPES in jobRules.js).
    kinds: ['Article', 'Guide', 'Career tip', 'External link']
  }
};

/** Events: same bounds as the backend's EVENT_SCHEMA (lengths are [min, max]). */
export const EVENT_LIMITS = {
  title: [3, 90],
  eventType: [2, 40],
  city: [2, 60],
  venue: [2, 120],
  organiser: [2, 120],
  startDateDays: [-3650, 1100],
  endDateDays: [-3650, 1130]
};

/** Top Tweets box on the home page. */
export const HIGHLIGHT_LIMITS = { maxItems: 5, accountName: [2, 40], handle: [2, 16], text: [10, 140], initials: [1, 3] };

/** Advertise page packages. Package ids are editor-defined (ID_PATTERN); the defaults are ADVERTISING_TIERS in
 *  backend/src/contracts/models.js. Placement types and labels equal ADVERTISE_PLACEMENTS / ADVERTISE_PLACEMENT_LABELS. */
export const TIER_LIMITS = { maxItems: 4, name: [2, 40], badge: [2, 20], price: [2, 30], priceNote: [2, 40], duration: [2, 40], features: 8, feature: [2, 120], ctaLabel: [2, 30], placementDetail: [2, 120] };
export const PLACEMENT_TYPES = ['sponsoredPosts', 'videos', 'events', 'influencers', 'tweets'];
export const PLACEMENT_LABELS = {
  sponsoredPosts: 'Sponsored Posts',
  videos: 'Videos and Podcasts',
  events: 'Events and Expos',
  influencers: 'Thought Leaders and Influencers',
  tweets: 'Top Tweets (X posts)'
};

/** About, Privacy and Terms page copy. */
export const PAGE_SLUGS = ['about', 'privacy', 'terms'];
export const PAGE_LIMITS = { title: [2, 80], intro: [0, 400], blocks: 120, blockText: 2000 };

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}$/;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const IMAGE_MAX_BYTES = 500 * 1024;
