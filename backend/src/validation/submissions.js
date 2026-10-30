// Schemas for the five website forms. Field names are the API contract: the
// <input name="..."> attributes in frontend_demo/*.html and js/fundsae-forms.js
// must use exactly these names (unknown fields are rejected with 400).
//
// Every form also carries the honeypot field "website", which people never see.

import { rules } from './validate.js';
import { EMPLOYMENT_TYPES } from '../contracts/models.js';

const { text, email, httpsUrl, enumOf, isoDate, honeypot, id, wholeNumber } = rules;

const name = text({ min: 2, max: 80 });
const contactEmail = email();

/**
 * Choices on the "Post a job" page (frontend_demo/PostJob.dc.html). The page's <option> values must equal
 * these lists; test/contract.test.js checks that.
 */
export const JOB_FORM_OPTIONS = {
  workMode: ['Onsite', 'Hybrid', 'Remote'],
  seniority: ['Entry-level', 'Analyst', 'Associate', 'Vice President', 'Director', 'Managing Director / Partner', 'C-suite'],
  department: [
    'Investments and Portfolio Management', 'Private Equity and Venture Capital', 'Private Credit and Lending',
    'Investment Banking and Advisory', 'Wealth Management and Private Banking', 'Research and Analysis', 'Risk Management',
    'Compliance and AML', 'Legal', 'Finance and Accounting', 'Fund Administration and Operations',
    'Investor Relations and Fundraising', 'Sales and Business Development', 'Technology and Data',
    'Real Estate and Infrastructure', 'Human Resources'
  ],
  regulator: ['DFSA (DIFC)', 'FSRA (ADGM)', 'SCA', 'CBUAE', 'VARA', 'Not a regulated role'],
  salaryCurrency: ['AED', 'USD'],
  salaryPeriod: ['month', 'year'],
  visa: ['Visa sponsorship offered', 'Must hold own UAE visa', 'Remote from abroad']
};
const SALARY_MAX = 100_000_000;

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
      company: text({ min: 2, max: 120 }),
      companyUrl: httpsUrl({ required: false }),
      title: text({ min: 3, max: 160 }),
      location: text({ min: 2, max: 160 }),
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
      description: text({ min: 50, max: 5000, multiline: true }),
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
