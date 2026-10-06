// Adapters turn one configured source into raw items.
// To support a new kind of source (for example a publisher JSON API), add a
// function here and register it in NEWS_ADAPTERS or JOB_ADAPTERS.

import { fetchText } from '../lib/http.js';
import { parseFeed } from '../lib/feedParser.js';
import { loadFixture } from '../lib/fixtures.js';
import { htmlToText } from '../lib/text.js';

function httpOptions(settings, extra = {}) {
  return { userAgent: settings.userAgent, ...settings.http, ...extra };
}

async function getBody(source, ctx, url, { accept, conditional = true } = {}) {
  if (ctx.demo) return { body: loadFixture(source.fixture, ctx.now), notModified: false };
  const state = ctx.state || {};
  const res = await fetchText(url, httpOptions(ctx.settings, {
    accept,
    etag: conditional ? state.etag : undefined,
    lastModified: conditional ? state.lastModified : undefined
  }));
  return res;
}

function parseJson(body, source) {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${source.id}: response was not valid JSON`);
  }
}

/* ---------------------------------- News ---------------------------------- */

async function rssNews(source, ctx) {
  const res = await getBody(source, ctx, source.url);
  if (res.notModified) return { items: [], notModified: true, etag: res.etag, lastModified: res.lastModified };
  const feed = parseFeed(res.body);
  return { items: feed.items, format: feed.format, etag: res.etag, lastModified: res.lastModified };
}

export const NEWS_ADAPTERS = { rss: rssNews };

/* ---------------------------------- Jobs ---------------------------------- */
// Every job adapter returns items shaped as:
// { externalId, title, company, location, url, postedAt (Date|null), department, employmentType }

async function rssJobs(source, ctx) {
  // Job feeds are small; always fetch in full so closed roles can be detected.
  const res = await getBody(source, ctx, source.url, { conditional: false });
  const feed = parseFeed(res.body);
  const pattern = source.titlePattern ? new RegExp(source.titlePattern) : null;
  return {
    items: feed.items.map((it) => {
      const rawTitle = htmlToText(it.title);
      const g = (pattern && pattern.exec(rawTitle)?.groups) || {};
      return {
        externalId: it.guid || it.link,
        title: (g.title || rawTitle).trim(),
        company: (g.company || source.company || '').trim(),
        location: (g.location || it.categories.find((c) => /,|dubai|abu dhabi|uae|remote/i.test(c)) || '').trim(),
        url: it.link,
        postedAt: it.publishedAt,
        department: '',
        employmentType: ''
      };
    })
  };
}

async function greenhouseJobs(source, ctx) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board)}/jobs`;
  const res = await getBody(source, ctx, url, { accept: 'application/json', conditional: false });
  const data = parseJson(res.body, source);
  return {
    items: (data.jobs || []).map((j) => ({
      externalId: String(j.id),
      title: j.title,
      company: source.company,
      location: j.location?.name || '',
      url: j.absolute_url,
      postedAt: j.first_published ? new Date(j.first_published) : j.updated_at ? new Date(j.updated_at) : null,
      department: (j.departments || []).map((d) => d.name).join(', '),
      employmentType: ''
    }))
  };
}

async function leverJobs(source, ctx) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(source.board)}?mode=json`;
  const res = await getBody(source, ctx, url, { accept: 'application/json', conditional: false });
  const data = parseJson(res.body, source);
  return {
    items: (Array.isArray(data) ? data : []).map((j) => ({
      externalId: j.id,
      title: j.text,
      company: source.company,
      location: [j.categories?.location, ...(j.categories?.allLocations || [])].filter(Boolean).join('; '),
      url: j.hostedUrl,
      postedAt: j.createdAt ? new Date(Number(j.createdAt)) : null,
      department: j.categories?.team || j.categories?.department || '',
      employmentType: j.categories?.commitment || ''
    }))
  };
}

async function ashbyJobs(source, ctx) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.board)}`;
  const res = await getBody(source, ctx, url, { accept: 'application/json', conditional: false });
  const data = parseJson(res.body, source);
  return {
    items: (data.jobs || [])
      .filter((j) => j.isListed !== false)
      .map((j) => ({
        externalId: j.id || j.jobUrl,
        title: j.title,
        company: source.company,
        location: [j.location, ...(j.secondaryLocations || []).map((l) => l.location || l)].filter(Boolean).join('; '),
        url: j.jobUrl || j.applyUrl,
        postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
        department: j.department || j.team || '',
        employmentType: j.employmentType || ''
      }))
  };
}

export const JOB_ADAPTERS = { rss: rssJobs, greenhouse: greenhouseJobs, lever: leverJobs, ashby: ashbyJobs };
