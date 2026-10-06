// "Featured Employers" on the Careers page, derived from open roles so the
// job counts can never disagree with the roles actually listed.

import { employerIdFor } from '../lib/url.js';

// Words that make poor initials: "Gulf Horizon Asset Management (demo)" -> "GH".
const SKIP = new Set(['the', 'and', 'of', 'for', '&', 'llc', 'ltd', 'plc', 'inc', 'pjsc', 'psc', 'co', 'limited', 'demo']);

export function initialsFor(name) {
  const words = String(name || '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !SKIP.has(w.toLowerCase()));
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * @param {Array<{company:string, employerId?:string, featured?:boolean, status:string}>} jobs
 * @returns {Array<{id:string, name:string, initials:string, openJobs:number, featured:boolean}>}
 */
export function deriveEmployers(jobs, { maxPublished }) {
  const byId = new Map();
  for (const j of jobs) {
    if (j.status !== 'open' || !j.company) continue;
    const id = j.employerId || employerIdFor(j.company);
    const e = byId.get(id) || { id, name: j.company, initials: initialsFor(j.company), openJobs: 0, featured: false };
    e.openJobs += 1;
    e.featured ||= Boolean(j.featured);
    byId.set(id, e);
  }
  return [...byId.values()]
    .sort((a, b) => Number(b.featured) - Number(a.featured) || b.openJobs - a.openJobs || a.name.localeCompare(b.name))
    .slice(0, maxPublished);
}
