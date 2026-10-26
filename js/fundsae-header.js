/**
 * Funds.ae site header behaviour, shared by every page (this.html and the .dc.html pages).
 *
 *  - Mobile header buttons: "Search" opens a search row and "Open menu" a menu of the site pages, each in a
 *    panel directly under the dark header bar.
 *  - Search: on the home page it filters the news column in place (the #home-search box the connector binds);
 *    on any other page it opens the home page with ?q=…, which this script then applies once the news loads.
 *  - Category links from other pages arrive as this.html?category=Sovereign; this script clicks that category
 *    in the home page's bar once the news has loaded, so the column is filtered.
 * Text is set with textContent only; links are fixed site pages.
 */
(function () {
  'use strict';

  var MENU = [['Advertise', 'Advertise.dc.html'], ['Careers', 'Careers.dc.html'], ['Events', 'Events.dc.html'],
    ['About', 'About.dc.html'], ['Contact us', 'Contact.dc.html']];
  var tr = function (s) { return (window.__fundsTr || function (x) { return x; })(s); };

  function css() {
    if (document.getElementById('fxh-panels-style')) return;
    var style = document.createElement('style');
    style.id = 'fxh-panels-style';
    style.textContent =
      '.fxh-panel{background:#0E3A43;color:#F1F5F4;padding:4px 16px 16px;box-shadow:0 8px 18px rgba(14,58,67,.18)}' +
      '.fxh-panel[hidden]{display:none}' +
      '.fxh-panel a{display:block;padding:12px 0;border-bottom:1px solid rgba(241,245,244,.16);color:#F1F5F4;font-size:15px;font-weight:500;text-decoration:none}' +
      '.fxh-panel a:last-child{border-bottom:0}' +
      '.fxh-panel form{display:flex;gap:8px;margin:8px 0 0}' +
      '.fxh-panel input{flex:1;min-width:0;height:42px;padding:0 12px;border:0;border-radius:3px;font:inherit;font-size:15px;color:#0E3A43}' +
      '.fxh-panel button{height:42px;padding:0 16px;border:0;border-radius:3px;background:#4FB3B8;color:#0E3A43;font:inherit;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}' +
      '@media (min-width:981px){.fxh-panel{display:none!important}}';
    document.head.appendChild(style);
  }

  /** Runs fn once the home page news has rendered (or after ~10 s regardless). */
  function whenNewsReady(fn) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var ready = document.querySelector('.news [data-fundsae-story]') || tries > 40;
      if (ready) { clearInterval(timer); fn(); }
    }, 250);
  }

  function runSearch(query) {
    var input = document.getElementById('home-search');
    if (!input) {
      window.location.href = 'this.html?q=' + encodeURIComponent(query);
      return;
    }
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    var news = document.querySelector('main.wrap > .news');
    if (news) news.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** The two panels under the mobile header, created on first use (and again if the page re-created them). */
  function panels(header) {
    var searchPanel = document.getElementById('fxh-search-panel');
    var menuPanel = document.getElementById('fxh-menu-panel');
    if (searchPanel && menuPanel && document.body.contains(searchPanel)) return { search: searchPanel, menu: menuPanel };
    css();
    searchPanel = document.createElement('div');
    searchPanel.id = 'fxh-search-panel';
    searchPanel.className = 'fxh-panel';
    searchPanel.hidden = true;
    var form = document.createElement('form');
    form.setAttribute('role', 'search');
    var input = document.createElement('input');
    input.type = 'search';
    input.name = 'q';
    input.maxLength = 100;
    input.placeholder = tr('Search news, funds and firms');
    input.setAttribute('aria-label', tr('Search Funds.ae'));
    var go = document.createElement('button');
    go.type = 'submit';
    go.textContent = tr('Search');
    form.appendChild(input);
    form.appendChild(go);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var q = input.value.replace(/\s+/g, ' ').trim().slice(0, 100);
      if (!q) return;
      searchPanel.hidden = true;
      runSearch(q);
    });
    searchPanel.appendChild(form);

    menuPanel = document.createElement('nav');
    menuPanel.id = 'fxh-menu-panel';
    menuPanel.className = 'fxh-panel';
    menuPanel.setAttribute('aria-label', 'Site menu');
    menuPanel.hidden = true;
    MENU.forEach(function (item) {
      var a = document.createElement('a');
      a.href = item[1];
      a.textContent = tr(item[0]);
      menuPanel.appendChild(a);
    });
    header.after(searchPanel);
    searchPanel.after(menuPanel);
    return { search: searchPanel, menu: menuPanel };
  }

  // One listener on the document (capture phase): the home page's design runtime can re-create its header,
  // which would drop listeners bound to the buttons themselves.
  function onClick(event) {
    var target = event.target.closest ? event.target : event.target.parentElement;
    var button = target && target.closest('header.m-only button[aria-label="Search"], header.m-only button[aria-label="Open menu"]');
    if (!button) return;
    event.preventDefault();
    var p = panels(button.closest('header.m-only'));
    var isSearch = button.getAttribute('aria-label') === 'Search';
    var open = isSearch ? p.search : p.menu;
    var other = isSearch ? p.menu : p.search;
    other.hidden = true;
    open.hidden = !open.hidden;
    button.setAttribute('aria-expanded', String(!open.hidden));
    if (!open.hidden && isSearch) open.querySelector('input').focus();
  }

  /** The category bar link for ?capital=<id> (a Capital Type) or the older ?category=<label>. */
  function categoryLink(capital, category) {
    return Array.prototype.slice.call(document.querySelectorAll('.fx-catbar a[data-category]')).filter(function (a) {
      return capital ? a.getAttribute('data-topics') === 'capital:' + capital : a.dataset.category === category;
    })[0];
  }

  function applyQuery() {
    var params = new URLSearchParams(window.location.search);
    var q = (params.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    var category = (params.get('category') || '').trim();
    var capital = (params.get('capital') || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(capital)) capital = '';
    if (!document.querySelector('.news') || (!q && !category && !capital)) return;
    whenNewsReady(function () {
      if (capital || category) {
        // The bar may still be swapping in the editors' Capital Types: look again for a few seconds.
        var tries = 0;
        var timer = setInterval(function () {
          var link = categoryLink(capital, category);
          if (link || ++tries > 20) {
            clearInterval(timer);
            if (link) link.click();
          }
        }, 200);
      }
      if (q) runSearch(q);
    });
  }

  function start() {
    document.addEventListener('click', onClick, true);
    applyQuery();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
