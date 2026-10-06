// Every public API document (static file or server response) shares one
// envelope so the website can check it with a single test:
//   { apiVersion: 1, mode: "demo"|"live", generatedAt: ISO, notice: string, ... }
// Lists add { count, items }. Server-paged lists also add { total, limit, offset }.
// Errors are { error: { status, code, message, fields? } } and never carry the envelope.

import { API_VERSION } from './models.js';

export const NOTICES = {
  news: 'Headlines and short publisher-supplied excerpts only. Every item links to the original publisher.',
  jobs: 'Job listings link to the employer or original job board to apply.',
  sponsors: 'Sponsored placements are marked and link with rel="sponsored". Career resources are editorial.',
  events: 'Event details are supplied by organisers. Check with the organiser before you travel.',
  employers: 'Employers are derived from the open roles listed on Funds.ae.',
  general: 'Funds.ae public data API.'
};

export function envelope({ mode, generatedAt, notice = NOTICES.general }, extra = {}) {
  return { apiVersion: API_VERSION, mode, generatedAt, notice, ...extra };
}

export function listEnvelope(base, items, extra = {}) {
  return envelope(base, { ...extra, count: items.length, items });
}

export const ERROR_CODES = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden_origin',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
  500: 'internal',
  503: 'unavailable'
};

export function errorBody(status, message, { code, fields } = {}) {
  const error = { status, code: code || ERROR_CODES[status] || 'error', message };
  if (fields && Object.keys(fields).length) error.fields = fields;
  return { error };
}

/** True when a parsed document has the shared envelope (used by tests and the server). */
export function isEnvelope(doc) {
  return Boolean(doc) && doc.apiVersion === API_VERSION && typeof doc.mode === 'string' && typeof doc.generatedAt === 'string';
}
