// Schemas for the five website forms. Field names are the API contract: the
// <input name="..."> attributes in frontend_demo/*.html and js/fundsae-forms.js
// must use exactly these names (unknown fields are rejected with 400).
//
// Every form also carries the honeypot field "website", which people never see.

import { rules } from './validate.js';
import { ADVERTISING_TIERS, EMPLOYMENT_TYPES } from '../contracts/models.js';

const { text, email, httpsUrl, enumOf, isoDate, honeypot } = rules;

const name = text({ min: 2, max: 80 });
const contactEmail = email();

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
      tier: enumOf(ADVERTISING_TIERS),
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

  job: {
    fields: {
      title: text({ min: 3, max: 160 }),
      company: text({ min: 2, max: 120 }),
      location: text({ min: 2, max: 160 }),
      url: httpsUrl(),
      employmentType: enumOf(EMPLOYMENT_TYPES, { required: false }),
      email: contactEmail,
      website: honeypot()
    }
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
