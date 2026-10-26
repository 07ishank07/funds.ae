/*!
 * Funds.ae Real Estate Capital News page (frontend_demo/News.dc.html).
 * Needs js/fundsae-api.js and js/fundsae-news-filter.js loaded first.
 *
 * Reads api/v1/news/real-estate.json (approved stories with an Asset Class) and
 * api/v1/taxonomy.json (Capital Types, Asset Classes, geographies), builds the filters,
 * and renders story cards. The filter rules live in fundsae-news-filter.js; the state is
 * kept in the address bar (?capital=…&asset=…&geo=…&q=…&sort=…), so a filtered view can be
 * shared. Everything from the API is inserted with textContent; external links go through
 * FundsAeApi.setLink, and story pages are linked only by a checked slug.
 *
 * Page hooks: data-fundsae-news (root) and data-fundsae-news-* elements inside it.
 */
(function () {
  'use strict';

  var api = window.FundsAeApi;
  var F = window.FundsAeNewsFilter;
  var root = document.querySelector('[data-fundsae-news]');
  if (!root) return;
  if (!api || !F) {
    try { console.warn('[Funds.ae] fundsae-api.js and fundsae-news-filter.js must load before fundsae-news.js'); } catch (e) { /* no console */ }
    return;
  }

  var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });
  var hook = function (name) { return root.querySelector('[data-fundsae-news-' + name + ']'); };
  var el = function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };

  var ui = {
    search: hook('search'),
    sort: hook('sort'),
    clear: hook('clear'),
    status: hook('status'),
    section: hook('section'),
    list: hook('list'),
    more: hook('more'),
    empty: hook('empty'),
    count: hook('count'),
    groups: {
      capital: root.querySelector('[data-fundsae-news-filter="capital"]'),
      asset: root.querySelector('[data-fundsae-news-filter="asset"]'),
      geo: root.querySelector('[data-fundsae-news-filter="geo"]')
    }
  };

  var data = { stories: [], taxonomy: null };
  var state = F.parseQuery(window.location.search);

  function dateText(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : DATE.format(d);
  }

  function saveUrl() {
    try {
      window.history.replaceState(null, '', window.location.pathname + F.toQuery(state));
    } catch (e) { /* file:// or sandboxed: the filters still work */ }
  }

  /* --------------------------------- filters --------------------------------- */

  function checkbox(dimension, item) {
    var label = el('label', 'nf-option');
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.value = item.id;
    input.checked = state[dimension].indexOf(item.id) !== -1;
    input.addEventListener('change', function () {
      var chosen = state[dimension].filter(function (id) { return id !== item.id; });
      if (input.checked) chosen.push(item.id);
      state[dimension] = chosen;
      state.page = 1;
      update();
    });
    label.appendChild(input);
    label.appendChild(el('span', null, item.label));
    return label;
  }

  function buildFilters() {
    var t = data.taxonomy;
    [['capital', t.capitalTypes], ['asset', t.assetClasses], ['geo', t.geographies]].forEach(function (pair) {
      var box = ui.groups[pair[0]];
      if (!box) return;
      box.textContent = '';
      (pair[1] || []).forEach(function (item) { box.appendChild(checkbox(pair[0], item)); });
    });
    if (ui.search) ui.search.value = state.q;
    if (ui.sort) ui.sort.value = state.sort;
    // On a phone the filters sit above the stories: start with the groups closed unless one is in use.
    if (window.matchMedia && window.matchMedia('(max-width: 860px)').matches) {
      Object.keys(ui.groups).forEach(function (dimension) {
        var details = ui.groups[dimension] && ui.groups[dimension].closest('details');
        if (details) details.open = state[dimension].length > 0;
      });
    }
  }

  function syncFilterInputs() {
    Object.keys(ui.groups).forEach(function (dimension) {
      var box = ui.groups[dimension];
      if (!box) return;
      box.querySelectorAll('input[type="checkbox"]').forEach(function (input) { input.checked = state[dimension].indexOf(input.value) !== -1; });
    });
    if (ui.search && ui.search.value !== state.q) ui.search.value = state.q;
    if (ui.sort) ui.sort.value = state.sort;
  }

  /* ---------------------------------- cards ---------------------------------- */

  function chips(story) {
    var row = el('div', 'nc-tags');
    if (story.transactionType) row.appendChild(el('span', 'nc-tag nc-deal', story.transactionType.label));
    (story.capitalTypes || []).concat(story.assetClasses || []).forEach(function (t) { row.appendChild(el('span', 'nc-tag', t.label)); });
    return row;
  }

  function card(story) {
    var article = el('article', 'nc' + (story.featured ? ' nc-featured' : ''));
    var body = el('div', 'nc-body');
    if (story.featured) body.appendChild(el('span', 'nc-flag', 'Featured'));
    body.appendChild(chips(story));
    var title = el('h2', 'nc-title');
    var link = el('a', null, story.headline);
    if (SLUG.test(story.slug || '')) link.href = 'news/' + story.slug + '.html';
    else api.setLink(link, story.url);
    title.appendChild(link);
    body.appendChild(title);
    if (story.summary) body.appendChild(el('p', 'nc-summary', story.summary));
    var meta = el('p', 'nc-meta');
    meta.appendChild(el('strong', null, story.source));
    var when = dateText(story.publishedAt);
    if (when) {
      meta.appendChild(document.createTextNode(' · '));
      var time = el('time', null, when);
      time.setAttribute('datetime', story.publishedAt);
      meta.appendChild(time);
    }
    var geo = (story.geography || []).map(function (g) { return g.label; }).join(', ');
    if (geo) meta.appendChild(document.createTextNode(' · ' + geo));
    body.appendChild(meta);
    var read = el('a', 'nc-read', 'Read at ' + story.source);
    if (api.setLink(read, story.url)) body.appendChild(read);
    article.appendChild(body);
    // Images are hot-linked, never copied: https only, lazy, and without telling the host which page asked.
    var image = api.httpUrl(story.imageUrl, true);
    if (image) {
      var img = el('img', 'nc-image');
      img.src = image;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.title = story.imageCredit || ('Image: ' + story.source);
      article.appendChild(img);
    }
    return article;
  }

  /* --------------------------------- rendering -------------------------------- */

  function sectionLabel(id) {
    var section = (data.taxonomy.sections || []).filter(function (s) { return s.id === id; })[0];
    return section ? section.label : id;
  }

  function render() {
    var results = F.filterStories(data.stories, state, data.taxonomy);
    var page = F.paginate(results, state.page);
    ui.list.textContent = '';
    page.items.forEach(function (story) { ui.list.appendChild(card(story)); });

    var filtered = F.isFiltered(state);
    if (ui.count) ui.count.textContent = results.length === 1 ? '1 story' : results.length + ' stories';
    if (ui.status) {
      ui.status.textContent = filtered
        ? (results.length ? 'Showing ' + page.items.length + ' of ' + results.length + ' matching stories.' : '')
        : (results.length ? 'Showing ' + page.items.length + ' of ' + results.length + ' stories, newest first.' : '');
    }
    if (ui.more) ui.more.hidden = !page.hasMore;
    if (ui.clear) ui.clear.hidden = !filtered;
    if (ui.section) {
      ui.section.hidden = !state.section;
      var name = ui.section.querySelector('[data-fundsae-news-section-name]');
      if (name) name.textContent = state.section ? sectionLabel(state.section) : '';
    }
    if (ui.empty) {
      ui.empty.hidden = results.length > 0;
      var message = ui.empty.querySelector('p');
      if (message) {
        message.textContent = data.stories.length
          ? 'No stories match these filters. Try fewer filters, or clear them.'
          : 'No stories have been published here yet. Editors approve every story before it appears; check back soon.';
      }
    }
  }

  function update() {
    state = F.known(state, data.taxonomy);
    saveUrl();
    syncFilterInputs();
    render();
  }

  function clearAll() {
    state = { capital: [], asset: [], geo: [], section: '', q: '', sort: state.sort, page: 1 };
    update();
  }

  function bind() {
    var timer = null;
    if (ui.search) {
      ui.search.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          state.q = String(ui.search.value || '').replace(/\s+/g, ' ').trim().slice(0, 100);
          state.page = 1;
          update();
        }, 200);
      });
      var form = ui.search.closest('form');
      if (form) form.addEventListener('submit', function (event) { event.preventDefault(); });
    }
    if (ui.sort) ui.sort.addEventListener('change', function () { state.sort = ui.sort.value === 'oldest' ? 'oldest' : 'newest'; state.page = 1; update(); });
    if (ui.more) ui.more.addEventListener('click', function () { state.page += 1; update(); });
    root.querySelectorAll('[data-fundsae-news-clear]').forEach(function (button) { button.addEventListener('click', clearAll); });
    var removeSection = root.querySelector('[data-fundsae-news-section-remove]');
    if (removeSection) removeSection.addEventListener('click', function (event) { event.preventDefault(); state.section = ''; state.page = 1; update(); });
  }

  api.ready(function () {
    if (ui.status) ui.status.textContent = 'Loading stories…';
    Promise.all([api.get('taxonomy.json', 'news'), api.get('news/real-estate.json', 'news')])
      .then(function (docs) {
        data.taxonomy = docs[0];
        // Every story must link to its publisher; tag lists are normalised so one odd item cannot break the page.
        data.stories = api.items(docs[1].items, api.valid.story, 'stories')
          .filter(function (s) { return api.httpUrl(s.url); })
          .map(function (s) {
            var tags = function (list) { return Array.isArray(list) ? list.filter(function (t) { return t && typeof t.id === 'string' && typeof t.label === 'string'; }) : []; };
            return Object.assign({}, s, { capitalTypes: tags(s.capitalTypes), assetClasses: tags(s.assetClasses), geography: tags(s.geography) });
          });
        state = F.known(state, data.taxonomy);
        buildFilters();
        bind();
        update();
        root.setAttribute('data-fundsae-news-ready', docs[1].mode === 'live' ? 'live' : 'demo');
      })
      .catch(function (err) {
        api.warn('Real Estate Capital News could not be loaded', err);
        if (ui.status) ui.status.textContent = 'The stories could not be loaded. Please try again in a moment.';
      });
  });
})();
