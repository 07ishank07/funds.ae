/*!
 * Funds.ae news filters: the rules of the Real Estate Capital News page, as pure
 * functions with no DOM, so the same file runs in the browser (window.FundsAeNewsFilter)
 * and in the backend tests (backend/test/newsFilter.test.js).
 *
 *   - Capital Types: any of the chosen types (OR).
 *   - Asset Classes: any of the chosen classes (OR). A home page box ("section") stands
 *     for the Asset Classes that feed it.
 *   - Geography: any of the chosen regions (OR).
 *   - Different filters must all match (AND), and so must the search words.
 *   - Newest or oldest first, by the publisher's date; featured stories lead the
 *     unfiltered newest-first view. Pages of PAGE_SIZE ("Load more").
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FundsAeNewsFilter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PAGE_SIZE = 20;
  var ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
  var MAX_QUERY = 100;

  function list(value) {
    if (!value) return [];
    var seen = {};
    return String(value).split(',').map(function (s) { return s.trim(); }).filter(function (s) {
      if (!ID.test(s) || seen[s]) return false;
      seen[s] = true;
      return true;
    }).slice(0, 20);
  }

  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
  }

  /** The page's filter state from a query string such as "?capital=reits,banks&asset=office&sort=oldest". */
  function parseQuery(search) {
    var params = new URLSearchParams(search || '');
    var page = parseInt(params.get('page'), 10);
    return {
      capital: list(params.get('capital')),
      asset: list(params.get('asset')),
      geo: list(params.get('geo')),
      section: list(params.get('section'))[0] || '',
      q: clean(params.get('q')),
      sort: params.get('sort') === 'oldest' ? 'oldest' : 'newest',
      page: page > 1 && page <= 500 ? page : 1
    };
  }

  /** The query string for a state (empty values left out), e.g. "?capital=reits&sort=oldest". */
  function toQuery(state) {
    var params = new URLSearchParams();
    if (state.capital && state.capital.length) params.set('capital', state.capital.join(','));
    if (state.asset && state.asset.length) params.set('asset', state.asset.join(','));
    if (state.geo && state.geo.length) params.set('geo', state.geo.join(','));
    if (state.section) params.set('section', state.section);
    if (state.q) params.set('q', state.q);
    if (state.sort === 'oldest') params.set('sort', 'oldest');
    if (state.page > 1) params.set('page', String(state.page));
    var text = params.toString();
    return text ? '?' + text : '';
  }

  /** Keeps only ids the taxonomy knows, so a stale or edited link never breaks the page. */
  function known(state, taxonomy) {
    var ids = function (items) { return (items || []).map(function (i) { return i.id; }); };
    var keep = function (wanted, allowed) { return wanted.filter(function (id) { return allowed.indexOf(id) !== -1; }); };
    var sections = (taxonomy.sections || []).filter(function (s) { return (s.assetClasses || []).length; }).map(function (s) { return s.id; });
    return {
      capital: keep(state.capital, ids(taxonomy.capitalTypes)),
      asset: keep(state.asset, ids(taxonomy.assetClasses)),
      geo: keep(state.geo, ids(taxonomy.geographies)),
      section: sections.indexOf(state.section) !== -1 ? state.section : '',
      q: state.q,
      sort: state.sort,
      page: state.page
    };
  }

  function sectionAssets(taxonomy, sectionId) {
    var section = (taxonomy.sections || []).filter(function (s) { return s.id === sectionId; })[0];
    return section ? section.assetClasses || [] : [];
  }

  function anyOf(wanted, tags) {
    if (!wanted.length) return true;
    return (tags || []).some(function (t) { return wanted.indexOf(t.id) !== -1; });
  }

  function words(story) {
    return [story.headline, story.summary, story.source].concat(
      (story.capitalTypes || []).map(function (t) { return t.label; }),
      (story.assetClasses || []).map(function (t) { return t.label; })
    ).join(' ').toLowerCase();
  }

  function isFiltered(state) {
    return !!(state.capital.length || state.asset.length || state.geo.length || state.section || state.q);
  }

  /** The stories that match the state, in display order. */
  function filterStories(stories, state, taxonomy) {
    var assets = state.asset.concat(state.section ? sectionAssets(taxonomy, state.section) : []);
    var terms = state.q ? state.q.toLowerCase().split(' ').filter(Boolean) : [];
    var matches = (stories || []).filter(function (s) {
      if (!anyOf(state.capital, s.capitalTypes) || !anyOf(assets, s.assetClasses) || !anyOf(state.geo, s.geography)) return false;
      if (!terms.length) return true;
      var text = words(s);
      return terms.every(function (t) { return text.indexOf(t) !== -1; });
    });
    var time = function (s) { var t = Date.parse(s.publishedAt); return isNaN(t) ? 0 : t; };
    var pinFeatured = state.sort === 'newest' && !isFiltered(state);
    return matches.slice().sort(function (a, b) {
      if (pinFeatured && !!a.featured !== !!b.featured) return a.featured ? -1 : 1;
      return state.sort === 'oldest' ? time(a) - time(b) : time(b) - time(a);
    });
  }

  /** The first `page` pages of results, and whether there are more to load. */
  function paginate(stories, page) {
    var shown = stories.slice(0, Math.max(1, page) * PAGE_SIZE);
    return { items: shown, hasMore: shown.length < stories.length, total: stories.length };
  }

  return {
    PAGE_SIZE: PAGE_SIZE,
    parseQuery: parseQuery,
    toQuery: toQuery,
    known: known,
    filterStories: filterStories,
    paginate: paginate,
    isFiltered: isFiltered
  };
});
