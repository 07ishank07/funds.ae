// Text helpers: turning feed HTML into safe plain text, building short
// excerpts, and the tokenisation used for deduplication and story grouping.

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', bull: '•', middot: '·',
  eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', oacute: 'ó', uacute: 'ú', iacute: 'í', ccedil: 'ç',
  euro: '€', pound: '£', yen: '¥', cent: '¢', copy: '©', reg: '®', trade: '™', times: '×', deg: '°'
};

export function decodeEntities(str) {
  return String(str).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return '';
      if (n < 32 && n !== 9 && n !== 10 && n !== 13) return '';
      return String.fromCodePoint(n);
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Converts feed HTML to plain text. The output never contains markup. */
export function htmlToText(html) {
  if (html === undefined || html === null) return '';
  let s = String(html);
  s = s.replace(/<(script|style|iframe|noscript|svg|figure|figcaption)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|li|h\d)>/gi, ' ');
  s = s.replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/<[^>]*>/g, ' '); // entities may have encoded tags
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200f\u2028\u2029\ufeff]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** Removes feed boilerplate such as "The post X appeared first on Y." */
export function cleanExcerpt(text) {
  return String(text)
    .replace(/\s*The post .{3,200} appeared first on .{2,100}\.?\s*$/i, '')
    .replace(/\s*(Continue reading|Read more|Read the full story)\s*(»|›|→|\.\.\.|…)?\s*$/i, '')
    .replace(/\s*\[(…|\.\.\.)\]\s*$/, '…')
    .trim();
}

export function truncate(text, maxChars) {
  const s = String(text || '').trim();
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–—-]+$/, '') + '…';
}

const STOPWORDS = new Set((
  'a an the and or but if of to in on at by for from with as into onto over under about after before ' +
  'is are was were be been being has have had do does did will would can could should may might must ' +
  'it its this that these those their there his her our your my we you they he she them us i ' +
  'new says said say report reports reported amid while than then also more most less least very just ' +
  'up down out off per via vs not no yes all any each other such only own same so too s t ' +
  'million billion bn mn thousand m b k'
).split(/\s+/));

// Very light stemming, good enough to match "raises/raised/raising".
function stem(word) {
  if (word.length <= 4) return word;
  return word
    .replace(/(ies)$/, 'y')
    .replace(/(ing|ed|es|s)$/, '')
    .replace(/(.)\1$/, '$1');
}

/** Converts money amounts to comparable tokens: "$150 million" and "$150m" both become "usd150m". */
export function extractAmounts(text) {
  const out = new Set();
  const re = /(?:(us\$|\$|usd|aed|dh|dhs|€|eur|£|gbp|sar)\s?)?(\d+(?:[.,]\d+)?)\s?(bn|billion|b|mn|million|m|k|thousand)\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const curRaw = (m[1] || '').toLowerCase();
    const cur = { 'us$': 'usd', $: 'usd', usd: 'usd', aed: 'aed', dh: 'aed', dhs: 'aed', '€': 'eur', eur: 'eur', '£': 'gbp', gbp: 'gbp', sar: 'sar' }[curRaw] || '';
    const num = parseFloat(m[2].replace(',', '.'));
    const unitRaw = m[3].toLowerCase();
    const unit = unitRaw.startsWith('b') ? 'b' : unitRaw.startsWith('k') || unitRaw.startsWith('t') ? 'k' : 'm';
    out.add(`${cur}${num}${unit}`);
  }
  return [...out];
}

export function normaliseTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokens(text) {
  const amounts = extractAmounts(String(text || ''));
  const words = normaliseTitle(text)
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w) && !/^\d/.test(w))
    .map(stem)
    .filter((w) => w.length > 1);
  return new Set([...words, ...amounts]);
}

// Words that are capitalised in headlines but carry no identity.
const GENERIC_CAPS = new Set((
  'fund funds capital partners partner group holding holdings investment investments investor investors ventures venture ' +
  'bank banks global international company companies firm firms market markets private equity credit debt series round ' +
  'raises raise raised closes close closed launches launch backs backed leads led buys buy sells sell agrees deal deals ' +
  'billion million new first final record top chief ceo cfo says report quarter year week month target plans plan ' +
  'sees set sets hits hit lifts lift rise rises falls fall above below growth why how what when who where inside ' +
  'exclusive breaking update analysis here meet ltd plc inc llc pjsc psc co ' +
  'the a an and of in on for with to at by from as its after amid over into'
).split(/\s+/));

// Place names are shared by many unrelated stories, so they are not evidence
// that two headlines describe the same event.
const PLACE_WORDS = new Set((
  'uae dubai abu dhabi sharjah ajman fujairah emirates emirati gulf gcc mena middle east arab arabia saudi riyadh ' +
  'qatar doha kuwait bahrain oman muscat egypt cairo us usa uk london europe european asia asian africa african ' +
  'india china singapore hong kong york america american british region regional world'
).split(/\s+/));

/**
 * Pulls out distinctive names (companies, acronyms) and money amounts from a
 * headline. Used to decide whether two headlines describe the same event.
 */
export function extractEntities(title) {
  const found = new Set(extractAmounts(title));
  const words = String(title || '').replace(/[’']s\b/g, '').split(/[^A-Za-z0-9&]+/).filter(Boolean);
  for (const w of words) {
    const lower = w.toLowerCase();
    if (lower.length < 2 || GENERIC_CAPS.has(lower) || STOPWORDS.has(lower) || PLACE_WORDS.has(lower)) continue;
    const isAcronym = /^[A-Z0-9&]{2,6}$/.test(w) && /[A-Z]/.test(w);
    const isCapitalised = /^[A-Z][a-z]/.test(w);
    if (isAcronym || isCapitalised) found.add(stem(lower));
  }
  return found;
}

/** Entities that are names rather than money amounts. */
export const isAmountToken = (t) => /^[a-z]{0,3}\d/.test(t) && /[mbk]$/.test(t);

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function intersectionSize(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive matcher that also accepts simple plurals. */
export function termRegex(term) {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(term.toLowerCase())}(s|es)?(?=$|[^a-z0-9])`, 'i');
}
