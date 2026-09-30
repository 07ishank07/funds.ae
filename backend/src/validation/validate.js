// A small, dependency-free validator for untrusted input (form submissions and
// query strings). Every rule both CHECKS and CLEANS: the value handed to the
// rest of the code is trimmed, Unicode-normalised plain text with control and
// bidi-override characters removed, so nothing downstream has to re-sanitise.
//
// Output is never HTML-escaped here. Text is stored as plain text and escaped
// at the point of output (the website inserts it with textContent only).

import { isSafePublicUrl } from '../lib/http.js';

// C0/C1 controls (except tab/newline, handled per rule), zero-width characters,
// line/paragraph separators and bidi overrides that can disguise text in an inbox.
// Built from code points so this file stays plain ASCII (raw U+2028 would end the line).
const INVISIBLE_RANGES = [
  [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e],
  [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff]
];
const INVISIBLE = new RegExp('[' + INVISIBLE_RANGES.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join('') + ']', 'g');

export function cleanText(value, { multiline = false } = {}) {
  let s = String(value).normalize('NFC').replace(INVISIBLE, '');
  if (multiline) {
    s = s.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  } else {
    s = s.replace(/\s+/g, ' ');
  }
  return s.trim();
}

const EMAIL_RE = /^[^\s@"<>()[\]\\,;:]{1,64}@(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY = 86_400_000;

const isMissing = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/* ---------------------------------- rules ---------------------------------- */
// A rule is (raw, ctx) => { value } | { error }. `required: false` rules turn a
// missing value into null.

function optional(required, fn) {
  return (raw, ctx) => {
    if (isMissing(raw)) return required ? { error: 'This field is required.' } : { value: null };
    return fn(raw, ctx);
  };
}

export const rules = {
  text({ min = 1, max, required = true, multiline = false }) {
    return optional(required, (raw) => {
      if (typeof raw !== 'string') return { error: 'Enter text.' };
      const value = cleanText(raw, { multiline });
      if (value.length < min) return { error: `Enter at least ${min} characters.` };
      if (value.length > max) return { error: `Use ${max} characters or fewer.` };
      return { value };
    });
  },

  email({ required = true } = {}) {
    return optional(required, (raw) => {
      if (typeof raw !== 'string') return { error: 'Enter a valid email address.' };
      const value = cleanText(raw);
      if (value.length > 254 || !EMAIL_RE.test(value)) return { error: 'Enter a valid email address.' };
      return { value };
    });
  },

  httpsUrl({ required = true, max = 500 } = {}) {
    return optional(required, (raw) => {
      if (typeof raw !== 'string') return { error: 'Enter a link that starts with https://' };
      const value = cleanText(raw);
      if (value.length > max) return { error: `Use a link of ${max} characters or fewer.` };
      let u;
      try { u = new URL(value); } catch { return { error: 'Enter a link that starts with https://' }; }
      if (u.protocol !== 'https:' || u.username || u.password) return { error: 'Enter a link that starts with https://' };
      if (!isSafePublicUrl(u.toString())) return { error: 'Enter a public website address.' };
      return { value: u.toString() };
    });
  },

  enumOf(values, { required = true } = {}) {
    return optional(required, (raw) => {
      if (typeof raw !== 'string' || !values.includes(raw.trim())) return { error: 'Choose one of the listed options.' };
      return { value: raw.trim() };
    });
  },

  /** YYYY-MM-DD, a real calendar date, within [today+minDays, today+maxDays] (UTC days). */
  isoDate({ required = true, minDays = -3650, maxDays = 3650 } = {}) {
    return optional(required, (raw, ctx) => {
      const m = typeof raw === 'string' ? DATE_RE.exec(raw.trim()) : null;
      if (!m) return { error: 'Enter a date as YYYY-MM-DD.' };
      const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (new Date(t).toISOString().slice(0, 10) !== raw.trim()) return { error: 'Enter a real date.' };
      const today = Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), ctx.now.getUTCDate());
      if (t < today + minDays * DAY) return { error: 'This date is too far in the past.' };
      if (t > today + maxDays * DAY) return { error: 'This date is too far in the future.' };
      return { value: raw.trim() };
    });
  },

  /** Lowercase letters, numbers and dashes (config ids). */
  id() {
    return optional(true, (raw) => {
      if (typeof raw !== 'string' || !/^[a-z0-9][a-z0-9-]{1,60}$/.test(raw)) {
        return { error: 'Use lowercase letters, numbers and dashes only.' };
      }
      return { value: raw };
    });
  },

  bool() {
    return (raw) => {
      if (raw === undefined || raw === null) return { value: false };
      if (typeof raw !== 'boolean') return { error: 'Use true or false.' };
      return { value: raw };
    };
  },

  /** Bot trap: a field real people never see or fill in. */
  honeypot() {
    const rule = (raw) => ({ value: isMissing(raw) ? null : 'filled' });
    rule.isHoneypot = true;
    return rule;
  }
};

/**
 * Validates a plain object against { fields: { name: rule }, check?(value) }.
 * Unknown keys are rejected so a frontend/backend naming drift fails loudly.
 * @returns {{ ok: boolean, value: object, fields: Record<string,string>, spam: boolean }}
 */
export function validate(schema, input, { now = new Date() } = {}) {
  const fields = {};
  const value = {};
  let spam = false;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, value, fields: { _: 'Send a JSON object.' }, spam };
  }
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(schema.fields, key)) fields[key] = 'Unknown field.';
  }
  for (const [name, rule] of Object.entries(schema.fields)) {
    const out = rule(input[name], { now });
    if (rule.isHoneypot) {
      if (out.value) spam = true;
      continue;
    }
    if (out.error) fields[name] = out.error;
    else value[name] = out.value;
  }
  if (!Object.keys(fields).length && schema.check) Object.assign(fields, schema.check(value) || {});
  return { ok: Object.keys(fields).length === 0, value, fields, spam };
}
