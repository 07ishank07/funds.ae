// POST /api/v1/submissions/:kind  (contact | newsletter | advertise | event | job)
//
// Order of checks: kind exists -> forms enabled -> origin -> rate limit ->
// content type -> body size -> JSON -> field validation -> store.
// Responses never echo the submitted data and are identical for new and
// repeat newsletter sign-ups, so the API cannot be used to test whether an
// address is subscribed.

import { SUBMISSION_SCHEMAS, INITIAL_STATUS } from '../../validation/submissions.js';
import { validate } from '../../validation/validate.js';
import { SubmissionCapacityError } from '../../repositories/submissions.js';
import { log } from '../../lib/logger.js';
import { HttpProblem, clientIp, readJsonBody, sendJson, writeCors, writeOriginAllowed } from '../http.js';

export async function handleSubmission(req, res, app, kind) {
  const schema = Object.hasOwn(SUBMISSION_SCHEMAS, kind) ? SUBMISSION_SCHEMAS[kind] : null;
  if (!schema) throw new HttpProblem(404, 'Not found.');
  if (!app.submissionsEnabled || !app.submissions) {
    throw new HttpProblem(503, 'This server is not accepting forms.', { code: 'submissions_disabled' });
  }
  if (!writeOriginAllowed(req, app)) throw new HttpProblem(403, 'Forms can only be sent from the Funds.ae website.');

  const ip = clientIp(req, app.trustProxy);
  const limit = app.writeLimiter.take(ip);
  if (!limit.ok) {
    throw new HttpProblem(429, 'Too many forms sent. Please try again later.', { headers: { 'Retry-After': String(limit.retryAfterSec) } });
  }

  const body = await readJsonBody(req, { maxBytes: app.maxBodyBytes });
  const result = validate(schema, body, { now: app.now() });

  const accepted = () => sendJson(req, res, app, 202, { ok: true, status: 'received', mode: app.mode }, { cache: 'no-store', cors: writeCors(req, app) });

  // A filled honeypot means a bot: pretend success and keep nothing.
  if (result.spam) {
    log.info('submission.honeypot', { kind });
    return accepted();
  }
  if (!result.ok) {
    throw new HttpProblem(400, 'Some fields need attention.', { code: 'validation_failed', fields: result.fields });
  }

  try {
    const stored = await app.submissions.add({
      kind,
      status: INITIAL_STATUS[kind],
      payload: result.value,
      ip,
      userAgent: req.headers['user-agent'],
      now: app.now()
    });
    // Log the id and kind only: never names, emails or messages.
    log.info(stored.duplicate ? 'submission.duplicate' : 'submission.received', { kind, id: stored.id || undefined });
  } catch (err) {
    if (err instanceof SubmissionCapacityError) {
      log.warn('submission.capacity', { kind });
      throw new HttpProblem(503, 'Forms are temporarily unavailable. Please try again later.');
    }
    throw err;
  }
  return accepted();
}
