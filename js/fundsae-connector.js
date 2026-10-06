/*!
 * Funds.ae connector: fills the page's data slots from the API.
 * Needs js/fundsae-api.js loaded first.
 *
 * A slot is any element with data-fundsae-slot="<name>" (the full list is the
 * "UI contract" table in backend/README.md). For each slot the connector
 * clones one of the slot's own placeholder rows as a template, so the page's
 * styling is kept, and fills the clone with API data using textContent only.
 *
 * Demo data never passes as real:
 *  - live mode: placeholders are always replaced; if the API has nothing for a
 *    slot, a short "nothing yet" note is shown instead;
 *  - demo mode: API demo data replaces the placeholders and a "Demo data"
 *    badge is shown;
 *  - API unreachable: the page keeps its built-in content (and says so in the console).
 */
(function () {
  'use strict';

  var api = window.FundsAeApi;
  if (!api) {
    try { console.warn('[Funds.ae] fundsae-api.js must be loaded before fundsae-connector.js'); } catch (e) { /* no console */ }
    return;
  }

  var LIMITS = { newsPerRegion: 15, newsMore: 35, headline: 92, tileHeadline: 110, homeJobs: 20, tiles: 15, eventsPerList: 10, topJobs: 20 };
  var ROLES_DEMO_TOTAL = 120; // Careers page, demo mode: live roles are topped up with dummy roles to this many (3 pages of PER_PAGE = 40 in Careers.dc.html)
  var TILES_SHOWN = 12; // Real Estate, Energy, AI and Technology and Grants boxes
  var REGIONS = { uae: 'UAE News', world: 'Global News' };
  // Business Funding is a third news tab, alongside UAE/Global. It is not a category like the
  // other two: it pulls in any story tagged with the "grants-funding" topic, regardless of
  // category, in addition to (not instead of) that story's normal UAE/Global News tab.
  var BUSINESS_FUNDING_TOPIC = 'grants-funding';
  var BUSINESS_FUNDING_REGION = 'Business Funding';
  var NEWS_REGIONS = ['UAE News', 'Global News', 'Business Funding'];
  var EMPTY_TEXT = 'Nothing to show yet. Check back soon.';
  var state = { mode: null };
  var loads = {};

  /* ---------------------------------- helpers --------------------------------- */

  function slots(name) {
    return Array.prototype.slice.call(document.querySelectorAll('[data-fundsae-slot="' + name + '"]'));
  }
  function hasSlot(name) { return !!document.querySelector('[data-fundsae-slot="' + name + '"]'); }
  function children(container, selector) {
    return Array.prototype.slice.call(container.querySelectorAll(selector));
  }
  function truncate(text, max) {
    return text.length > max ? text.slice(0, max).replace(/\s+\S*$/, '').trimEnd() + '…' : text;
  }
  function load(name, resource) {
    if (!loads[name]) loads[name] = api.get(name, resource);
    return loads[name];
  }
  function initials(text) {
    var words = String(text || '').replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean);
    return ((words[0] || '?').charAt(0) + (words[1] || '').charAt(0)).toUpperCase();
  }
  function backgroundsOf(nodes) {
    return nodes.map(function (n) { return n.style.background || n.style.backgroundImage; }).filter(Boolean);
  }

  /** Hides (page-owned lists) or removes the built-in placeholder rows of a slot. */
  function retire(container, rows) {
    var hideOnly = container.hasAttribute('data-fundsae-hide-placeholders');
    rows.forEach(function (row) {
      if (row.hasAttribute('data-fundsae-row')) { row.remove(); return; }
      if (!hideOnly) { row.remove(); return; }
      row.hidden = true;
      row.style.display = 'none';
      row.setAttribute('aria-hidden', 'true');
      row.setAttribute('data-fundsae-placeholder', '');
    });
  }

  function emptyNote(container) {
    var note = document.createElement(container.tagName === 'UL' || container.tagName === 'OL' ? 'li' : 'p');
    note.textContent = EMPTY_TEXT;
    note.setAttribute('data-fundsae-row', '');
    note.style.cssText = 'list-style: none; margin: 8px 0; font-size: 14px; color: #62797D';
    return note;
  }

  /**
   * Replaces a slot's rows with API items.
   * @returns {boolean} false when the slot was left untouched (no items outside live mode, or no template).
   */
  function fillList(container, rowSelector, list, fill, opts) {
    opts = opts || {};
    if (!list.length && state.mode !== 'live') return false;
    var rows = children(container, rowSelector).filter(function (r) { return !r.hasAttribute('data-fundsae-placeholder'); });
    var template = container.__fundsTemplate || opts.template || rows[0];
    if (!template) return false;
    container.__fundsTemplate = template.cloneNode(true);
    retire(container, rows);
    var anchor = opts.before || null;
    if (!list.length) {
      container.insertBefore(emptyNote(container), anchor);
      return true;
    }
    list.forEach(function (item, i) {
      var row = container.__fundsTemplate.cloneNode(true);
      row.hidden = false;
      if (row.style.display === 'none') row.style.display = '';
      row.removeAttribute('aria-hidden');
      row.removeAttribute('id');
      row.setAttribute('data-fundsae-row', '');
      fill(row, item, i);
      container.insertBefore(row, anchor);
    });
    return true;
  }

  /** A logo box: sponsor image if provided, otherwise its short text on the sponsor's colours. */
  function logoBox(box, item, useGradient) {
    if (!box) return;
    box.removeAttribute('role');
    box.setAttribute('aria-hidden', 'true');
    var image = api.imageUrl(item.image);
    if (image) {
      box.textContent = '';
      box.style.background = '#FFFFFF url("' + image + '") center / contain no-repeat';
      return;
    }
    box.textContent = item.logoText || initials(item.title);
    var from = api.hex(item.colorFrom);
    var to = api.hex(item.colorTo);
    if (from && to && useGradient) box.style.background = 'linear-gradient(145deg, ' + from + ', ' + to + ')';
    else if (from) box.style.background = from;
  }

  function sponsorLink(a, item) {
    api.setLink(a, item.url, { sponsored: item.sponsored, httpsOnly: true });
  }

  function jobCount(n) {
    return n === 1 ? api.tr('1 job') : api.tr('{n} jobs').replace('{n}', String(n));
  }

  /* ------------------------------ masthead: date, badge ------------------------ */

  function renderDate() {
    document.querySelectorAll('[data-fundsae-date]').forEach(function (node) {
      var target = node.querySelector('[data-fundsae-date-text]');
      if (!target) {
        target = document.createElement('span');
        target.setAttribute('data-fundsae-date-text', '');
        node.textContent = '';
        node.appendChild(target);
      }
      var arabic = api.lang() === 'ar';
      target.textContent = new Intl.DateTimeFormat(arabic ? 'ar-AE-u-nu-latn' : 'en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai'
      }).format(new Date()).replace(/,/g, '');
    });
  }

  function renderBadge() {
    if (state.mode !== 'demo') return;
    document.querySelectorAll('[data-fundsae-badge]').forEach(function (node) {
      if (node.querySelector('[data-fundsae-demo]')) return;
      var badge = document.createElement('span');
      badge.setAttribute('data-fundsae-demo', '');
      badge.title = 'Sample content. Switch backend/config/settings.json to live mode for real data.';
      badge.textContent = 'Demo data';
      badge.style.cssText = 'display: inline-block; margin-inline-start: 10px; padding: 1px 8px; border: 1px solid #4FB3B8; border-radius: 999px; font-size: 11px; font-weight: 500; line-height: 1.6; letter-spacing: 0.04em; color: #1F6A6E; vertical-align: middle; text-transform: none';
      node.appendChild(badge);
    });
  }

  /* ------------------------------------ news ----------------------------------- */
  // Region tabs belong to the page script (this.html), which shows articles whose
  // data-news-region equals the active tab ("UAE News" / "Global News") every 250 ms.
  // Articles the connector wants hidden therefore get a region value that never
  // matches a tab; the page's own placeholders get "placeholder".

  var newsView = { query: '', expanded: {} };

  function applyNewsVisibility(news) {
    var query = newsView.query;
    var totals = {};
    var matches = 0;
    news.querySelectorAll('[data-fundsae-story]').forEach(function (art) {
      var region = art.getAttribute('data-fundsae-region');
      var index = Number(art.getAttribute('data-fundsae-index'));
      totals[region] = (totals[region] || 0) + 1;
      var visible = query
        ? art.getAttribute('data-fundsae-text').indexOf(query) !== -1
        : newsView.expanded[region] || index < LIMITS.newsPerRegion;
      if (visible && query) matches++;
      art.setAttribute('data-news-region', visible ? region : region + ':hidden');
    });
    news.querySelectorAll('[data-fundsae-more]').forEach(function (link) {
      var region = link.getAttribute('data-fundsae-more');
      var show = !query && !newsView.expanded[region] && (totals[region] || 0) > LIMITS.newsPerRegion;
      link.setAttribute('data-more-news-region', show ? region : region + ':none');
    });
    var status = news.querySelector('[data-fundsae-search-status]');
    if (status) {
      status.textContent = !query ? '' : matches ? matches + (matches === 1 ? ' story matches' : ' stories match') + ' "' + query + '".' : 'No stories match "' + query + '".';
      status.style.display = query ? '' : 'none';
    }
  }

  function renderNews(doc) {
    var news = slots('news')[0];
    if (!news) return;
    var stories = api.items(doc.items, api.valid.story, 'stories');
    if (!stories.length && state.mode !== 'live') return;

    var placeholders = children(news, ':scope > article');
    // Template: a placeholder row built by the page script (headline + "Source:" line).
    var template = placeholders.filter(function (a) { return a.querySelector('h2 a') && a.querySelector(':scope > p'); }).pop();
    if (!template) return;
    template = template.cloneNode(true);
    placeholders.forEach(function (art) {
      art.setAttribute('data-news-region', 'placeholder');
      art.setAttribute('aria-hidden', 'true');
      art.setAttribute('data-fundsae-placeholder', '');
      art.removeAttribute('id');
    });

    var moreLink = news.querySelector('[data-more-news-region]');
    var anchor = moreLink ? moreLink.parentElement : null;
    var byRegion = {};
    var addTo = function (region, story) { (byRegion[region] = byRegion[region] || []).push(story); };
    stories.forEach(function (s) {
      var region = REGIONS[s.category];
      if (region) addTo(region, s);
      // Cross-listed, not exclusive: a grants-funding story still appears in its own UAE/Global tab too.
      if (s.topic === BUSINESS_FUNDING_TOPIC || (s.topics || []).indexOf(BUSINESS_FUNDING_TOPIC) !== -1) {
        addTo(BUSINESS_FUNDING_REGION, s);
      }
    });

    NEWS_REGIONS.forEach(function (region) {
      var list = (byRegion[region] || []).slice(0, LIMITS.newsPerRegion + LIMITS.newsMore);
      if (!list.length) {
        var none = document.createElement('article');
        none.setAttribute('data-news-region', region);
        none.setAttribute('data-fundsae-row', '');
        var p = document.createElement('p');
        p.textContent = EMPTY_TEXT;
        p.style.cssText = 'margin: 12px 0; font-size: 14px; color: #62797D';
        none.appendChild(p);
        news.insertBefore(none, anchor);
      }
      list.forEach(function (story, i) {
        var art = template.cloneNode(true);
        art.removeAttribute('aria-hidden');
        art.removeAttribute('data-fundsae-placeholder');
        art.style.display = '';
        if (region === 'Global News' && i === 0) art.id = 'global-news';
        art.setAttribute('data-fundsae-row', '');
        art.setAttribute('data-fundsae-story', story.id);
        art.setAttribute('data-fundsae-region', region);
        art.setAttribute('data-fundsae-index', String(i));
        art.setAttribute('data-fundsae-text', (story.headline + ' ' + story.source).toLowerCase());
        var a = art.querySelector('h2 a');
        a.textContent = truncate(story.headline, LIMITS.headline);
        a.title = story.headline;
        api.setLink(a, story.url);
        art.querySelector(':scope > p').textContent = 'Source: ' + story.source;
        news.insertBefore(art, anchor);
      });
    });

    // "View All" expands a region to every story the API returned for it.
    news.querySelectorAll('[data-more-news-region]').forEach(function (link) {
      var region = link.getAttribute('data-more-news-region');
      if (NEWS_REGIONS.indexOf(region) === -1) return;
      link.setAttribute('data-fundsae-more', region);
      link.setAttribute('role', 'button');
      link.addEventListener('click', function (event) {
        event.preventDefault();
        newsView.expanded[region] = true;
        applyNewsVisibility(news);
        var first = news.querySelector('[data-fundsae-region="' + region + '"][data-fundsae-index="' + LIMITS.newsPerRegion + '"] h2 a');
        if (first) first.focus();
      });
    });
    applyNewsVisibility(news);
  }

  /** The masthead search box filters the loaded stories (both regions) as you type. */
  function bindSearch() {
    var input = document.getElementById('home-search');
    var news = slots('news')[0];
    if (!input || !news || input.hasAttribute('data-fundsae-search')) return;
    input.setAttribute('data-fundsae-search', '');
    input.setAttribute('maxlength', '100');
    var status = document.createElement('p');
    status.setAttribute('data-fundsae-search-status', '');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'display: none; margin: 10px 0 0; font-size: 14px; color: #1F6A6E';
    var tabs = news.querySelector('.tabs-row');
    news.insertBefore(status, tabs ? tabs.nextSibling : news.firstChild);
    var timer = null;
    var run = function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        newsView.query = input.value.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 100);
        applyNewsVisibility(news);
      }, 150);
    };
    input.addEventListener('input', run);
    input.addEventListener('search', run);
    input.addEventListener('keydown', function (event) { if (event.key === 'Enter') event.preventDefault(); });
  }

  /* -------------------------------- topic tiles -------------------------------- */

  // padTo (optional): the box always shows this many tiles. Live mode shows only real stories;
  // demo mode tops the live stories up with the page's own dummy tiles so the box never looks half empty.
  function renderTiles(slotName, doc, padTo) {
    var stories = api.items(doc.items, api.valid.story, 'stories').slice(0, padTo || LIMITS.tiles);
    slots(slotName).forEach(function (box) {
      var dummies = padTo ? children(box, ':scope > article').filter(function (r) { return !r.hasAttribute('data-fundsae-row'); }).map(function (r) { return r.cloneNode(true); }) : [];
      var palette = backgroundsOf(children(box, ':scope > article [role="img"], :scope > article [data-fundsae-tag]'));
      fillList(box, ':scope > article', stories, function (art, story, i) {
        var tag = art.querySelector('[role="img"], [data-fundsae-tag]');
        if (tag) {
          tag.textContent = String(story.topicLabel || '').toUpperCase();
          tag.removeAttribute('role');
          tag.setAttribute('aria-hidden', 'true');
          tag.setAttribute('data-fundsae-tag', '');
          if (palette.length) tag.style.background = palette[i % palette.length];
        }
        var a = art.querySelector('a');
        a.textContent = truncate(story.headline, LIMITS.tileHeadline);
        a.title = story.headline;
        api.setLink(a, story.url);
      });
      if (padTo && state.mode === 'demo' && stories.length) {
        dummies.slice(stories.length, padTo).forEach(function (tile) { box.appendChild(tile); });
      }
    });
  }

  /* ------------------------------------ jobs ----------------------------------- */

  function renderHomeJobs(doc) {
    var jobs = api.items(doc.items, api.valid.job, 'jobs').slice(0, LIMITS.homeJobs);
    slots('home-jobs').forEach(function (list) {
      fillList(list, ':scope > li', jobs, function (li, job) {
        var a = li.querySelector('a');
        a.textContent = job.title;
        // The home page shows title + company; details and the apply link live on the Careers page.
        a.setAttribute('href', 'Careers.dc.html#' + encodeURIComponent(job.id));
        a.removeAttribute('target');
        a.removeAttribute('rel');
        var spans = li.querySelectorAll(':scope > span');
        if (spans[0]) spans[0].textContent = job.company;
        for (var i = 1; i < spans.length; i++) spans[i].remove();
      });
    });
  }

  /** "Today", "3 days ago", "2 weeks ago", "1 month ago" from an ISO date. */
  function postedAgo(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
    if (days < 1) return api.tr('Posted today');
    if (days < 14) return api.tr('Posted {n} days ago').replace('{n}', String(days));
    if (days < 60) return api.tr('Posted {n} weeks ago').replace('{n}', String(Math.floor(days / 7)));
    return api.tr('Posted {n} months ago').replace('{n}', String(Math.floor(days / 30)));
  }

  /** Emirate for the Location filter: the API's location text is free-form ("DIFC, Dubai", "ADGM", "Remote - UAE"). */
  function cityOf(location) {
    var l = String(location || '').toLowerCase();
    if (/abu dhabi|adgm/.test(l)) return 'Abu Dhabi';
    if (/dubai|difc/.test(l)) return 'Dubai';
    if (/sharjah/.test(l)) return 'Sharjah';
    if (/remote/.test(l)) return 'Remote';
    return '';
  }

  function renderRoles(jobsDoc, employersDoc) {
    var list = slots('roles')[0];
    if (!list) return;
    var jobs = api.items(jobsDoc.items, api.valid.job, 'jobs');
    // Demo mode only: the live demo roles are topped up with the page's own dummy roles to ROLES_DEMO_TOTAL.
    var dummies = children(list, ':scope > .role').filter(function (r) { return !r.hasAttribute('data-fundsae-row'); }).map(function (r) { return r.cloneNode(true); });
    var filled = fillList(list, ':scope > .role', jobs, function (row, job) {
      row.id = job.id;
      row.setAttribute('data-employer', job.employerId);
      row.setAttribute('data-city', cityOf(job.location));
      row.setAttribute('data-department', job.department || '');
      row.setAttribute('data-type', job.employmentType || '');
      row.setAttribute('data-posted', job.postedAt || '');
      row.setAttribute('data-featured', job.featured ? '1' : '0');
      row.querySelector('h2').textContent = job.title;
      row.querySelector('.company').textContent = job.company;
      row.querySelector('.location').textContent = [job.location, job.employmentType].filter(Boolean).join(' · ');
      var logo = row.querySelector('.role-logo');
      if (logo) logo.textContent = initials(job.company);
      var meta = row.querySelector('.role-meta');
      if (meta) {
        meta.textContent = '';
        if (job.featured) {
          var tag = document.createElement('span');
          tag.className = 'role-featured';
          tag.textContent = api.tr('Featured');
          meta.appendChild(tag);
        }
        var bits = [job.department, postedAgo(job.postedAt)].filter(Boolean).join(' · ');
        if (bits) {
          var text = document.createElement('span');
          text.textContent = bits;
          meta.appendChild(text);
        }
      }
      var apply = row.querySelector('.apply-btn');
      apply.textContent = 'Apply';
      api.setLink(apply, job.url);
      apply.setAttribute('aria-label', 'Apply for ' + job.title + ' at ' + job.company + " (opens the employer's site)");
    });
    if (!filled) return;
    if (state.mode === 'demo' && jobs.length) {
      dummies.slice(jobs.length, ROLES_DEMO_TOTAL).forEach(function (row) { list.appendChild(row); });
    }
    applyEmployerFilter(list, employersDoc ? api.items(employersDoc.items, api.valid.employer, 'employers') : []);
    if (typeof window.__fundsInitFilters === 'function') window.__fundsInitFilters();
    if (typeof window.__fundsPaginateRoles === 'function') {
      var hash = decodeURIComponent(location.hash.slice(1));
      window.__fundsPaginateRoles(/^j_[a-f0-9]{8,32}$/.test(hash) ? hash : null);
    }
  }

  /** Careers page, column 2: the twenty best roles, featured first then newest. Rows link to the employer's own posting. */
  function renderTopJobs(jobsDoc) {
    var jobs = api.items(jobsDoc.items, api.valid.job, 'jobs').slice().sort(function (a, b) {
      return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || String(b.postedAt || '').localeCompare(String(a.postedAt || ''));
    }).slice(0, LIMITS.topJobs);
    slots('top-jobs').forEach(function (ul) {
      fillList(ul, ':scope > li', jobs, function (li, job) {
        var a = li.querySelector('a');
        a.querySelector('.tj-title').textContent = job.title;
        a.querySelector('.tj-co').textContent = [job.company, job.location].filter(Boolean).join(' · ');
        a.title = job.title + ' at ' + job.company;
        api.setLink(a, job.url);
      });
      Array.prototype.forEach.call(ul.querySelectorAll(':scope > li'), function (li, i) {
        var rank = li.querySelector('.tj-rank');
        if (rank) rank.textContent = String(i + 1);
      });
    });
  }

  /** ?employer=emp_... (from a Featured Employers tile) shows only that employer's roles. */
  function applyEmployerFilter(list, employers) {
    var id = new URLSearchParams(location.search).get('employer');
    if (!id || !/^emp_[a-f0-9]{16}$/.test(id)) return;
    var matches = 0;
    children(list, ':scope > [data-fundsae-row]').forEach(function (row) {
      if (row.getAttribute('data-employer') === id) {
        matches++;
        row.removeAttribute('data-fundsae-filtered');
      } else {
        row.setAttribute('data-fundsae-filtered', '');
        row.hidden = true;
      }
    });
    var employer = employers.filter(function (e) { return e.id === id; })[0];
    var name = employer ? employer.name : 'this employer';
    var note = document.createElement('p');
    note.setAttribute('role', 'status');
    note.style.cssText = 'margin: 12px 0 0; font-size: 14px; color: #3D5A5F';
    note.textContent = matches
      ? 'Showing ' + matches + (matches === 1 ? ' role' : ' roles') + ' at ' + name + '. '
      : 'No open roles at ' + name + ' right now. ';
    var all = document.createElement('a');
    all.href = location.pathname + '#opportunities-title';
    all.textContent = 'Show all roles';
    note.appendChild(all);
    list.parentNode.insertBefore(note, list);
  }

  function renderEmployers(doc) {
    var employers = api.items(doc.items, api.valid.employer, 'employers');
    slots('employers').forEach(function (grid) {
      var palette = backgroundsOf(children(grid, ':scope > li .logo'));
      fillList(grid, ':scope > li', employers, function (li, employer, i) {
        var a = li.querySelector('a');
        a.setAttribute('href', '?employer=' + encodeURIComponent(employer.id) + '#opportunities-title');
        var logo = li.querySelector('.logo');
        logo.textContent = employer.initials;
        logo.removeAttribute('role');
        logo.removeAttribute('aria-label');
        logo.setAttribute('aria-hidden', 'true');
        if (palette.length) logo.style.background = palette[i % palette.length];
        li.querySelector('.name').textContent = employer.name;
        var count = li.querySelector('.jobs');
        count.setAttribute('data-fundsae-count', String(employer.openJobs));
        count.textContent = jobCount(employer.openJobs);
      });
    });
  }

  /* ----------------------------------- events ---------------------------------- */

  var monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
  function eventDate(ev) {
    var start = new Date(ev.startDate + 'T00:00:00Z');
    var end = ev.endDate && ev.endDate !== ev.startDate ? new Date(ev.endDate + 'T00:00:00Z') : null;
    var startMonth = monthFmt.format(start);
    if (!end) return { day: String(start.getUTCDate()), month: startMonth };
    var endMonth = monthFmt.format(end);
    return {
      day: start.getUTCDate() + '-' + end.getUTCDate(),
      month: endMonth === startMonth ? startMonth : startMonth + '-' + endMonth
    };
  }

  function renderEvents(doc) {
    var today = api.dubaiToday();
    var upcoming = api.items(doc.items, api.valid.event, 'events').filter(function (ev) {
      return (ev.endDate || ev.startDate) >= today;
    }).slice(0, LIMITS.eventsPerList);
    slots('events').forEach(function (list) {
      fillList(list, ':scope > li', upcoming, function (li, ev) {
        var when = eventDate(ev);
        // Careers page rows use classes; the home page rows are styled inline.
        var day = li.querySelector('.day') || li.querySelector(':scope > div:first-child > span:first-child');
        var month = li.querySelector('.month') || li.querySelector(':scope > div:first-child > span:last-child');
        var type = li.querySelector('.event-type') || li.querySelector(':scope > div:nth-child(2) a');
        var city = li.querySelector('.city') || li.querySelector(':scope > div:nth-child(2) span');
        if (day) day.textContent = when.day;
        if (month) month.textContent = when.month;
        if (type) {
          type.textContent = ev.eventType;
          type.title = ev.title + (ev.venue ? ', ' + ev.venue : '');
          if (type.tagName === 'A') api.setLink(type, ev.url, { httpsOnly: true });
        }
        if (city) city.textContent = ev.city;
      });
    });
  }

  /* ---------------------------------- sponsors --------------------------------- */

  function renderSponsors(doc) {
    var s = doc.slots || {};
    var pick = function (name) { return api.items(s[name], api.valid.sponsorItem, name + ' items'); };

    slots('sponsor-platinum').forEach(function (box) {
      fillList(box, ':scope > a', pick('platinum'), function (a, item) {
        a.textContent = item.title;
        a.setAttribute('aria-label', 'Platinum sponsor: ' + item.title);
        var from = api.hex(item.colorFrom);
        var to = api.hex(item.colorTo);
        if (from && to) a.style.background = 'linear-gradient(145deg, ' + from + ', ' + to + ')';
        sponsorLink(a, item);
      });
    });

    slots('sponsor-gold').forEach(function (box) {
      fillList(box, ':scope > a', pick('gold'), function (a, item) {
        a.textContent = item.title;
        a.setAttribute('aria-label', 'Gold sponsor: ' + item.title);
        var from = api.hex(item.colorFrom);
        var to = api.hex(item.colorTo);
        var image = api.imageUrl(item.image);
        if (image) a.style.background = 'url("' + image + '") center / cover no-repeat';
        else if (from && to) a.style.background = 'linear-gradient(145deg, ' + from + ', ' + to + ')';
        sponsorLink(a, item);
      });
    });

    slots('sponsor-posts').forEach(function (list) {
      fillList(list, ':scope > li', pick('sponsoredPosts'), function (li, item) {
        logoBox(li.querySelector(':scope > span'), item, false);
        var a = li.querySelector('a');
        a.textContent = item.title;
        if (item.blurb) a.title = item.blurb; else a.removeAttribute('title');
        sponsorLink(a, item);
      });
    });

    slots('sponsor-media').forEach(function (list) {
      fillList(list, ':scope > a', pick('sponsoredMedia'), function (a, item) {
        var spans = a.querySelectorAll(':scope > span');
        spans[spans.length - 1].textContent = item.title;
        var hint = [item.label, item.blurb].filter(Boolean).join(': ');
        if (hint) a.title = hint; else a.removeAttribute('title');
        sponsorLink(a, item);
      });
    });

    slots('sponsor-companies').forEach(function (list) {
      fillList(list, ':scope > a', pick('professionalServices'), function (a, item) {
        logoBox(a.querySelector(':scope > div'), item, true);
        var lines = a.querySelectorAll(':scope > span > span');
        if (lines[0]) lines[0].textContent = item.title;
        if (lines[1]) lines[1].textContent = item.website || '';
        sponsorLink(a, item);
      });
    });

    slots('career-resources').forEach(function (list) {
      fillList(list, ':scope > a', pick('careerResources'), function (a, item) {
        logoBox(a.querySelector(':scope > div, .logo'), item, true);
        var label = a.querySelector('.label') || a.querySelector(':scope > span');
        if (label) label.textContent = item.title;
        sponsorLink(a, item);
      });
    });
  }

  /* ------------------------------------ main ----------------------------------- */

  function guard(label, promise) {
    return promise.catch(function (err) {
      api.warn(label + ' could not be loaded; keeping the built-in content', err);
    });
  }

  function run() {
    api.meta().then(function (meta) {
      state.mode = meta.mode === 'live' ? 'live' : 'demo';
      document.documentElement.setAttribute('data-fundsae-connected', state.mode);
      renderDate();
      renderBadge();

      if (hasSlot('news')) guard('News', load('news.json', 'news').then(function (doc) { renderNews(doc); bindSearch(); }));
      if (hasSlot('tiles-real-estate-infrastructure')) {
        guard('Real estate stories', load('news/sections/real-estate-infrastructure.json', 'news').then(function (doc) { renderTiles('tiles-real-estate-infrastructure', doc, TILES_SHOWN); }));
      }
      if (hasSlot('tiles-energy')) {
        guard('Energy stories', load('news/sections/energy.json', 'news').then(function (doc) { renderTiles('tiles-energy', doc, TILES_SHOWN); }));
      }
      if (hasSlot('tiles-ai-technology')) {
        guard('AI and technology stories', load('news/sections/ai-technology.json', 'news').then(function (doc) { renderTiles('tiles-ai-technology', doc, TILES_SHOWN); }));
      }
      if (hasSlot('tiles-grants-funding')) {
        guard('Grants stories', load('news/sections/grants-funding.json', 'news').then(function (doc) { renderTiles('tiles-grants-funding', doc, TILES_SHOWN); }));
      }
      if (hasSlot('home-jobs')) guard('Jobs', load('jobs.json', 'jobs').then(renderHomeJobs));
      if (hasSlot('employers')) guard('Employers', load('employers.json', 'employers').then(renderEmployers));
      if (hasSlot('roles') || hasSlot('top-jobs')) {
        guard('Roles', Promise.all([
          load('jobs.json', 'jobs'),
          load('employers.json', 'employers').catch(function () { return null; })
        ]).then(function (docs) { renderRoles(docs[0], docs[1]); renderTopJobs(docs[0]); }));
      }
      if (hasSlot('events')) guard('Events', load('events.json', 'events').then(renderEvents));
      var sponsorSlots = ['sponsor-platinum', 'sponsor-gold', 'sponsor-posts', 'sponsor-media', 'sponsor-companies', 'career-resources'];
      if (sponsorSlots.some(hasSlot)) guard('Sponsors', load('sponsors.json', 'sponsors').then(renderSponsors));
    }).catch(function (err) {
      api.warn('The API could not be reached; the page keeps its built-in content', err);
    });
  }

  // Dynamic text that i18n.js cannot translate by exact match: redo it after a language switch.
  api.onLanguageChange(function () {
    renderDate();
    document.querySelectorAll('[data-fundsae-count]').forEach(function (node) {
      node.textContent = jobCount(Number(node.getAttribute('data-fundsae-count')));
    });
  });

  api.ready(run);
})();
