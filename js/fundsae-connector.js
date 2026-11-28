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

  var LIMITS = { newsPerRegion: 15, newsMore: 35, headline: 92, tileHeadline: 110, tiles: 15, eventsPerList: 10, eventsMax: 100, topJobs: 20, topEmployers: 20 };
  var ROLES_DEMO_TOTAL = 120; // Careers page, demo mode: live roles are topped up with dummy roles to this many (3 pages of PER_PAGE = 40 in Careers.dc.html)
  var TILES_SHOWN = 12; // Residential, Commercial Real Estate, Infrastructure and Special & Alternative boxes
  // Home news tabs, each in the API's order: UAE Stories (key "News"), GCC Stories ("GCC": the other five GCC states,
  // no UAE) and International Stories ("Global": no GCC country). regionOf() puts every story in exactly one tab.
  var REGIONS = { uae: 'News', world: 'Global' };
  var NEWS_REGIONS = ['News', 'GCC', 'Global'];
  var GCC_GEOGRAPHIES = ['saudi-arabia', 'gcc'];
  var GCC_WORDS = /\b(saudi|ksa|riyadh|jeddah|dammam|qatar|qatari|doha|kuwait|kuwaiti|bahrain|bahraini|manama|oman|omani|muscat|gcc)\b/i;

  /**
   * Which home tab a story belongs to. By the editors' geography: UAE first, then Saudi Arabia / other GCC, else
   * International. A story without geography: a "uae" story stays UAE, a world story that names a GCC state is GCC.
   */
  function regionOf(story) {
    var geo = (Array.isArray(story.geography) ? story.geography : []).map(function (g) { return g && g.id; });
    if (geo.indexOf('uae') !== -1) return 'News';
    if (geo.some(function (id) { return GCC_GEOGRAPHIES.indexOf(id) !== -1; })) return 'GCC';
    if (geo.length) return 'Global';
    if (story.category === 'uae') return 'News';
    return GCC_WORDS.test(story.headline || '') ? 'GCC' : (REGIONS[story.category] || 'Global');
  }
  var EMPTY_TEXT = 'Nothing to show yet. Check back soon.';
  var NAV_ID = /^[a-z0-9][a-z0-9-]{0,60}$/; // a Capital Type id, as used in "capital:<id>" news topics
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
    return api.setLink(a, item.url, { sponsored: item.sponsored, httpsOnly: true });
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
  // data-news-region equals the active tab ("News" / "Global") every 250 ms.
  // Articles the connector wants hidden therefore get a region value that never
  // matches a tab; the page's own placeholders get "placeholder".

  // topics/topicLabel: the category bar's filter (this.html dispatches "fundsae:news-topics"); null shows every story.
  var newsView = { query: '', expanded: {}, topics: null, topicLabel: '' };

  function inTopics(art) {
    if (!newsView.topics) return true;
    return art.getAttribute('data-fundsae-topics').split(' ').some(function (t) { return newsView.topics.indexOf(t) !== -1; });
  }

  function applyNewsVisibility(news) {
    var query = newsView.query;
    var totals = {};
    var matches = 0;
    news.querySelectorAll('[data-fundsae-story]').forEach(function (art) {
      var region = art.getAttribute('data-fundsae-region');
      var wanted = inTopics(art);
      // Position among the stories the category filter keeps, so each category shows its first 15.
      var index = wanted ? (totals[region] || 0) : -1;
      if (wanted) totals[region] = index + 1;
      art.setAttribute('data-fundsae-index', String(index));
      var visible = wanted && (query
        ? art.getAttribute('data-fundsae-text').indexOf(query) !== -1
        : newsView.expanded[region] || index < LIMITS.newsPerRegion);
      if (visible && query) matches++;
      art.setAttribute('data-news-region', visible ? region : region + ':hidden');
    });
    news.querySelectorAll('[data-fundsae-more]').forEach(function (link) {
      var region = link.getAttribute('data-fundsae-more');
      var show = !query && !newsView.expanded[region] && (totals[region] || 0) > LIMITS.newsPerRegion;
      link.setAttribute('data-more-news-region', show ? region : region + ':none');
    });
    var status = news.querySelector('[data-fundsae-search-status]');
    var label = newsView.topicLabel;
    news.querySelectorAll('[data-fundsae-filter-empty]').forEach(function (row) {
      var region = row.getAttribute('data-fundsae-filter-empty');
      var empty = newsView.topics && !query && !totals[region];
      row.querySelector('p').textContent = empty ? 'No ' + label + ' stories here yet. Check back soon.' : '';
      row.setAttribute('data-news-region', empty ? region : region + ':hidden');
    });
    if (status) {
      status.textContent = query
        ? (matches ? matches + (matches === 1 ? ' story matches' : ' stories match') + ' "' + query + '"' : 'No stories match "' + query + '"') + (newsView.topics ? ' in ' + label + '.' : '.')
        : newsView.topics ? 'Showing ' + label + ' stories.' : '';
      status.style.display = query || newsView.topics ? '' : 'none';
    }
  }

  document.addEventListener('fundsae:news-topics', function (event) {
    var detail = event.detail;
    newsView.topics = detail && Array.isArray(detail.topics) ? detail.topics.map(String) : null;
    newsView.topicLabel = newsView.topics ? String(detail.label || '') : '';
    newsView.expanded = {};
    var news = slots('news')[0];
    if (news) applyNewsVisibility(news);
  });

  /**
   * Top story of each home news tab (slot "top-story", data-top-region News / GCC / Global): that tab's featured
   * story, else its newest; for UAE the editors' pin (Sanity Site settings) comes first. The sample picture stays
   * unless the publisher allows its image. Live mode with no story for a tab hides that tab's section.
   */
  function renderTopUae(stories) {
    slots('top-story').forEach(function (box) {
      var region = box.getAttribute('data-top-region');
      if (NEWS_REGIONS.indexOf(region) === -1) return;
      var inTab = stories.filter(function (s) { return regionOf(s) === region; });
      var pinned = region === 'News' && siteSettings.topUaeStoryId && inTab.filter(function (s) { return s.id === siteSettings.topUaeStoryId; })[0];
      var story = pinned || inTab.filter(function (s) { return s.featured; })[0] || inTab[0];
      if (!story) { if (state.mode === 'live') box.hidden = true; return; }
      var page = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(story.slug || '') ? 'news/' + story.slug + '.html' : null;
      var link = function (a) { if (page) a.href = page; else api.setLink(a, story.url); };
      var title = box.querySelector('.fx-top-uae-title a');
      if (title) { title.textContent = story.headline; link(title); }
      var media = box.querySelector('.fx-top-uae-media');
      if (media) {
        link(media);
        var picture = api.imageUrl(story.imageUrl);
        var img = media.querySelector('img');
        if (picture && img) { img.src = picture; img.referrerPolicy = 'no-referrer'; }
      }
      var asset = Array.isArray(story.assetClasses) && story.assetClasses[0] && story.assetClasses[0].label;
      var kicker = box.querySelector('.fx-top-uae-kicker');
      if (kicker) kicker.textContent = asset || story.topicLabel || '';
      var sum = box.querySelector('.fx-top-uae-sum');
      if (sum) { if (story.summary) sum.textContent = truncate(story.summary, 220); else sum.remove(); }
      var src = box.querySelector('.fx-top-uae-src');
      var when = !isNaN(Date.parse(story.publishedAt)) ? new Date(story.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }) : '';
      if (src) src.textContent = 'Source: ' + story.source + (when ? ' \u00b7 ' + when : '');
      box.hidden = false;
    });
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

    lastStories = stories;
    renderTopUae(stories);

    var moreLink = news.querySelector('[data-more-news-region]');
    var anchor = moreLink ? moreLink.parentElement : null;
    var byRegion = {};
    var addTo = function (region, story) { (byRegion[region] = byRegion[region] || []).push(story); };
    stories.forEach(function (s) { addTo(regionOf(s), s); });

    NEWS_REGIONS.forEach(function (region) {
      var list = (byRegion[region] || []).slice(0, LIMITS.newsPerRegion + LIMITS.newsMore);
      var filtered = document.createElement('article');
      filtered.setAttribute('data-fundsae-row', '');
      filtered.setAttribute('data-fundsae-filter-empty', region);
      filtered.setAttribute('data-news-region', region + ':hidden');
      var fp = document.createElement('p');
      fp.style.cssText = 'margin: 12px 0; font-size: 14px; color: #62797D';
      filtered.appendChild(fp);
      // Only for a tab that has stories; an empty tab already shows EMPTY_TEXT.
      if (list.length) news.insertBefore(filtered, anchor);
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
        art.setAttribute('data-fundsae-row', '');
        art.setAttribute('data-fundsae-story', story.id);
        art.setAttribute('data-fundsae-region', region);
        art.setAttribute('data-fundsae-index', String(i));
        // Topics, plus "capital:<id>" for each Capital Type an editor gave the story (the category bar filters on those).
        var capital = (Array.isArray(story.capitalTypes) ? story.capitalTypes : [])
          .filter(function (c) { return c && NAV_ID.test(c.id); })
          .map(function (c) { return 'capital:' + c.id; });
        art.setAttribute('data-fundsae-topics', [story.topic].concat(story.topics || [], capital).join(' '));
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
  // Home "Alternative Real Estate News" box: one box for the Infrastructure and Special & Alternative page sections.
  var ALTERNATIVE_SECTIONS = ['special-alternative-real-estate', 'infrastructure'];

  /**
   * The home page's real estate boxes show UAE stories only (as the UAE Stories tab: regionOf). The Real Estate News
   * page keeps every story of its sections.
   */
  function uaeOnly(doc) {
    var items = doc && Array.isArray(doc.items) ? doc.items : [];
    return { items: items.filter(function (s) { return s && typeof s === 'object' && regionOf(s) === 'News'; }) };
  }

  /** Several story lists as one: each story once, newest first. */
  function mergeStoryDocs(docs) {
    var seen = {};
    var items = [];
    docs.forEach(function (doc) {
      (doc && Array.isArray(doc.items) ? doc.items : []).forEach(function (story) {
        if (!story || seen[story.id]) return;
        seen[story.id] = true;
        items.push(story);
      });
    });
    items.sort(function (a, b) { return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0); });
    return { items: items };
  }

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
        // Real estate boxes carry a small source line under the headline (see frontend_demo/this.html).
        var source = art.querySelector('.fx-tile-source');
        if (source) source.textContent = 'Source: ' + story.source;
      });
      if (padTo && state.mode === 'demo' && stories.length) {
        dummies.slice(stories.length, padTo).forEach(function (tile) { box.appendChild(tile); });
      }
    });
  }

  /* ------------------------------------ jobs ----------------------------------- */

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

  // Main Gulf cities for the Careers Location filter: [pattern in the free-form location text, city, country code].
  var GULF_CITIES = [
    [/abu dhabi|adgm/, 'Abu Dhabi', 'AE'], [/dubai|difc/, 'Dubai', 'AE'], [/sharjah/, 'Sharjah', 'AE'], [/ajman/, 'Ajman', 'AE'],
    [/ras al[ -]khaimah|\brak\b/, 'Ras Al Khaimah', 'AE'], [/fujairah/, 'Fujairah', 'AE'], [/umm al[ -]quwain/, 'Umm Al Quwain', 'AE'],
    [/riyadh/, 'Riyadh', 'SA'], [/jeddah|jiddah/, 'Jeddah', 'SA'], [/dammam|khobar|dhahran/, 'Dammam', 'SA'],
    [/doha|qatar/, 'Doha', 'QA'], [/kuwait/, 'Kuwait City', 'KW'], [/manama|bahrain/, 'Manama', 'BH'], [/muscat|oman/, 'Muscat', 'OM']
  ];
  var GULF_COUNTRIES = [[/\buae\b|emirates/, 'AE'], [/saudi|\bksa\b/, 'SA']];

  // Finance job functions for the Careers Function filter: [pattern in "department | title", label], first match wins
  // (so "Credit Risk Analyst" is Risk Management). Labels equal FUNCTIONS in Careers.dc.html.
  var JOB_FUNCTIONS = [
    [/\besg\b|sustainab|impact invest|climate/, 'ESG & Sustainable Finance'],
    [/complian|regulat|\baml\b|\bkyc\b|financial crime/, 'Compliance & Regulatory'],
    [/legal|counsel|lawyer|paralegal/, 'Legal'],
    [/\brisk\b/, 'Risk Management'],
    [/treasur/, 'Treasury'],
    [/\btax/, 'Tax'],
    [/audit/, 'Audit'],
    [/investor relations|fundrais|capital raising/, 'Investor Relations & Fundraising'],
    [/fund admin|fund account|operations|onboarding|settlement|middle office|back office|custody/, 'Fund Administration & Operations'],
    [/private equity|buyout/, 'Private Equity'],
    [/venture|\bvc\b/, 'Venture Capital'],
    [/credit|debt|lending|\bloans?\b/, 'Private Credit & Debt'],
    [/real estate|property|infrastructure|\breits?\b/, 'Real Estate & Infrastructure'],
    [/trading|trader|hedge fund|quant|systematic|multi-strategy/, 'Hedge Funds & Trading'],
    [/corporate development|corporate finance|m&a|mergers|investment bank|capital markets/, 'Investment Banking & Corporate Finance'],
    [/wealth|private bank|client advisory|relationship manager|family office/, 'Wealth & Private Banking'],
    [/research|economist|strategist/, 'Research & Analysis'],
    [/fintech|platform|product|engineer|developer|\bdata\b|technology|digital|\bit\b/, 'Fintech & Technology'],
    [/business development|\bsales\b|distribution/, 'Sales & Business Development'],
    [/\bfinance\b|account|controller|\bcfo\b|financial report|fp&a/, 'Finance & Accounting'],
    [/invest|portfolio|asset management|fund manager|analyst|associate/, 'Investments & Portfolio Management']
  ];

  /** Finance function for the Careers Function filter, from the job's department and title ('' when none fits). */
  function functionOf(department, title) {
    var text = (String(department || '') + ' | ' + String(title || '')).toLowerCase();
    for (var i = 0; i < JOB_FUNCTIONS.length; i++) if (JOB_FUNCTIONS[i][0].test(text)) return JOB_FUNCTIONS[i][1];
    return '';
  }

  /** City for the Location filter: the API's location text is free-form ("DIFC, Dubai", "Riyadh, KSA", "Remote - UAE"). */
  function cityOf(location) {
    var l = String(location || '').toLowerCase();
    if (/remote/.test(l)) return 'Remote';
    for (var i = 0; i < GULF_CITIES.length; i++) if (GULF_CITIES[i][0].test(l)) return GULF_CITIES[i][1];
    return '';
  }

  /** Gulf country code (AE, SA, QA, KW, BH, OM) for the Location filter's "All <country>" choices, or ''. */
  function countryOf(location) {
    var l = String(location || '').toLowerCase();
    for (var i = 0; i < GULF_CITIES.length; i++) if (GULF_CITIES[i][0].test(l)) return GULF_CITIES[i][2];
    for (var j = 0; j < GULF_COUNTRIES.length; j++) if (GULF_COUNTRIES[j][0].test(l)) return GULF_COUNTRIES[j][1];
    return '';
  }

  var JOB_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var salaryFmt = new Intl.NumberFormat('en-US');
  /** The job's own page, for jobs posted through Sanity (frontend_demo/jobs/<slug>.html). */
  function jobPageHref(job) {
    return job.slug && JOB_SLUG.test(job.slug) ? 'jobs/' + job.slug + '.html' : null;
  }
  /** "AED 25,000–35,000 / month" */
  function salaryText(s) {
    if (!s || typeof s.from !== 'number') return '';
    var range = typeof s.to === 'number' && s.to !== s.from ? salaryFmt.format(s.from) + '–' + salaryFmt.format(s.to) : salaryFmt.format(s.from);
    return [s.currency, range].filter(Boolean).join(' ') + (s.period ? ' / ' + s.period : '');
  }
  /** Puts the employer's logo (https only, never sending the page address) into a logo tile. False when there is none. */
  function setLogoImage(tile, url, name) {
    var src = api.httpUrl(url, true);
    if (!src) return false;
    tile.textContent = '';
    var img = document.createElement('img');
    img.src = src;
    img.alt = name + ' logo';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#fff;border-radius:inherit';
    tile.style.background = '#fff';
    tile.appendChild(img);
    return true;
  }
  /** The editors' order (careers.json) when they picked one, otherwise the automatic order. */
  function pickedOrder(list, ids) {
    if (!Array.isArray(ids) || !ids.length) return list;
    var byId = {};
    list.forEach(function (item) { byId[item.id] = item; });
    return ids.map(function (id) { return byId[id]; }).filter(Boolean);
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
      row.setAttribute('data-country', countryOf(job.location));
      row.setAttribute('data-department', job.department || '');
      row.setAttribute('data-function', functionOf(job.department, job.title));
      row.setAttribute('data-posted', job.postedAt || '');
      row.setAttribute('data-featured', job.featured ? '1' : '0');
      // Jobs posted through Sanity have their own page (jobs/<slug>.html); the title links to it.
      var heading = row.querySelector('h2');
      heading.textContent = '';
      var page = jobPageHref(job);
      if (page) {
        var titleLink = document.createElement('a');
        titleLink.href = page;
        titleLink.textContent = job.title;
        heading.appendChild(titleLink);
      } else {
        heading.textContent = job.title;
      }
      row.querySelector('.company').textContent = job.company;
      // The employer's logo from Sanity, or a dummy logo: initials on a colour from the company name
      // (window.__fundsRoleLogo, Careers.dc.html).
      var logo = row.querySelector('.role-logo');
      if (logo) {
        var look = typeof window.__fundsRoleLogo === 'function' ? window.__fundsRoleLogo(job.company) : { text: initials(job.company) };
        if (!setLogoImage(logo, job.logoUrl, job.company)) {
          logo.textContent = look.text;
          if (look.colours) logo.style.background = 'linear-gradient(145deg, ' + look.colours + ')';
        }
      }
      row.querySelector('.location').textContent = [job.location, job.employmentType].filter(Boolean).join(' · ');
      var meta = row.querySelector('.role-meta');
      if (meta) {
        meta.textContent = '';
        var pay = [salaryText(job.salary), job.visa].filter(Boolean).join(' · ');
        if (pay) {
          var payLine = document.createElement('span');
          payLine.className = 'role-pay';
          payLine.textContent = pay;
          meta.appendChild(payLine);
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
      dummies.slice(jobs.length, ROLES_DEMO_TOTAL).forEach(function (row) {
        // Demo roles carry their place in the location line ("Family office, Abu Dhabi"): tag them for the Location filter.
        var where = row.querySelector('.location');
        if (where && !row.hasAttribute('data-city')) {
          row.setAttribute('data-city', cityOf(where.textContent));
          row.setAttribute('data-country', countryOf(where.textContent));
        }
        var titleEl = row.querySelector('h2');
        if (titleEl && !row.hasAttribute('data-function')) row.setAttribute('data-function', functionOf('', titleEl.textContent));
        list.appendChild(row);
      });
    }
    applyEmployerFilter(list, employersDoc ? api.items(employersDoc.items, api.valid.employer, 'employers') : []);
    if (typeof window.__fundsInitFilters === 'function') window.__fundsInitFilters();
    if (typeof window.__fundsPaginateRoles === 'function') {
      var hash = decodeURIComponent(location.hash.slice(1));
      window.__fundsPaginateRoles(/^j_[a-f0-9]{8,32}$/.test(hash) ? hash : null);
    }
  }

  /** Careers page, column 2: the twenty best roles, featured first then newest. Rows link to the employer's own posting. */
  function renderTopJobs(jobsDoc, careersDoc) {
    var all = api.items(jobsDoc.items, api.valid.job, 'jobs');
    var automatic = all.slice().sort(function (a, b) {
      return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || String(b.postedAt || '').localeCompare(String(a.postedAt || ''));
    });
    // Hand-picked in the Studio (careers.json), in the editors' order; otherwise featured first, then newest.
    var jobs = pickedOrder(automatic, careersDoc && careersDoc.topJobs).slice(0, LIMITS.topJobs);
    slots('top-jobs').forEach(function (ul) {
      fillList(ul, ':scope > li', jobs, function (li, job) {
        var a = li.querySelector('a');
        a.querySelector('.tj-title').textContent = job.title;
        a.querySelector('.tj-co').textContent = [job.company, job.location].filter(Boolean).join(' · ');
        a.title = job.title + ' at ' + job.company;
        var page = jobPageHref(job);
        if (page) {
          a.href = page;
          a.removeAttribute('target');
          a.removeAttribute('rel');
        } else {
          api.setLink(a, job.url);
        }
      });
      Array.prototype.forEach.call(ul.querySelectorAll(':scope > li'), function (li, i) {
        var rank = li.querySelector('.tj-rank');
        if (rank) rank.textContent = String(i + 1);
      });
    });
  }

  /** ?employer=emp_... (from a Top Employers row) shows only that employer's roles. */
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

  /** Careers page, column 2: Top Employers (logo tile, name, open roles), in employers.json order (featured first, then most open roles). Each row
   *  opens the page filtered to that employer's roles (see applyEmployerFilter). */
  function renderEmployers(doc, careersDoc) {
    // Hand-picked in the Studio (careers.json), in the editors' order; otherwise featured first, then most open roles.
    var employers = pickedOrder(api.items(doc.items, api.valid.employer, 'employers'), careersDoc && careersDoc.topEmployers).slice(0, LIMITS.topEmployers);
    slots('employers').forEach(function (list) {
      var palette = backgroundsOf(children(list, ':scope > li .te-logo'));
      fillList(list, ':scope > li', employers, function (li, employer, i) {
        var a = li.querySelector('a');
        a.setAttribute('href', '?employer=' + encodeURIComponent(employer.id) + '#opportunities-title');
        a.title = employer.description ? employer.name + ': ' + employer.description : 'Open roles at ' + employer.name;
        li.querySelector('.tj-rank').textContent = String(i + 1);
        var logo = li.querySelector('.te-logo');
        if (logo && !setLogoImage(logo, employer.logoUrl, employer.name)) {
          logo.textContent = employer.initials;
          if (palette.length) logo.style.background = palette[i % palette.length];
        }
        li.querySelector('.tj-title').textContent = employer.name;
        var count = li.querySelector('.tj-co');
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
    });
    // Home page highlight card: the first upcoming event marked featured, else the next one. A list in the same box
    // then starts after it, so the highlighted event is not shown twice.
    var highlight = upcoming.filter(function (ev) { return ev.featured; })[0] || upcoming[0] || null;
    slots('events-feature').forEach(function (card) {
      if (!highlight) {
        if (state.mode === 'live') card.hidden = true;
        return;
      }
      var when = eventDate(highlight);
      // "28 Oct \u2013 1 Nov" when the event spans two months, else "2-6 Nov".
      var days = when.day.split('-');
      var months = when.month.split('-');
      var dateText = months.length === 2 && days.length === 2
        ? days[0] + ' ' + months[0] + ' \u2013 ' + days[1] + ' ' + months[1]
        : when.day + ' ' + when.month;
      var title = card.querySelector('.fx-event-feature-title');
      if (title) title.textContent = highlight.title;
      var meta = card.querySelector('.fx-event-feature-meta');
      if (meta) meta.textContent = [dateText, highlight.city, highlight.eventType].filter(Boolean).join(' \u00b7 ');
      card.setAttribute('aria-label', 'Featured event: ' + highlight.title);
      // Its own page when it has one, otherwise the Events page.
      if (!api.setLink(card, highlight.url, { httpsOnly: true })) card.setAttribute('href', 'Events.dc.html');
    });
    slots('events').forEach(function (list) {
      // The home page box shows the next few; the Events page asks for more with data-fundsae-limit.
      var limit = parseInt(list.getAttribute('data-fundsae-limit'), 10);
      limit = limit > 0 ? Math.min(limit, LIMITS.eventsMax) : LIMITS.eventsPerList;
      var box = list.closest('section');
      var rows = highlight && box && box.querySelector('[data-fundsae-slot="events-feature"]')
        ? upcoming.filter(function (ev) { return ev !== highlight; })
        : upcoming;
      fillList(list, ':scope > li', rows.slice(0, limit), function (li, ev) {
        var when = eventDate(ev);
        // Events page rows use classes; the home page rows are styled inline.
        var day = li.querySelector('.day') || li.querySelector(':scope > div:first-child > span:first-child');
        var month = li.querySelector('.month') || li.querySelector(':scope > div:first-child > span:last-child');
        var name = li.querySelector('.event-title');
        var type = li.querySelector('.event-type') || li.querySelector(':scope > div:nth-child(2) a');
        var city = li.querySelector('.city') || li.querySelector(':scope > div:nth-child(2) span');
        if (day) day.textContent = when.day;
        if (month) month.textContent = when.month;
        if (name) {
          name.textContent = ev.title;
          if (name.tagName === 'A') api.setLink(name, ev.url, { httpsOnly: true });
        }
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

    // Elite Founding Sponsor banner. With no sponsor it keeps its "Your firm here" advert in every
    // mode (that advert is ours, not demo data), so it never shows the "nothing yet" note.
    slots('sponsor-founding').forEach(function (banner) {
      var item = pick('founding')[0];
      if (!item || !item.title) return;
      banner.classList.add('is-sponsor');
      banner.setAttribute('aria-label', 'Elite Founding Sponsor: ' + item.title);
      var status = banner.querySelector('.fx-founding-status');
      if (status) status.remove();
      var name = banner.querySelector('.fx-founding-name');
      if (name) {
        name.textContent = item.title;
        var image = api.imageUrl(item.image);
        if (image) {
          var logo = document.createElement('span');
          logo.className = 'fx-founding-logo';
          logo.setAttribute('aria-hidden', 'true');
          logo.style.backgroundImage = 'url("' + image + '")';
          name.parentNode.insertBefore(logo, name);
        }
      }
      var pitch = banner.querySelector('.fx-founding-pitch');
      if (pitch) {
        if (item.blurb) pitch.textContent = item.blurb;
        else pitch.remove();
      }
      var cta = banner.querySelector('.fx-founding-cta');
      if (cta) {
        var ctaText = cta.querySelector('span');
        if (ctaText) ctaText.textContent = api.tr('Learn more');
        if (!sponsorLink(cta, item)) cta.remove();
      }
    });

    // Spotlight (home page): picture tiles. A sponsor's own image wins; then the page's dummy picture for that sponsor id
    // (data-partner); then the dummy pictures in turn; then the sponsor's colours.
    slots('sponsor-platinum').forEach(function (box) {
      var dummies = children(box, ':scope > a > .fx-platinum-img');
      var pictures = dummies.map(function (n) { return n.style.backgroundImage; }).filter(Boolean);
      var byId = {};
      dummies.forEach(function (n) { if (n.dataset.partner && n.style.backgroundImage) byId[n.dataset.partner] = n.style.backgroundImage; });
      fillList(box, ':scope > a', pick('platinum'), function (a, item, i) {
        var name = a.querySelector('.fx-platinum-name') || a;
        name.textContent = item.title;
        a.setAttribute('aria-label', 'Gold partner: ' + item.title);
        var picture = a.querySelector('.fx-platinum-img') || a;
        var image = api.imageUrl(item.image);
        var from = api.hex(item.colorFrom);
        var to = api.hex(item.colorTo);
        if (image) picture.style.backgroundImage = 'url("' + image + '")';
        else if (Object.prototype.hasOwnProperty.call(byId, item.id)) picture.style.backgroundImage = byId[item.id];
        else if (pictures.length) picture.style.backgroundImage = pictures[i % pictures.length];
        else if (from && to) picture.style.background = 'linear-gradient(145deg, ' + from + ', ' + to + ')';
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
        // The kind of resource (Article, Guide, Career tip, External link), as a small label under the title.
        var kind = a.querySelector('.kind');
        if (item.resourceType) {
          if (!kind) {
            kind = document.createElement('small');
            kind.className = 'kind';
            kind.style.cssText = 'display:block;margin-top:2px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#62797D';
            (label || a).appendChild(kind);
          }
          kind.textContent = item.resourceType;
        } else if (kind) {
          kind.remove();
        }
        sponsorLink(a, item);
      });
    });
  }

  /* ------------------------- editorial content (Sanity) ------------------------ */
  // content.json is written from the Sanity Studio. Advertise packages and page copy are
  // our own text, so with nothing published the page keeps its built-in version in every mode.

  function appendText(node, text, small) {
    if (!small) { node.textContent = text; return; }
    node.textContent = text + ' ';
    var note = document.createElement('small');
    note.textContent = small;
    node.appendChild(note);
  }

  function fillLines(ul, lines) {
    if (!ul) return;
    ul.textContent = '';
    lines.forEach(function (line) {
      var li = document.createElement('li');
      li.textContent = line;
      ul.appendChild(li);
    });
  }

  /** Home "Top Tweets": avatar initials, account name, @handle, our one-line summary, link to the post. */
  function renderHighlights(items) {
    slots('social-highlights').forEach(function (list) {
      fillList(list, ':scope > a', items, function (a, item) {
        var avatar = a.querySelector(':scope > span:first-child');
        if (avatar) {
          avatar.textContent = item.initials;
          avatar.removeAttribute('role');
          avatar.removeAttribute('aria-label');
          avatar.setAttribute('aria-hidden', 'true');
          var color = api.hex(item.color);
          if (color) avatar.style.background = color;
        }
        var body = a.querySelector(':scope > span:last-child');
        if (body && body !== avatar) {
          var handleTemplate = body.querySelector('span');
          body.textContent = '';
          var name = document.createElement('strong');
          name.textContent = item.accountName;
          var handle = handleTemplate ? handleTemplate.cloneNode(false) : document.createElement('span');
          handle.textContent = '@' + item.handle;
          body.appendChild(name);
          body.appendChild(document.createTextNode(' '));
          body.appendChild(handle);
          body.appendChild(document.createElement('br'));
          body.appendChild(document.createTextNode(item.text));
        }
        a.setAttribute('aria-label', item.accountName + ' (@' + item.handle + ') on X: ' + item.text);
        api.setLink(a, item.url, { httpsOnly: true });
      });
    });
  }

  /** Partner with us page: one card per package, in the published order (editors add, hide and reorder packages in
   *  Sanity). The "exclusive" package is the dark card and carries id="elite-partner", which the Elite Founding
   *  Sponsor banner links to. */
  function renderTiers(tiers) {
    if (!tiers.length) return;
    slots('advertise-tiers').forEach(function (box) {
      fillList(box, ':scope > .tier', tiers, function (card, tier) {
        var exclusive = tier.id === 'exclusive';
        card.classList.toggle('featured', tier.featured);
        card.classList.toggle('exclusive', exclusive);
        if (exclusive) card.id = 'elite-partner';
        var badge = card.querySelector('.badge');
        if (badge) {
          badge.textContent = tier.badge || '';
          badge.hidden = !tier.badge;
        }
        var title = card.querySelector('h2');
        if (title) title.textContent = tier.name;
        var price = card.querySelector('.price');
        if (price) {
          appendText(price, tier.price, tier.priceNote);
          price.hidden = !tier.showPrice;
        }
        var duration = card.querySelector('.duration');
        if (duration) {
          duration.textContent = tier.duration || '';
          duration.hidden = !tier.duration;
        }
        // Home page placements switched on for this package: label, then what the partner gets.
        var placements = card.querySelector('ul.placements');
        if (placements) {
          placements.textContent = '';
          tier.placements.forEach(function (p) {
            var li = document.createElement('li');
            li.setAttribute('data-placement', p.type);
            var text = document.createElement('span');
            var label = document.createElement('strong');
            label.textContent = api.tr(p.label);
            var detail = document.createElement('span');
            detail.className = 'detail';
            detail.textContent = p.detail;
            text.appendChild(label);
            text.appendChild(detail);
            li.appendChild(text);
            placements.appendChild(li);
          });
          placements.hidden = !tier.placements.length;
        }
        var features = card.querySelector('ul.features') || card.querySelector('ul');
        fillLines(features, tier.features);
        if (features) features.hidden = !tier.features.length;
        var cta = card.querySelector('[data-fundsae-tier]');
        if (cta) {
          var label = tier.ctaLabel || api.tr(exclusive ? 'Enquire' : 'Get started');
          cta.setAttribute('data-fundsae-tier', tier.id);
          cta.textContent = label;
          cta.setAttribute('aria-label', label + ': ' + tier.name);
          // A package link goes there; otherwise the button opens Contact us (js/fundsae-forms.js fills the subject).
          if (!tier.ctaUrl || !api.setLink(cta, tier.ctaUrl, { httpsOnly: true })) {
            cta.setAttribute('href', '#contact');
            cta.removeAttribute('target');
            cta.removeAttribute('rel');
          }
        }
      });
    });
  }

  var updatedFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  /** One rich-text block's spans: bold, italic and links, built with createElement and textContent only. */
  function spansInto(node, spans) {
    spans.forEach(function (span) {
      var out = document.createTextNode(span.text);
      if (span.italic) { var em = document.createElement('em'); em.appendChild(out); out = em; }
      if (span.bold) { var strong = document.createElement('strong'); strong.appendChild(out); out = strong; }
      if (span.href) {
        var a = document.createElement('a');
        if (api.setCopyLink(a, span.href)) { a.appendChild(out); out = a; }
      }
      node.appendChild(out);
    });
    return node;
  }

  /** Blocks -> <section>s, one per h2, with list items grouped into <ul>/<ol>. */
  function pageSections(blocks) {
    var sections = [];
    var section = null;
    var list = null;
    blocks.forEach(function (block) {
      if (block.type === 'h2' || !section) {
        section = document.createElement('section');
        sections.push(section);
        list = null;
      }
      if (block.type === 'li') {
        var tag = block.list === 'number' ? 'OL' : 'UL';
        if (!list || list.tagName !== tag) {
          list = document.createElement(tag);
          section.appendChild(list);
        }
        list.appendChild(spansInto(document.createElement('li'), block.spans));
        return;
      }
      list = null;
      section.appendChild(spansInto(document.createElement(block.type === 'p' ? 'p' : block.type), block.spans));
    });
    return sections;
  }

  /** About, Privacy, Terms: title, lead, "Last updated" and the body sections (sections marked data-fundsae-keep stay). */
  function renderPage(pages) {
    slots('page-body').forEach(function (main) {
      var page = pages[main.getAttribute('data-fundsae-page')];
      if (!page || !api.valid.page(page)) return;
      var title = main.querySelector('.intro h1');
      if (title) title.textContent = page.title;
      var lead = main.querySelector('.intro .lead');
      if (lead) {
        if (page.intro) lead.textContent = page.intro;
        else lead.remove();
      }
      var updated = main.querySelector('.intro .updated');
      if (updated) {
        if (page.updatedAt) updated.textContent = api.tr('Last updated') + ' ' + updatedFmt.format(new Date(page.updatedAt + 'T00:00:00Z'));
        else updated.remove();
      }
      var old = children(main, ':scope > section:not([data-fundsae-keep])');
      var anchor = old[0] || main.querySelector(':scope > .related');
      pageSections(page.blocks).forEach(function (section) {
        section.setAttribute('data-fundsae-row', '');
        main.insertBefore(section, anchor);
      });
      old.forEach(function (section) { section.remove(); });
    });
  }

  /** Home page hero banner (content.json "hero", the Studio's "Home page hero banner"). With none published the
   *  page keeps its built-in banner. The gold word is a span; everything goes in with textContent. */
  // The pages the hero's button may open (HERO_BUTTON_TARGETS in backend/src/contracts/models.js).
  var HERO_PAGES = ['RealEstateNews.dc.html', 'Videos.dc.html', 'Events.dc.html', 'Careers.dc.html', 'PartnerWithUs.dc.html'];
  var HERO_ART = { photo: 'img/hero-dubai.jpg', minimal: 'img/hero-skyline-warm.svg', classic: 'img/hero-skyline.svg' };
  var HERO_ART_ALT = {
    photo: 'The Burj Khalifa and Downtown Dubai towers above Sheikh Zayed Road',
    minimal: 'A financial district skyline at sunrise, with glass and sandstone towers',
    classic: 'A stylised UAE skyline with a rising line of capital'
  };

  /** A hero button: shown with its text and site page, or hidden (no text, an unknown page, or the Classic style). */
  function heroButton(btn, label, href, show) {
    if (!btn) return false;
    var text = btn.querySelector('span');
    var page = typeof href === 'string' && HERO_PAGES.indexOf(href) !== -1 ? href : null;
    if (show && page && text && typeof label === 'string' && label) {
      text.textContent = label;
      btn.setAttribute('href', page);
      btn.hidden = false;
      return true;
    }
    btn.hidden = true;
    return false;
  }

  function renderHero(hero) {
    if (!hero || typeof hero !== 'object' || typeof hero.title !== 'string' || !hero.title) return;
    var style = hero.style === 'classic' || hero.style === 'minimal' ? hero.style : 'photo';
    slots('home-hero').forEach(function (box) {
      // Banner style (Sanity "Banner style"): Photo is the built-in look; Minimal is light; Classic is the teal banner.
      // The home page banner has no buttons in its markup, so heroButton finds none and shows nothing.
      box.classList.toggle('fx-hero--photo', style === 'photo');
      box.classList.toggle('fx-hero--minimal', style === 'minimal');
      var buttons = style !== 'classic';
      var one = heroButton(box.querySelector('.fx-hero-btn'), hero.buttonLabel, hero.buttonHref, buttons);
      var two = heroButton(box.querySelector('.fx-hero-btn2'), hero.button2Label, hero.button2Href, buttons);
      var acts = box.querySelector('.fx-hero-acts');
      if (acts) acts.hidden = !one && !two;
      var eyebrow = box.querySelector('.fx-hero-eyebrow');
      if (eyebrow && typeof hero.eyebrow === 'string' && hero.eyebrow) eyebrow.textContent = hero.eyebrow;
      var title = box.querySelector('.fx-hero-title'); // h1 on the home page, h2 on the other pages
      if (title) {
        title.textContent = '';
        var at = typeof hero.highlight === 'string' && hero.highlight ? hero.title.indexOf(hero.highlight) : -1;
        if (at === -1) {
          title.textContent = hero.title;
        } else {
          var gold = document.createElement('span');
          gold.textContent = hero.highlight;
          title.appendChild(document.createTextNode(hero.title.slice(0, at)));
          title.appendChild(gold);
          title.appendChild(document.createTextNode(hero.title.slice(at + hero.highlight.length)));
        }
      }
      var sub = box.querySelector('.fx-hero-sub');
      if (sub) {
        if (typeof hero.subtitle === 'string' && hero.subtitle) sub.textContent = hero.subtitle;
        else sub.remove();
      }
      var img = box.querySelector('.fx-hero-art img');
      var src = api.httpUrl(hero.image, true);
      if (img && src) {
        img.src = src;
        img.alt = typeof hero.imageAlt === 'string' ? hero.imageAlt : '';
        img.removeAttribute('width');
        img.removeAttribute('height');
      } else if (img) {
        // No photo uploaded: the built-in illustration that suits the style.
        img.setAttribute('src', HERO_ART[style]);
        img.alt = HERO_ART_ALT[style];
      }
    });
  }

  function renderContent(doc) {
    renderHero(doc.hero);
    renderGrants(doc.grants);
    renderBanners(doc.banners);
    renderSettings(doc.settings);
    var s = doc.slots || {};
    renderHighlights(api.items(s.socialHighlights, api.valid.socialHighlight, 'Top Tweets items'));
    renderTiers(api.items(s.advertiseTiers, api.valid.advertiseTier, 'Advertise packages'));
    renderPage(doc.pages && typeof doc.pages === 'object' ? doc.pages : {});
  }

  /* ---------------------------- Real Estate News page --------------------------- */
  // RealEstateNews.dc.html: three parallel columns (slot "news-column"). Each column lists the stories of the page
  // sections named in data-fundsae-sections (the Alternative column also carries Infrastructure), newest first: a lead
  // story with picture, summary and source, then headlines. Built with textContent only. COLUMN_STORIES show per
  // column; "Load more news" (data-fundsae-news-more) adds COLUMN_STORIES more to every column on the same page and
  // hides itself once nothing is left. The column's built-in headlines (data-ren-demo) are demo content: in demo mode
  // they follow the real stories, in live mode they go.

  var COLUMN_STORIES = 8;
  var newsColumns = { list: [], shown: COLUMN_STORIES, wired: false };
  var SECTION_ID = /^[a-z0-9-]{2,60}$/;
  var STORY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var COLUMN_DATE = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }) : null;

  function columnSections(box) {
    return String(box.getAttribute('data-fundsae-sections') || '').split(',').map(function (s) { return s.trim(); })
      .filter(function (s) { return SECTION_ID.test(s); });
  }

  /** The column's built-in demo headlines as plain entries (headline, summary, source line, tag). */
  function columnDemoEntries(box) {
    return children(box, '[data-ren-demo]').map(function (art) {
      var text = function (sel) { var n = art.querySelector(sel); return n ? n.textContent.trim() : ''; };
      return { headline: text('h3'), summary: text('.ren-sum'), meta: text('.ren-meta'), tag: text('.ren-tag'), href: '#', external: false, image: null };
    });
  }

  function columnEntry(story) {
    var date = COLUMN_DATE && !isNaN(Date.parse(story.publishedAt)) ? COLUMN_DATE.format(new Date(story.publishedAt)) : '';
    var asset = Array.isArray(story.assetClasses) && story.assetClasses[0] && story.assetClasses[0].label;
    var page = STORY_SLUG.test(story.slug || '') ? 'news/' + story.slug + '.html' : null;
    return {
      headline: story.headline,
      summary: story.summary || '',
      meta: story.source + (date ? ' \u00b7 ' + date : ''),
      tag: asset || story.topicLabel || '',
      href: page || story.url,
      external: !page,
      image: api.imageUrl(story.imageUrl)
    };
  }

  function columnLink(a, entry) {
    a.textContent = entry.headline;
    if (entry.external) api.setLink(a, entry.href);
    else a.href = entry.href;
  }

  function columnArticle(entry, lead) {
    var art = document.createElement('article');
    art.className = lead ? 'ren-lead' : 'ren-item';
    if (lead) {
      var visual = document.createElement('a');
      visual.className = 'ren-visual';
      visual.tabIndex = -1;
      visual.setAttribute('aria-hidden', 'true');
      if (entry.external) api.setLink(visual, entry.href); else visual.href = entry.href;
      if (entry.image) {
        var img = document.createElement('img');
        img.src = entry.image;
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        visual.appendChild(img);
      }
      if (entry.tag) {
        var tag = document.createElement('span');
        tag.className = 'ren-tag';
        tag.textContent = entry.tag;
        visual.appendChild(tag);
      }
      art.appendChild(visual);
    }
    var h3 = document.createElement('h3');
    var a = document.createElement('a');
    columnLink(a, entry);
    h3.appendChild(a);
    art.appendChild(h3);
    if (lead && entry.summary) {
      var sum = document.createElement('p');
      sum.className = 'ren-sum';
      sum.textContent = entry.summary;
      art.appendChild(sum);
    }
    var meta = document.createElement('p');
    meta.className = 'ren-meta';
    meta.textContent = entry.meta;
    art.appendChild(meta);
    return art;
  }

  /** Shows the first newsColumns.shown entries of one column (lead story first). */
  function drawNewsColumn(column) {
    var list = column.box.querySelector('.ren-stories');
    if (!list) return;
    list.textContent = '';
    if (!column.entries.length) {
      var empty = document.createElement('p');
      empty.className = 'ren-empty';
      empty.textContent = 'No stories yet. Check back soon.';
      list.appendChild(empty);
      return;
    }
    column.entries.slice(0, newsColumns.shown).forEach(function (entry, i) { list.appendChild(columnArticle(entry, i === 0)); });
  }

  /** Load more news: visible while any column has stories still hidden. */
  function updateNewsMore() {
    var more = document.querySelector('[data-fundsae-news-more]');
    if (!more) return;
    var left = newsColumns.list.some(function (c) { return c.entries.length > newsColumns.shown; });
    more.hidden = !left;
    if (!newsColumns.wired) {
      newsColumns.wired = true;
      more.addEventListener('click', function () {
        newsColumns.shown += COLUMN_STORIES;
        newsColumns.list.forEach(drawNewsColumn);
        updateNewsMore();
        var status = document.querySelector('[data-fundsae-news-more-status]');
        if (status) status.textContent = more.hidden ? 'All stories are shown.' : 'More stories loaded.';
      });
    }
  }

  function renderNewsColumn(box, docs) {
    var seen = {};
    var stories = [];
    docs.forEach(function (doc) {
      api.items(doc && doc.items, api.valid.story, 'stories').forEach(function (story) {
        if (seen[story.id]) return;
        seen[story.id] = true;
        stories.push(story);
      });
    });
    stories.sort(function (a, b) { return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0); });
    var entries = stories.map(columnEntry);
    if (state.mode !== 'live') {
      var demo = columnDemoEntries(box);
      entries = entries.concat(demo).slice(0, Math.max(entries.length, demo.length));
    }
    var column = { box: box, entries: entries };
    newsColumns.list.push(column);
    drawNewsColumn(column);
    updateNewsMore();
  }

  /* ----------------------------- Grants & Funding ----------------------------- */
  // content.json grants (edited in Sanity): the type tiles on the Grants & Funding page and the home page, and the
  // programme cards. Built with textContent; links are https only. Without grants the built-in content stays.

  var GRANT_KINDS = { grant: 'Grant', loan: 'Loan', equity: 'Equity', trade: 'Trade finance' };
  var GRANT_PLACES = { uae: 'UAE-wide', 'abu-dhabi': 'Abu Dhabi', dubai: 'Dubai', sharjah: 'Sharjah', northern: 'Northern Emirates' };
  var GRANT_TYPE_ID = /^[a-z0-9][a-z0-9-]{0,30}$/;

  function programmeCount(n) { return n + (n === 1 ? ' programme' : ' programmes'); }

  function validFundingType(t) {
    return !!t && GRANT_TYPE_ID.test(t.id) && typeof t.title === 'string' && t.title && typeof t.description === 'string' && typeof t.count === 'number';
  }

  function validProgramme(p) {
    return !!p && typeof p.id === 'string' && typeof p.provider === 'string' && p.provider && Object.prototype.hasOwnProperty.call(GRANT_KINDS, p.kind) &&
      Object.prototype.hasOwnProperty.call(GRANT_PLACES, p.place) && Array.isArray(p.types) && p.types.every(function (t) { return GRANT_TYPE_ID.test(t); }) &&
      typeof p.description === 'string' && (p.url === null || typeof p.url === 'string');
  }

  /** Updates a set of type tiles (by id): words, count, order; tiles without a published type are hidden. */
  function fillTypeTiles(grid, tiles, idOf, types, parts) {
    var byId = {};
    types.forEach(function (t) { byId[t.id] = t; });
    tiles.forEach(function (tile) {
      var t = byId[idOf(tile)];
      tile.hidden = !t;
      if (!t) return;
      var title = tile.querySelector(parts.title);
      var desc = tile.querySelector(parts.description);
      var count = tile.querySelector(parts.count);
      if (title) title.textContent = t.title;
      if (desc) desc.textContent = t.description;
      if (count) count.textContent = programmeCount(t.count);
    });
    types.forEach(function (t) {
      var tile = tiles.filter(function (x) { return idOf(x) === t.id; })[0];
      if (tile) grid.appendChild(tile);
    });
  }

  function programmeCard(p, titles) {
    var art = document.createElement('article');
    art.className = 'gf-card' + (p.featured ? ' gf-featured' : '');
    art.setAttribute('data-type', p.kind);
    art.setAttribute('data-emirate', p.place);
    art.setAttribute('data-cats', p.types.join(' '));
    var kicker = document.createElement('p');
    kicker.className = 'gf-kicker';
    kicker.textContent = GRANT_KINDS[p.kind] + ' \u00b7 ' + GRANT_PLACES[p.place];
    if (p.featured) {
      kicker.appendChild(document.createTextNode(' \u00b7 '));
      var pick = document.createElement('span');
      pick.className = 'gf-pick';
      pick.textContent = 'Featured';
      kicker.appendChild(pick);
    }
    var h3 = document.createElement('h3');
    h3.textContent = p.provider;
    var brief = document.createElement('p');
    brief.className = 'gf-brief';
    brief.textContent = p.description;
    var cats = document.createElement('p');
    cats.className = 'gf-cats';
    cats.textContent = p.types.map(function (t) { return titles[t]; }).filter(Boolean).join(' \u00b7 ');
    var link = document.createElement('a');
    link.className = 'gf-link';
    link.textContent = 'View details ';
    var arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '\u2192';
    link.appendChild(arrow);
    if (api.setLink(link, p.url, { httpsOnly: true })) link.setAttribute('aria-label', 'View details: ' + p.provider + ' (opens the provider\'s site)');
    else { link.href = '#'; link.setAttribute('aria-label', 'View details: ' + p.provider + ' (coming soon)'); }
    [kicker, h3, brief, cats, link].forEach(function (el) { art.appendChild(el); });
    return art;
  }

  function renderGrants(grants) {
    if (!grants || typeof grants !== 'object') return;
    var types = api.items(grants.types, validFundingType, 'funding types');
    var programmes = api.items(grants.programmes, validProgramme, 'funding programmes');
    if (!types.length && !programmes.length && state.mode !== 'live') return;
    var titles = {};
    types.forEach(function (t) { titles[t.id] = t.title; });
    slots('grants-types').forEach(function (grid) {
      fillTypeTiles(grid, children(grid, '[data-gf-cat]'), function (tile) { return tile.getAttribute('data-gf-cat'); }, types,
        { title: 'strong', description: '.gf-type-text > span', count: 'small' });
    });
    slots('grants-types-home').forEach(function (grid) {
      fillTypeTiles(grid, children(grid, '[data-fund-type]'), function (tile) { return tile.getAttribute('data-fund-type'); }, types,
        { title: 'strong', description: 'span > span', count: 'small' });
    });
    slots('grants-programmes').forEach(function (list) {
      list.textContent = '';
      programmes.forEach(function (p) { list.appendChild(programmeCard(p, titles)); });
    });
    if (typeof window.__gfRefresh === 'function') window.__gfRefresh();
  }

  /* ------------------------------ Reusable banners ----------------------------- */
  // content.json banners (edited in Sanity): the Finance Careers banner and the Grants & Funding card. Each fills the
  // banners already on the page (textContent; the photo only from an https address). Missing, hidden or outside its
  // dates (checked here, on the visitor's day in the UAE), the built-in banner stays.

  var BANNER_HREF = /^[A-Za-z]+\.dc\.html$/;

  function validBanner(b) {
    return !!b && typeof b.title === 'string' && b.title && typeof b.eyebrow === 'string' && (b.text === null || typeof b.text === 'string') &&
      (b.buttonHref === null || BANNER_HREF.test(b.buttonHref)) && (b.buttonLabel === null || typeof b.buttonLabel === 'string');
  }

  function bannerShowing(b) {
    var today = api.dubaiToday();
    return (!b.startDate || b.startDate <= today) && (!b.endDate || b.endDate >= today);
  }

  function fillBanner(slotName, b, parts) {
    if (!validBanner(b) || !bannerShowing(b)) return;
    slots(slotName).forEach(function (box) {
      var set = function (selector, value) {
        var el = selector && box.querySelector(selector);
        if (!el) return;
        if (value) { el.textContent = value; el.hidden = false; } else el.hidden = true;
      };
      set(parts.eyebrow, b.eyebrow);
      set(parts.title, b.title);
      if (parts.text) set(parts.text, b.text);
      var photo = api.imageUrl(b.image);
      var img = photo && box.querySelector(parts.image);
      if (img) { img.src = photo; img.alt = ''; }
      if (parts.button) {
        var button = box.querySelector(parts.button);
        if (button && b.buttonLabel && b.buttonHref) {
          button.textContent = b.buttonLabel;
          // A button that jumps within its own page (Careers: "#opportunities") keeps its place.
          if ((button.getAttribute('href') || '').charAt(0) !== '#') button.setAttribute('href', b.buttonHref);
        }
      }
      if (parts.cta && b.buttonLabel && b.buttonHref) {
        var cta = box.querySelector(parts.cta);
        if (cta) {
          cta.textContent = b.buttonLabel + ' ';
          var arrow = document.createElement('span');
          arrow.setAttribute('aria-hidden', 'true');
          arrow.textContent = '\u2192';
          cta.appendChild(arrow);
        }
        box.setAttribute('href', b.buttonHref);
      }
    });
  }

  /* ------------------------------- Site settings ------------------------------- */
  // content.json settings (edited in Sanity): the pinned Top UAE Story and the footer tagline.

  var FOOTER_TAGLINE = 'Discover. Connect. Grow.';
  var siteSettings = { topUaeStoryId: null };
  var lastStories = null;

  function renderSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    if (typeof settings.topUaeStoryId === 'string' && /^[A-Za-z0-9_-]{4,80}$/.test(settings.topUaeStoryId)) {
      siteSettings.topUaeStoryId = settings.topUaeStoryId;
      if (lastStories) renderTopUae(lastStories);
    }
    var tagline = typeof settings.footerTagline === 'string' ? settings.footerTagline.trim() : '';
    if (tagline) {
      // The footer line beside the logo on every page (the home page's footer comes from its design, so match the text).
      Array.prototype.slice.call(document.querySelectorAll('footer span, footer p, footer div')).forEach(function (el) {
        if (!el.children.length && el.textContent.trim() === FOOTER_TAGLINE) el.textContent = tagline;
      });
    }
  }

  function renderBanners(banners) {
    if (!banners || typeof banners !== 'object') return;
    fillBanner('banner-careers', banners.careers, { eyebrow: '.fx-cb-eyebrow', title: '.fx-cb-title', text: '.fx-cb-sub', image: '.fx-cb-photo', button: '.fx-cb-btn:not(.fx-cb-btn--ghost)' });
    fillBanner('banner-grants', banners.grants, { eyebrow: '.gf-promo-eb', title: '.gf-promo-title', image: '.gf-promo-img', cta: '.gf-promo-cta' });
  }

  /* ------------------------------- Gulf Economy ------------------------------- */
  // Home page column 3, "Gulf Economy at a Glance": the IMF's projected real GDP and consumer prices per country
  // (api/v1/economy.json), headed and written as on imf.org ("2026 Projected Real GDP (% Change)": -15.6). The rows and
  // the IMF credit are built with textContent; the source link is fixed to imf.org.

  var IMF_URL = 'https://www.imf.org/external/datamapper/datasets/WEO';

  var ECON_HEADINGS = { gdp: 'Projected Real GDP (% Change)', prices: 'Projected Consumer Prices (% Change)' };

  /** A percent change as the IMF shows it: one decimal, a minus sign when negative, no plus or % sign. */
  function pct(n) {
    return (n < 0 ? '\u2212' : '') + Math.abs(n).toFixed(1);
  }

  function economyUnavailable() {
    slots('economy').forEach(function (box) {
      var rows = box.querySelector('[data-econ-rows]');
      if (!rows || rows.querySelector('[data-econ-country]')) return;
      rows.textContent = '';
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 3;
      td.className = 'fx-econ-note';
      td.textContent = 'Figures unavailable right now.';
      tr.appendChild(td);
      rows.appendChild(tr);
    });
  }

  function renderEconomy(doc) {
    var list = api.items(doc && doc.items, api.valid.economyItem, 'economy figures');
    if (!list.length) { economyUnavailable(); return; }
    var source = (doc && doc.source) || {};
    var dataset = typeof source.dataset === 'string' && /^World Economic Outlook( \((January|April|July|October) \d{4}\))?$/.test(source.dataset)
      ? source.dataset : 'World Economic Outlook';
    slots('economy').forEach(function (box) {
      var rows = box.querySelector('[data-econ-rows]');
      if (!rows) return;
      rows.textContent = '';
      list.forEach(function (item) {
        var tr = document.createElement('tr');
        tr.setAttribute('data-econ-country', item.id);
        var name = document.createElement('th');
        name.scope = 'row';
        var badge = document.createElement('span');
        badge.className = 'fx-econ-code';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = item.code;
        name.appendChild(badge);
        name.appendChild(document.createTextNode(item.country + (item.year !== doc.year ? ' (' + item.year + ')' : '')));
        tr.appendChild(name);
        [item.gdpGrowth, item.inflation].forEach(function (value, i) {
          var td = document.createElement('td');
          td.textContent = pct(value);
          if (i === 0 && value < 0) td.className = 'fx-econ-neg';
          tr.appendChild(td);
        });
        rows.appendChild(tr);
      });
      box.querySelectorAll('[data-econ-col]').forEach(function (th) {
        var heading = ECON_HEADINGS[th.getAttribute('data-econ-col')];
        if (heading) th.textContent = (typeof doc.year === 'number' ? doc.year + ' ' : '') + heading;
      });
      var link = box.querySelector('[data-econ-source]');
      if (link) { link.textContent = 'International Monetary Fund, ' + dataset; link.href = IMF_URL; }
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
      if (hasSlot('tiles-residential-real-estate')) {
        guard('Residential real estate stories', load('news/sections/residential-real-estate.json', 'news').then(function (doc) { renderTiles('tiles-residential-real-estate', uaeOnly(doc), TILES_SHOWN); }));
      }
      if (hasSlot('tiles-commercial-real-estate')) {
        guard('Commercial real estate stories', load('news/sections/commercial-real-estate.json', 'news').then(function (doc) { renderTiles('tiles-commercial-real-estate', uaeOnly(doc), TILES_SHOWN); }));
      }
      if (hasSlot('tiles-alternative-real-estate')) {
        // One home box for two page sections: Infrastructure and Special & Alternative, merged newest first.
        guard('Alternative real estate stories', Promise.all(ALTERNATIVE_SECTIONS.map(function (id) { return load('news/sections/' + id + '.json', 'news'); }))
          .then(function (docs) { renderTiles('tiles-alternative-real-estate', uaeOnly(mergeStoryDocs(docs)), TILES_SHOWN); }));
      }
      // careers.json: the Top Employers / Top Jobs picked in the Studio (missing on older data: automatic order).
      var careersDoc = (hasSlot('employers') || hasSlot('top-jobs')) ? load('careers.json', 'careers').catch(function () { return null; }) : null;
      if (hasSlot('employers')) {
        guard('Employers', Promise.all([load('employers.json', 'employers'), careersDoc]).then(function (docs) { renderEmployers(docs[0], docs[1]); }));
      }
      if (hasSlot('roles') || hasSlot('top-jobs')) {
        guard('Roles', Promise.all([
          load('jobs.json', 'jobs'),
          load('employers.json', 'employers').catch(function () { return null; }),
          careersDoc
        ]).then(function (docs) { renderRoles(docs[0], docs[1]); renderTopJobs(docs[0], docs[2]); }));
      }
      if (hasSlot('events')) guard('Events', load('events.json', 'events').then(renderEvents));
      slots('news-column').forEach(function (box) {
        var sections = columnSections(box);
        if (!sections.length) return;
        guard('Real estate news column', Promise.all(sections.map(function (id) { return load('news/sections/' + id + '.json', 'news'); }))
          .then(function (docs) { renderNewsColumn(box, docs); }));
      });
      if (hasSlot('economy')) {
        guard('Gulf economy figures', load('economy.json', 'economy').then(renderEconomy, function (err) { economyUnavailable(); throw err; }));
      }
      var sponsorSlots = ['sponsor-founding', 'sponsor-platinum', 'sponsor-posts', 'sponsor-media', 'sponsor-companies', 'career-resources'];
      if (sponsorSlots.some(hasSlot)) guard('Sponsors', load('sponsors.json', 'sponsors').then(renderSponsors));
      if (hasSlot('social-highlights') || hasSlot('advertise-tiers') || hasSlot('page-body') || hasSlot('home-hero') || hasSlot('grants-programmes') || hasSlot('grants-types-home') || hasSlot('banner-careers') || hasSlot('banner-grants') || document.querySelector('footer')) {
        guard('Editorial content', load('content.json', 'content').then(renderContent));
      }
    }).catch(function (err) {
      economyUnavailable();
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
