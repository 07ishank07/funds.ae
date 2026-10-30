// Schemas for the five website forms. Field names are the API contract: the
// <input name="..."> attributes in frontend_demo/*.html and js/fundsae-forms.js
// must use exactly these names (unknown fields are rejected with 400).
//
// Every form also carries the honeypot field "website", which people never see.

import { rules } from './validate.js';
import { EMPLOYMENT_TYPES } from '../contracts/models.js';
import { JOB_FORM_OPTIONS, JOB_LIMITS } from '../jobs/rules.js';

const { text, email, httpsUrl, enumOf, isoDate, honeypot, id, wholeNumber } = rules;

const name = text({ min: 2, max: 80 });
const contactEmail = email();

/** Choices on the Post a Job page come from the shared job rules (src/jobs/rules.js = studio/schemaTypes/jobRules.js). */
export { JOB_FORM_OPTIONS };
const SALARY_MAX = JOB_LIMITS.salaryMax;

export const SUBMISSION_SCHEMAS = {
  contact: {
    fields: {
      name,
      email: contactEmail,
      subject: text({ min: 2, max: 120 }),
      message: text({ min: 10, max: 4000, multiline: true }),
      website: honeypot()
    }
  },

  newsletter: {
    fields: {
      email: contactEmail,
      placement: enumOf(['home', 'careers']),
      website: honeypot()
    }
  },

  advertise: {
    fields: {
      name,
      email: contactEmail,
      company: text({ min: 2, max: 120 }),
      // A package id; the handler also checks it is one of the packages currently published.
      tier: id(),
      message: text({ min: 0, max: 2000, required: false, multiline: true }),
      website: honeypot()
    }
  },

  event: {
    fields: {
      title: text({ min: 3, max: 90 }),
      eventType: text({ min: 2, max: 40 }),
      startDate: isoDate({ minDays: -1, maxDays: 730 }),
      endDate: isoDate({ required: false, minDays: -1, maxDays: 760 }),
      city: text({ min: 2, max: 60 }),
      url: httpsUrl({ required: false }),
      organiser: text({ min: 2, max: 120 }),
      email: contactEmail,
      website: honeypot()
    },
    check: (v) => (v.endDate && v.endDate < v.startDate ? { endDate: 'The end date must be on or after the start date.' } : null)
  },

  // "Post a job" (frontend_demo/PostJob.dc.html). The company's website is "companyUrl" because "website" is the
  // bot trap. An editor reviews every role; approved ones are copied into config/jobs.manual.json.
  job: {
    fields: {
      company: text({ min: JOB_LIMITS.company[0], max: JOB_LIMITS.company[1] }),
      companyUrl: httpsUrl({ required: false }),
      title: text({ min: JOB_LIMITS.title[0], max: JOB_LIMITS.title[1] }),
      location: text({ min: JOB_LIMITS.location[0], max: JOB_LIMITS.location[1] }),
      workMode: enumOf(JOB_FORM_OPTIONS.workMode, { required: false }),
      employmentType: enumOf(EMPLOYMENT_TYPES, { required: false }),
      seniority: enumOf(JOB_FORM_OPTIONS.seniority, { required: false }),
      department: enumOf(JOB_FORM_OPTIONS.department, { required: false }),
      regulator: enumOf(JOB_FORM_OPTIONS.regulator, { required: false }),
      url: httpsUrl(),
      salaryFrom: wholeNumber({ min: 1, max: SALARY_MAX }),
      salaryTo: wholeNumber({ min: 1, max: SALARY_MAX, required: false }),
      salaryCurrency: enumOf(JOB_FORM_OPTIONS.salaryCurrency),
      salaryPeriod: enumOf(JOB_FORM_OPTIONS.salaryPeriod),
      visa: enumOf(JOB_FORM_OPTIONS.visa),
      description: text({ min: JOB_LIMITS.description[0], max: JOB_LIMITS.description[1], multiline: true }),
      name,
      contactRole: text({ min: 2, max: 80, required: false }),
      email: contactEmail,
      website: honeypot()
    },
    check: (v) => (v.salaryTo !== null && v.salaryTo < v.salaryFrom ? { salaryTo: 'The top of the range must be at least the starting salary.' } : null)
  }
};

// Events and jobs from the public are never published automatically: an
// editor reviews them and copies approved ones into config/events.json or
// config/jobs.manual.json.
export const INITIAL_STATUS = {
  contact: 'new',
  newsletter: 'new',
  advertise: 'new',
  event: 'pending-review',
  job: 'pending-review'
};
