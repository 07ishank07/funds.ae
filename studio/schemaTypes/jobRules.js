// Rules for jobs posted on funds.ae: the Post a Job form, the Careers section of the Studio and the
// publisher all follow this file. Plain data, no imports. backend/src/jobs/rules.js is a copy;
// backend/test/cms.test.js fails if the two differ, so change them together.
//
// Only posted jobs live in Sanity: jobs an editor enters in the Studio and Post a Job submissions.
// Every job waits as Pending review until an approver publishes it (docs/SANITY-CMS-GUIDE.md, "Careers").
// Approvers are the review approvers of the news queue (NEWS_APPROVER_IDS / settings news.review.approverIds).

export const JOB_STATUSES = ['pending_review', 'published', 'rejected', 'archived'];
export const JOB_STATUS_LABELS = {
  pending_review: 'Pending review',
  published: 'Published',
  rejected: 'Rejected',
  archived: 'Archived',
};

/** Jobs live under private ids "jobs.<id>": a public dataset never shows them (or the filer's email) to anonymous readers. */
export const JOB_ID_PATH = 'jobs';

export const JOB_EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'];

/** Choices on the Post a Job page and in the Studio. The page's <option> values must equal these lists. */
export const JOB_FORM_OPTIONS = {
  workMode: ['Onsite', 'Hybrid', 'Remote'],
  seniority: ['Entry-level', 'Analyst', 'Associate', 'Vice President', 'Director', 'Managing Director / Partner', 'C-suite'],
  department: [
    'Investments and Portfolio Management', 'Private Equity and Venture Capital', 'Private Credit and Lending',
    'Investment Banking and Advisory', 'Wealth Management and Private Banking', 'Research and Analysis', 'Risk Management',
    'Compliance and AML', 'Legal', 'Finance and Accounting', 'Fund Administration and Operations',
    'Investor Relations and Fundraising', 'Sales and Business Development', 'Technology and Data',
    'Real Estate and Infrastructure', 'Human Resources',
  ],
  regulator: ['DFSA (DIFC)', 'FSRA (ADGM)', 'SCA', 'CBUAE', 'VARA', 'Not a regulated role'],
  salaryCurrency: ['AED', 'USD'],
  salaryPeriod: ['month', 'year'],
  visa: ['Visa sponsorship offered', 'Must hold own UAE visa', 'Remote from abroad'],
};

/** Text lengths [min, max], list sizes and limits. */
export const JOB_LIMITS = {
  title: [3, 160],
  company: [2, 120],
  location: [2, 160],
  description: [50, 5000],
  requirement: [2, 200],
  requirements: 20,
  slug: [3, 96],
  salaryMax: 100000000,
  rejectionReason: [5, 300],
  filerName: [2, 80],
  employerName: [2, 120],
  employerDescription: [0, 400],
  topEmployers: 20,
  topJobs: 20,
  // A published job without an expiry date stays up this many days after approval.
  defaultLiveDays: 60,
};
export const JOB_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const EMPLOYER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}$/;

/**
 * Workflow actions: the statuses each one starts from, the status it sets, and whether only an approver may run it.
 * Taking a job off the site is open to every editor; putting one on it is not.
 */
export const JOB_ACTIONS = {
  approvePublish: {label: 'Approve and publish', from: ['pending_review', 'rejected', 'archived'], to: 'published', approverOnly: true},
  reject: {label: 'Reject', from: ['pending_review', 'published'], to: 'rejected', approverOnly: false},
  unpublish: {label: 'Unpublish', from: ['published'], to: 'pending_review', approverOnly: false},
  archive: {label: 'Archive', from: ['pending_review', 'published', 'rejected'], to: 'archived', approverOnly: false},
};

/** The only fields the submissions server may write, and only when it creates a pending job. */
export const JOB_SUBMISSION_FIELDS = [
  '_id', '_type', 'status', 'company', 'companyUrl', 'title', 'location', 'workMode', 'employmentType', 'seniority',
  'department', 'regulator', 'url', 'salaryFrom', 'salaryTo', 'salaryCurrency', 'salaryPeriod', 'visa', 'description', 'filer',
];
/** Set only by the workflow actions. */
export const JOB_WORKFLOW_FIELDS = [
  'status', 'approval', 'publishedAt', 'publishedById', 'firstPublishedAt', 'rejectionReason', 'statusChangedAt', 'statusChangedById',
];
/** What an approval vouches for: changing any of these after approval takes the job off the site until re-approved. */
export const JOB_APPROVAL_HASH_FIELDS = [
  'title', 'slug', 'company', 'employer', 'companyUrl', 'location', 'workMode', 'employmentType', 'seniority', 'department',
  'regulator', 'url', 'salaryFrom', 'salaryTo', 'salaryCurrency', 'salaryPeriod', 'visa', 'description', 'requirements', 'expiresAt',
];
export const CAREER_RESOURCE_TYPES = ['Article', 'Guide', 'Career tip', 'External link'];
