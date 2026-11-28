// Field rules shared by every Studio schema. Plain data with no imports, so the
// backend test suite (backend/test/cms.test.js) can load this file and prove it
// matches the rules the backend enforces before anything is published:
//   SPONSOR_SLOTS      == SLOT_RULES       in backend/src/pipeline/sponsors.js
//   EVENT_LIMITS       == EVENT_SCHEMA     in backend/src/pipeline/events.js
//   HIGHLIGHT/TIER/PAGE/HERO == CONTENT_LIMITS  in backend/src/pipeline/content.js
// Change a limit in both places, or the backend tests fail.

/** One entry per sponsor area on the website, in the order the Studio lists them. */
export const SPONSOR_SLOTS = {
  founding: {
    label: 'Elite Founding Sponsor',
    where: 'The banner under the masthead on the News, story, About, Contact, Post a Job and policy pages. Leave it empty to show the "Your firm here" advert.',
    maxItems: 1, sponsored: true, text: { title: 60, blurb: 140 }, required: ['title'], images: ['image'], colors: []
  },
  platinum: {
    label: 'Spotlight (home page)',
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
    label: 'Exclusive Elite Sponsor (not shown on the site)',
    where: 'Not shown on the site at present: the Careers page box was removed. Kept so the data and Sanity documents stay valid if the box returns.',
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

/** Partner with us page packages. Package ids are editor-defined (ID_PATTERN); the defaults are ADVERTISING_TIERS in
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

/** The home page hero banner (equals CONTENT_LIMITS.hero in backend/src/pipeline/content.js). */
// Hero banner styles and the site pages its two buttons may open (not in Classic). Must equal HERO_STYLES and
// HERO_BUTTON_TARGETS in backend/src/contracts/models.js (test/cms.test.js checks).
export const HERO_STYLES = [
  {value: 'photo', title: 'Photo (the photo fills the banner, white text on top)'},
  {value: 'minimal', title: 'Minimal (light, with a wide photo under the text)'},
  {value: 'classic', title: 'Classic (teal, with the picture on the right)'},
]
export const HERO_BUTTON_TARGETS = {
  news: {page: 'RealEstateNews.dc.html', title: 'Real estate news'},
  videos: {page: 'Videos.dc.html', title: 'Videos & Podcasts'},
  events: {page: 'Events.dc.html', title: 'Events and Expos'},
  careers: {page: 'Careers.dc.html', title: 'Careers'},
  partner: {page: 'PartnerWithUs.dc.html', title: 'Partner with us'},
}
export const HERO_LIMITS = { eyebrow: [2, 60], title: [8, 80], highlight: [0, 30], subtitle: [0, 240], imageAlt: [0, 140], buttonLabel: [2, 30], button2Label: [2, 30], imageMaxBytes: 1572864 };

/** Grants & Funding (equals CONTENT_LIMITS.grants and the FUNDING_* lists in the backend; test/cms.test.js checks). */
export const GRANTS_LIMITS = { typeTitle: [2, 40], typeDescription: [2, 80], maxProgrammes: 100, provider: [2, 70], description: [20, 200], types: [1, 3] };
// The twelve type tiles; each id has its own icon on the site, so the list is fixed.
export const FUNDING_TYPES = [
  {value: 'sme-grants', title: 'SME Grants'},
  {value: 'startup', title: 'Startup Funding'},
  {value: 'rd', title: 'Innovation & R&D'},
  {value: 'technology', title: 'Technology & AI'},
  {value: 'green', title: 'Green & Sustainability'},
  {value: 'manufacturing', title: 'Manufacturing & Industry'},
  {value: 'export', title: 'Export & Trade Finance'},
  {value: 'sme-loans', title: 'SME Loans'},
  {value: 'islamic', title: 'Islamic Finance'},
  {value: 'emirati', title: 'Emirati Founders'},
  {value: 'venture', title: 'Venture & Angel Investment'},
  {value: 'free-zone', title: 'Free Zone Support'},
];
export const FUNDING_KINDS = [
  {value: 'grant', title: 'Grant'},
  {value: 'loan', title: 'Loan'},
  {value: 'equity', title: 'Equity'},
  {value: 'trade', title: 'Trade finance'},
];
export const FUNDING_PLACES = [
  {value: 'uae', title: 'UAE-wide'},
  {value: 'abu-dhabi', title: 'Abu Dhabi'},
  {value: 'dubai', title: 'Dubai'},
  {value: 'sharjah', title: 'Sharjah'},
  {value: 'northern', title: 'Northern Emirates'},
];

/** Reusable banners (equal to CONTENT_LIMITS.banners, BANNER_PLACEMENTS and BANNER_TARGETS in the backend). */
export const BANNER_LIMITS = { eyebrow: [2, 40], title: [8, 80], text: [0, 160], buttonLabel: [2, 30], imageAlt: [0, 140], credit: [2, 160], imageMaxBytes: 1572864 };
export const BANNER_PLACEMENTS = [
  {value: 'careers', title: 'Finance Careers banner (home, Careers and Events pages)'},
  {value: 'grants', title: 'Grants & Funding card (home and Careers pages)'},
];
export const BANNER_TARGETS = {
  ...HERO_BUTTON_TARGETS,
  grants: {page: 'GrantsFunding.dc.html', title: 'Grants & Funding'},
};

/** Site settings (equal to CONTENT_LIMITS.settings in the backend). */
export const SETTINGS_LIMITS = { footerTagline: [2, 60] };

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}$/;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const IMAGE_MAX_BYTES = 500 * 1024;
