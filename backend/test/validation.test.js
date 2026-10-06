// Input validation for website forms and editor-maintained config (events, sponsors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, validate } from '../src/validation/validate.js';
import { SUBMISSION_SCHEMAS } from '../src/validation/submissions.js';
import { validateEvents, selectPublishableEvents } from '../src/pipeline/events.js';
import { validateSponsors } from '../src/pipeline/sponsors.js';
import { deriveEmployers, initialsFor } from '../src/pipeline/employers.js';
import { normaliseEmploymentType } from '../src/pipeline/jobs.js';

const now = new Date('2026-09-30T08:00:00Z');
const contact = { name: 'Aisha Rahman', email: 'aisha@example.ae', subject: 'Partnership', message: 'We would like to talk about a partnership.' };
const cp = (n) => String.fromCodePoint(n);

test('text is normalised, and invisible or direction-changing characters are removed', () => {
  const tricky = 'Pay' + cp(0x202e) + 'ment' + cp(0x200b) + ' due' + cp(0x2028) + 'now' + cp(0) + '  ok';
  assert.equal(cleanText(tricky), 'Payment duenow ok');
  assert.equal(cleanText('Cafe' + cp(0x301)), 'Caf' + cp(0xe9), 'NFC normalisation');
  assert.equal(cleanText('line 1\r\n\r\n\r\n\r\nline 2', { multiline: true }), 'line 1\n\nline 2');
});

test('a valid contact form passes and comes back clean', () => {
  const r = validate(SUBMISSION_SCHEMAS.contact, { ...contact, name: '  Aisha   Rahman ' }, { now });
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'Aisha Rahman');
  assert.equal(r.spam, false);
  assert.equal('website' in r.value, false, 'the honeypot is never stored');
});

test('contact form problems are reported per field, and unknown fields are rejected', () => {
  const r = validate(SUBMISSION_SCHEMAS.contact, { name: 'A', email: 'not-an-email', subject: 'Hi', message: 'short', role: 'admin' }, { now });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.fields).sort(), ['email', 'message', 'name', 'role']);
  assert.equal(r.fields.role, 'Unknown field.');
  assert.equal(validate(SUBMISSION_SCHEMAS.contact, { ...contact, message: 'x'.repeat(4001) }, { now }).fields.message, 'Use 4000 characters or fewer.');
  assert.equal(validate(SUBMISSION_SCHEMAS.contact, { ...contact, name: { $ne: '' } }, { now }).fields.name, 'Enter text.');
  assert.equal(validate(SUBMISSION_SCHEMAS.contact, ['x'], { now }).ok, false);
});

test('a filled honeypot marks the submission as spam', () => {
  const r = validate(SUBMISSION_SCHEMAS.contact, { ...contact, website: 'https://spam.example' }, { now });
  assert.equal(r.spam, true);
});

test('emails, links and choices are strictly checked', () => {
  for (const bad of ['a@b', 'a b@c.com', '<a>@x.com', 'x@-bad.com', 'x@x.com'.padStart(260, 'a')]) {
    assert.ok(validate(SUBMISSION_SCHEMAS.newsletter, { email: bad, placement: 'home' }, { now }).fields.email, bad);
  }
  assert.ok(validate(SUBMISSION_SCHEMAS.newsletter, { email: 'a@b.ae', placement: 'sidebar' }, { now }).fields.placement);
  const job = { title: 'Associate', company: 'Example Capital', location: 'DIFC, Dubai', url: 'https://jobs.example.com/1', email: 'hr@example.com' };
  assert.equal(validate(SUBMISSION_SCHEMAS.job, job, { now }).ok, true);
  for (const url of ['http://jobs.example.com/1', 'javascript:alert(1)', 'https://user:pass@example.com/', 'https://127.0.0.1/admin', 'https://localhost/x']) {
    assert.ok(validate(SUBMISSION_SCHEMAS.job, { ...job, url }, { now }).fields.url, url);
  }
  assert.ok(validate(SUBMISSION_SCHEMAS.job, { ...job, employmentType: 'Gig' }, { now }).fields.employmentType);
  assert.equal(validate(SUBMISSION_SCHEMAS.job, { ...job, employmentType: 'Contract' }, { now }).value.employmentType, 'Contract');
});

test('advertise enquiries accept the four packages, including Elite Exclusive Partner', () => {
  const enquiry = { name: 'Sara Ali', email: 'sara@example.ae', company: 'Example Capital', tier: 'exclusive' };
  // Shown on the Advertise page as Partner, Gold Partner, Elite Partner and Elite Exclusive Partner.
  for (const tier of ['silver', 'gold', 'platinum', 'exclusive']) {
    assert.equal(validate(SUBMISSION_SCHEMAS.advertise, { ...enquiry, tier }, { now }).value.tier, tier, tier);
  }
  for (const tier of ['elite', 'Exclusive', 'diamond', '']) {
    assert.ok(validate(SUBMISSION_SCHEMAS.advertise, { ...enquiry, tier }, { now }).fields.tier, tier);
  }
});

test('event dates must be real, in range and in order', () => {
  const ev = { title: 'Investor Breakfast', eventType: 'Networking', startDate: '2026-10-12', city: 'Dubai', organiser: 'Example Events', email: 'events@example.com' };
  assert.equal(validate(SUBMISSION_SCHEMAS.event, ev, { now }).ok, true);
  assert.ok(validate(SUBMISSION_SCHEMAS.event, { ...ev, startDate: '2026-02-30' }, { now }).fields.startDate, 'impossible date');
  assert.ok(validate(SUBMISSION_SCHEMAS.event, { ...ev, startDate: '2020-01-01' }, { now }).fields.startDate, 'long past');
  assert.ok(validate(SUBMISSION_SCHEMAS.event, { ...ev, startDate: '2030-01-01' }, { now }).fields.startDate, 'too far ahead');
  assert.ok(validate(SUBMISSION_SCHEMAS.event, { ...ev, endDate: '2026-10-11' }, { now }).fields.endDate, 'end before start');
});

test('events config: demo-only entries never go live, and bad entries are explained', () => {
  const list = [
    { id: 'real-event', title: 'Real Event', eventType: 'Summit', startDate: '2026-10-20', city: 'Dubai', url: '#' },
    { id: 'example', title: 'Example', eventType: 'Summit', startDate: '2026-10-21', city: 'Dubai', demoOnly: true }
  ];
  const live = validateEvents(list, { now, demo: false });
  assert.deepEqual(live.errors, []);
  assert.deepEqual(live.events.map((e) => e.id), ['real-event']);
  assert.equal(live.events[0].url, null, '"#" means no link');
  assert.equal(validateEvents(list, { now, demo: true }).events.length, 2);
  const bad = validateEvents([{ id: 'Bad Id', title: 'X', eventType: 'Summit', startDate: 'soon', city: 'Dubai', url: 'http://x.example' }], { now, demo: false });
  assert.ok(bad.errors.length >= 3);
  const kept = selectPublishableEvents([
    { id: 'old', title: 'Old', startDate: '2026-06-01', endDate: null },
    { id: 'next', title: 'Next', startDate: '2026-10-01', endDate: null },
    { id: 'recent', title: 'Recent', startDate: '2026-09-20', endDate: null }
  ], now, { keepPastDays: 30, maxPublished: 10 });
  assert.deepEqual(kept.map((e) => e.id), ['recent', 'next']);
});

test('sponsor slots: renamed fields get a helpful message, limits match the page', () => {
  const legacy = validateSponsors({ banners: [], sponsoredPosts: [{ id: 'a', title: 'T', logo: 'assets/sponsors/a.png' }] });
  assert.ok(legacy.errors.some((e) => /"banners" is now called "gold"/.test(e)));
  assert.ok(legacy.errors.some((e) => /"logo" is now called "image"/.test(e)));
  const tooMany = validateSponsors({ platinum: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, title: `P${i}` })) });
  assert.ok(tooMany.errors.some((e) => /room for 5/.test(e)));
  const ok = validateSponsors({ careerResources: [{ id: 'guide', title: 'Guide', url: 'https://example.com/guide', logoText: 'GD' }] });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.slots.careerResources[0].sponsored, false);
  assert.equal(ok.slots.careerResources[0].blurb, null, 'optional fields are null, never ""');
  const site = validateSponsors({ professionalServices: [{ id: 'x', title: 'X', website: '<script>' }] });
  assert.ok(site.errors.some((e) => /website/.test(e)));
});

test('founding sponsor slot: one sponsored banner with a name, message, https link and logo', () => {
  const two = validateSponsors({ founding: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] });
  assert.ok(two.errors.some((e) => /founding: 2 items .* room for 1/.test(e)));
  const extra = validateSponsors({ founding: [{ id: 'a', title: 'A', label: 'Gold', colorFrom: '#137A72' }] });
  assert.ok(extra.errors.some((e) => /"label" is not used in this slot/.test(e)));
  assert.ok(extra.errors.some((e) => /"colorFrom" is not used in this slot/.test(e)));
  const insecure = validateSponsors({ founding: [{ id: 'a', title: 'A', url: 'http://example.com' }] });
  assert.ok(insecure.errors.some((e) => /https:\/\//.test(e)));
  assert.ok(validateSponsors({ founding: [{ id: 'a', blurb: 'No name' }] }).errors.some((e) => /"title" is required/.test(e)));
  const empty = validateSponsors({ founding: [] });
  assert.deepEqual(empty.errors, []);
  assert.deepEqual(empty.slots.founding, [], 'an empty slot is published empty, so the page keeps its own advert');
  const ok = validateSponsors({ founding: [{ id: 'sandhaven', title: 'Sandhaven Capital', blurb: 'Private credit for the Gulf.', url: 'https://example.com/', image: 'https://example.com/logo.png' }] });
  assert.deepEqual(ok.errors, []);
  const [item] = ok.slots.founding;
  assert.equal(item.sponsored, true);
  assert.equal(item.blurb, 'Private credit for the Gulf.');
  assert.equal(item.url, 'https://example.com/');
  assert.equal(item.colorFrom, null);
  assert.equal(item.label, null);
});

test('employers are derived from open roles, and employment types are normalised', () => {
  assert.equal(initialsFor('Gulf Horizon Asset Management (demo)'), 'GH');
  assert.equal(initialsFor('Qirsh'), 'QI');
  const employers = deriveEmployers([
    { company: 'Qirsh', status: 'open' },
    { company: 'Qirsh', status: 'open', featured: true },
    { company: 'Sandline Ventures', status: 'open' },
    { company: 'Old Co', status: 'closed' }
  ], { maxPublished: 15 });
  assert.deepEqual(employers.map((e) => [e.name, e.openJobs, e.featured]), [['Qirsh', 2, true], ['Sandline Ventures', 1, false]]);
  assert.match(employers[0].id, /^emp_[a-f0-9]{16}$/);
  assert.equal(normaliseEmploymentType('FullTime'), 'Full-time');
  assert.equal(normaliseEmploymentType('full_time'), 'Full-time');
  assert.equal(normaliseEmploymentType('Internship'), 'Internship');
  assert.equal(normaliseEmploymentType('Whenever'), null);
});
