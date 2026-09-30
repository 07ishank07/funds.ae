/*!
 * Funds.ae API client, shared by fundsae-connector.js and fundsae-forms.js.
 *
 * - Finds the API: window.FUNDSAE_CONFIG.apiBase if set, otherwise ../api/v1/
 *   relative to this script (so /js/fundsae-api.js -> /api/v1/). That works on
 *   GitHub Pages (static files) and on the Funds.ae server alike.
 * - Every request has a timeout, sends no cookies and checks that the answer
 *   is a Funds.ae API document before anyone uses it. Reads are retried once on
 *   a network error; form posts are never retried (no double submissions).
 * - Safe DOM helpers: links must be http(s), colours must be hex codes, image
 *   URLs are checked before they reach CSS. Nothing here uses innerHTML.
 *
 * Optional settings, placed before the script tags:
 *   <script>window.FUNDSAE_CONFIG = { apiBase: 'https://api.example.ae/api/v1/' };</script>
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var here = script && script.src ? script.src : location.href;
  var CONFIG = Object.assign({ apiBase: null, timeoutMs: 8000 }, window.FUNDSAE_CONFIG || {});
  var API_BASE = CONFIG.apiBase ? new URL(CONFIG.apiBase, location.href).href : new URL('../api/v1/', here).href;
  if (API_BASE.charAt(API_BASE.length - 1) !== '/') API_BASE += '/';
  var SITE_ROOT = new URL('../', here).href;
  var API_VERSION = 1;

  function warn(message, detail) {
    try { console.warn('[Funds.ae] ' + message, detail || ''); } catch (e) { /* no console */ }
  }

  /* --------------------------------- requests -------------------------------- */

  function request(url, init, retried) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, CONFIG.timeoutMs);
    var options = Object.assign({ credentials: 'omit', redirect: 'follow' }, init, { signal: controller.signal });
    return fetch(url, options).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      var isRead = !options.method || options.method === 'GET';
      if (isRead && !retried) return request(url, init, true);
      throw err;
    });
  }

  function readJson(res) {
    if (!/^application\/json\b/i.test(res.headers.get('content-type') || '')) {
      return Promise.reject(new Error('Unexpected response type from ' + res.url));
    }
    return res.json();
  }

  function isEnvelope(doc) {
    return !!doc && doc.apiVersion === API_VERSION && typeof doc.mode === 'string' && typeof doc.generatedAt === 'string';
  }

  function getJson(name, version) {
    var url = new URL(name, API_BASE);
    if (version) url.searchParams.set('v', version);
    return request(url.href, { cache: version ? 'default' : 'no-cache', headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error(name + ' returned ' + res.status);
        return readJson(res);
      })
      .then(function (doc) {
        if (!isEnvelope(doc)) throw new Error(name + ' is not a Funds.ae API document');
        return doc;
      });
  }

  var metaPromise = null;
  /** meta.json: mode (demo/live), per-file versions for cache-busting, and capabilities. */
  function meta() {
    if (!metaPromise) {
      metaPromise = getJson('meta.json').catch(function (err) {
        metaPromise = null;
        throw err;
      });
    }
    return metaPromise;
  }

  /** Fetches an API file, cache-busted by the version meta.json gives for that resource. */
  function get(name, resource) {
    return meta().then(function (m) {
      var version = (m.versions && m.versions[resource]) || m.buildId || '';
      return getJson(name, version);
    });
  }

  /** Posts a form. Resolves with { status, body, retryAfter } for any HTTP answer. */
  function submit(kind, payload) {
    var url = new URL('submissions/' + encodeURIComponent(kind), API_BASE).href;
    return request(url, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return readJson(res).catch(function () { return null; }).then(function (body) {
        return { status: res.status, body: body, retryAfter: res.headers.get('retry-after') };
      });
    });
  }

  /* ------------------------------ data validation ----------------------------- */
  // Items that do not match the contract are skipped (and reported in the
  // console) rather than breaking the page.

  var DATE = /^\d{4}-\d{2}-\d{2}$/;
  function str(v) { return typeof v === 'string' && v.length > 0; }
  function optStr(v) { return v === null || typeof v === 'string'; }

  var valid = {
    story: function (s) {
      return !!s && str(s.id) && str(s.headline) && str(s.url) && str(s.source) &&
        (s.category === 'uae' || s.category === 'world') && Array.isArray(s.topics) && optStr(s.topicLabel);
    },
    job: function (j) {
      return !!j && str(j.id) && str(j.title) && str(j.company) && str(j.url) && str(j.employerId) && optStr(j.location);
    },
    employer: function (e) {
      return !!e && str(e.id) && str(e.name) && str(e.initials) && typeof e.openJobs === 'number';
    },
    event: function (e) {
      return !!e && str(e.id) && str(e.title) && str(e.eventType) && str(e.city) &&
        DATE.test(e.startDate) && (e.endDate === null || DATE.test(e.endDate));
    },
    sponsorItem: function (i) {
      return !!i && str(i.id) && optStr(i.title) && optStr(i.url) && typeof i.sponsored === 'boolean';
    }
  };

  function items(list, check, label) {
    if (!Array.isArray(list)) return [];
    var ok = list.filter(check);
    if (ok.length !== list.length) warn((list.length - ok.length) + ' ' + label + ' did not match the API contract and were skipped');
    return ok;
  }

  /* -------------------------------- DOM helpers ------------------------------- */

  /** An absolute http(s) URL, or null. httpsOnly for sponsor links. */
  function httpUrl(value, httpsOnly) {
    if (typeof value !== 'string' || !value || value === '#') return null;
    try {
      var u = new URL(value, location.href);
      if (u.protocol === 'https:' || (!httpsOnly && u.protocol === 'http:')) return u.href;
    } catch (e) { /* invalid */ }
    return null;
  }

  /**
   * Points a link at a URL, or turns it into a non-link placeholder when there
   * is no safe URL. External links open in a new tab without access to this page.
   */
  function setLink(a, value, opts) {
    opts = opts || {};
    var href = httpUrl(value, opts.httpsOnly);
    if (!href) {
      a.removeAttribute('href');
      a.removeAttribute('target');
      a.removeAttribute('rel');
      return false;
    }
    a.href = href;
    a.target = '_blank';
    a.rel = (opts.sponsored ? 'sponsored ' : '') + 'noopener noreferrer';
    return true;
  }

  function hex(value) {
    return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : null;
  }

  /** Sponsor image: an https URL or a file in assets/sponsors/, safe to put in CSS url(). */
  function imageUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    var url = /^assets\/sponsors\/[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/i.test(value) ? new URL(value, SITE_ROOT).href : httpUrl(value, true);
    return url && !/["'()\\\s]/.test(url) ? url : null;
  }

  /** Today's calendar date in the UAE (event dates are written that way). */
  function dubaiToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  function lang() { return typeof window.__fundsLang === 'function' ? window.__fundsLang() : 'en'; }
  function tr(text) { return typeof window.__fundsTr === 'function' ? window.__fundsTr(text) : text; }

  // i18n.js calls window.__fundsRelang after switching language; scripts that
  // write their own dynamic text (dates, counts) register here to redo it.
  var languageHooks = [];
  var previousRelang = window.__fundsRelang;
  window.__fundsRelang = function () {
    if (typeof previousRelang === 'function') previousRelang();
    languageHooks.forEach(function (fn) {
      try { fn(); } catch (e) { warn('Language refresh failed', e); }
    });
  };
  function onLanguageChange(fn) { languageHooks.push(fn); }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  window.FundsAeApi = Object.freeze({
    apiBase: API_BASE,
    meta: meta,
    get: get,
    submit: submit,
    valid: valid,
    items: items,
    httpUrl: httpUrl,
    setLink: setLink,
    hex: hex,
    imageUrl: imageUrl,
    dubaiToday: dubaiToday,
    lang: lang,
    tr: tr,
    onLanguageChange: onLanguageChange,
    ready: ready,
    warn: warn
  });
})();
