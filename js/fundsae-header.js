/**
 * Funds.ae site header behaviour, shared by every page (this.html and the .dc.html pages).
 *
 *  - Menu: on phones and tablets the header's "Open menu" button opens a panel of the site pages (the sections, Partner
 *    with us, About and Contact us) directly under the header. Links resolve against the logo's link, so they work
 *    from story pages in a sub-folder too.
 *  - Category links from other pages arrive as this.html?capital=<id> (or the older ?category=<label>); this script
 *    clicks that category in the home page's bar once the news has loaded, so the column is filtered.
 * There is no header search. Text is set with textContent only; links are fixed site pages.
 */
(function () {
  'use strict';

  var MENU = [['Real Estate Stories', 'this.html'], ['Videos & Podcasts', 'Videos.dc.html'], ['Grants & Funding', 'GrantsFunding.dc.html'],
    ['Events', 'Events.dc.html'], ['Finance Careers', 'Careers.dc.html'], ['Partner with us', 'PartnerWithUs.dc.html'],
    ['About', 'About.dc.html'], ['Contact us', 'Contact.dc.html']];
  var tr = function (s) { return (window.__fundsTr || function (x) { return x; })(s); };

  function css() {
    if (document.getElementById('fxh-panels-style')) return;
    var style = document.createElement('style');
    style.id = 'fxh-panels-style';
    style.textContent =
      '.fxh-panel{position:relative;z-index:59;background:#0E3A43;color:#F1F5F4;padding:4px 16px 16px;box-shadow:0 8px 18px rgba(14,58,67,.18)}' +
      '.fxh-panel[hidden]{display:none}' +
      '.fxh-panel a{display:block;padding:12px 0;border-bottom:1px solid rgba(241,245,244,.16);color:#F1F5F4;font-size:15px;font-weight:500;text-decoration:none}' +
      '.fxh-panel a:last-child{border-bottom:0}' +
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

  /** The menu panel under the header, created on first use (and again if the page re-created it). */
  function menuPanel(header) {
    var panel = document.getElementById('fxh-menu-panel');
    if (panel && document.body.contains(panel)) return panel;
    css();
    var brand = header.querySelector('.fxb-brand');
    var base = brand ? brand.href : window.location.href;
    panel = document.createElement('nav');
    panel.id = 'fxh-menu-panel';
    panel.className = 'fxh-panel';
    panel.setAttribute('aria-label', 'Site menu');
    panel.hidden = true;
    MENU.forEach(function (item) {
      var a = document.createElement('a');
      a.href = new URL(item[1], base).href;
      a.textContent = tr(item[0]);
      panel.appendChild(a);
    });
    header.after(panel);
    return panel;
  }

  // One listener on the document (capture phase): the home page builds its header after load.
  function onClick(event) {
    var target = event.target.closest ? event.target : event.target.parentElement;
    var button = target && target.closest('header.fxb button[aria-label="Open menu"]');
    if (!button) return;
    event.preventDefault();
    var panel = menuPanel(button.closest('header.fxb'));
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  }

  /** The category bar link for ?capital=<id> (a Capital Type) or the older ?category=<label>. */
  function categoryLink(capital, category) {
    return Array.prototype.slice.call(document.querySelectorAll('.fx-catbar a[data-category]')).filter(function (a) {
      return capital ? a.getAttribute('data-topics') === 'capital:' + capital : a.dataset.category === category;
    })[0];
  }

  function applyQuery() {
    var params = new URLSearchParams(window.location.search);
    var category = (params.get('category') || '').trim();
    var capital = (params.get('capital') || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(capital)) capital = '';
    if (!document.querySelector('.news') || (!category && !capital)) return;
    whenNewsReady(function () {
      // The bar may still be being built: look again for a few seconds.
      var tries = 0;
      var timer = setInterval(function () {
        var link = categoryLink(capital, category);
        if (link || ++tries > 20) {
          clearInterval(timer);
          if (link) link.click();
        }
      }, 200);
    });
  }

  function start() {
    document.addEventListener('click', onClick, true);
    applyQuery();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
