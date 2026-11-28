/*
 * Partners logo wall (frontend_demo/partners-wall.css), shown at the foot of the home, Careers, Events & Expos and
 * Videos & Podcasts pages, just above the footer.
 *
 * 1. A page that only has the empty mount <section class="partners" aria-labelledby="partners-title"
 *    data-fundsae-partners></section> gets the heading and the built-in placeholder partners here (textContent only).
 *    js/fundsae-connector.js (slot "sponsor-companies", sponsors.json "professionalServices") then swaps them for the
 *    published sponsors, so this script must load before the connector.
 * 2. Every wall keeps an aria-hidden copy of its list beside it so the right-to-left loop is seamless, and makes a fresh
 *    copy whenever the connector replaces the cards. The speed stays the same whatever the number of companies.
 */
(function () {
  'use strict';

  // Placeholder partners (fictional, demo only) shown until sponsors.json answers: [initials, name, website].
  var DEMO = [
    ['LAW', 'Meydan Legal Advisors', 'www.meydanlegal-dummy.ae'], ['AUD', 'Atlas Fund Auditors', 'www.atlasauditors-dummy.ae'],
    ['TAX', 'Oasis Tax Advisory', 'www.oasistax-dummy.ae'], ['ADM', 'Palm Gate Fund Administration', 'www.palmgateadmin-dummy.ae'],
    ['CON', 'Namaa Strategy Consulting', 'www.namaaconsulting-dummy.ae'], ['IT', 'Vertex Fund Tech Services', 'www.vertexfundtech-dummy.ae'],
    ['CMP', 'Crescent Compliance Partners', 'www.crescentcompliance-dummy.ae'], ['ACT', 'Gulf Actuarial Group', 'www.gulfactuarial-dummy.ae'],
    ['CUS', 'Emirates Custody Services', 'www.emiratescustody-dummy.ae'], ['CF', 'Noor Corporate Finance', 'www.noorcorpfin-dummy.ae'],
    ['TRU', 'Sahra Legal & Trust', 'www.sahratrust-dummy.ae'], ['RSK', 'Desert Risk Analytics', 'www.desertrisk-dummy.ae'],
    ['FT', 'Marina Fund Tech', 'www.marinafundtech-dummy.ae'], ['INV', 'Harbor Investor Services', 'www.harborinvestor-dummy.ae'],
    ['ADV', 'Falcon Advisory Partners', 'www.falconadvisory-dummy.ae'], ['SWA', 'Summit Wealth Advisory', 'www.summit-dummy.ae'],
    ['BCM', 'Bayan Capital Markets', 'www.bayan-dummy.ae'], ['RFG', 'Ridge Fund Governance', 'www.ridge-dummy.ae'],
    ['DPA', 'Dune Payments Advisory', 'www.dune-dummy.ae'], ['PTS', 'Pearl Trust Services', 'www.pearl-dummy.ae']
  ];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  /** Fills an empty mount with the heading and the placeholder partners (the same markup as Careers.dc.html). */
  function build(section) {
    if (section.querySelector('.partners-list')) return;
    var title = el('h2', 'partners-title', 'Partners');
    title.id = 'partners-title';
    title.appendChild(el('span', 'fxh-sr', ' (sponsored)'));
    var viewport = el('div', 'partners-viewport');
    var track = el('div', 'partners-track');
    var list = el('div', 'partners-list');
    list.setAttribute('data-fundsae-slot', 'sponsor-companies');
    DEMO.forEach(function (p) {
      var a = el('a', 'partner');
      a.href = '#';
      var logo = el('div', 'logo', p[0]);
      logo.setAttribute('aria-hidden', 'true');
      var text = el('span');
      text.appendChild(el('span', 'name', p[1]));
      text.appendChild(el('span', 'site', p[2]));
      a.appendChild(logo);
      a.appendChild(text);
      list.appendChild(a);
    });
    track.appendChild(list);
    viewport.appendChild(track);
    section.appendChild(title);
    section.appendChild(viewport);
  }

  /** Keeps the aria-hidden copy beside the list, so the loop is seamless. */
  function loop(section) {
    var track = section.querySelector('.partners-track');
    var list = track && track.querySelector('[data-fundsae-slot="sponsor-companies"]');
    if (!list || section.__fundsPartnersList === list) return;
    section.__fundsPartnersList = list;
    var copy = null;
    function sync() {
      if (copy) copy.remove();
      copy = null;
      var count = list.querySelectorAll(':scope > a').length;
      section.toggleAttribute('data-still', count < 2);
      if (count < 2) return;
      copy = list.cloneNode(true);
      copy.removeAttribute('data-fundsae-slot');
      copy.setAttribute('aria-hidden', 'true');
      copy.querySelectorAll('a').forEach(function (a) { a.tabIndex = -1; });
      track.appendChild(copy);
      // Two rows of logos: about 3 seconds per company keeps an unhurried ~40 px/s.
      track.style.setProperty('--partners-duration', (count * 3) + 's');
    }
    sync();
    new MutationObserver(sync).observe(list, { childList: true });
  }

  function setUp() {
    document.querySelectorAll('section.partners[data-fundsae-partners]').forEach(build);
    document.querySelectorAll('section.partners').forEach(loop);
  }
  setUp();
  // The home page's template engine can redraw the page after this runs, leaving the mount empty: build it again then.
  // (Both steps skip a wall that is already set up, so this costs little.)
  new MutationObserver(setUp).observe(document.body, { childList: true, subtree: true });
})();
