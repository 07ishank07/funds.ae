/**
 * Funds.ae Videos & Podcasts: the media library (demo content) and how it is drawn.
 *
 *  - Videos.dc.html: tabs All / Videos / Podcasts / Interviews / Events (also ?section=<id> in the address). "All"
 *    shows each section's newest four with "See all"; a tab shows every item of its section.
 *  - PodcastEpisode.dc.html?ep=<id>: one podcast episode's own page.
 *
 * Demo items only (titles, durations and dates are placeholders; no audio or video yet). Interviews name roles,
 * never real people. Everything is drawn with textContent. When the library moves to Sanity, MEDIA becomes data
 * from api/v1 with the same fields.
 */
(function () {
  'use strict';

  var SECTIONS = [
    { id: 'videos', kind: 'video', title: 'Videos', description: 'News clips, interviews and documentaries.' },
    { id: 'podcasts', kind: 'podcast', title: 'Podcasts', description: 'Audio episodes, each with its own episode page.' },
    { id: 'interviews', kind: 'interview', title: 'Interviews', description: 'CEOs, investors, developers and fund managers.' },
    { id: 'events', kind: 'event', title: 'Events', description: 'Conferences, panel discussions and webinars.' }
  ];
  var KIND_LABEL = { video: 'Video', podcast: 'Podcast', interview: 'Interview', event: 'Event' };
  var ALL_SHOWN = 4;

  // [id, kind, series, title, date, duration, thumb colour 1-7, format (events) or guest role (interviews)]
  var MEDIA = [
    ['capital-briefing-8', 'video', 'The Capital Briefing', 'Sovereign money, record REIT listings and the Gulf’s private credit rush', '2026-11-26', '14:32', 1],
    ['housing-gap', 'video', 'The Capital Briefing', 'The AED 78bn housing gap, and the private capital plan to close it', '2026-11-24', '15:09', 1],
    ['port-takeover-price', 'video', 'Deal Room', 'The port takeover that set a new price for Gulf logistics', '2026-11-24', '10:14', 3],
    ['dubai-residential-money', 'video', 'Real Estate Capital', 'Where the money is going in Dubai residential', '2026-11-24', '8:40', 4],
    ['family-offices-btr', 'video', 'Real Estate Capital', 'Why Gulf family offices are backing build-to-rent', '2026-11-22', '9:48', 4],
    ['abu-dhabi-logistics-price', 'video', 'The Capital Briefing', 'Abu Dhabi logistics takeover: what the price tells us', '2026-11-20', '13:05', 1],
    ['btr-fund-launch', 'video', 'Deal Room', 'Anatomy of a build-to-rent fund launch', '2026-11-20', '9:32', 3],
    ['grade-a-offices', 'video', 'Real Estate Capital', 'Grade A offices: why rents keep rising', '2026-11-20', '7:55', 4],
    ['infrastructure-trade', 'video', 'Documentary', 'Data centres, desalination and the new infrastructure trade', '2026-11-17', '24:02', 7],
    ['solar-water-financing', 'video', 'Deal Room', 'How a solar and water platform was financed', '2026-11-17', '11:48', 3],
    ['pension-infra-debt', 'video', 'Explainers', 'Pension funds and infrastructure debt, explained in five minutes', '2026-11-13', '5:10', 7],
    ['q3-in-numbers', 'video', 'The Capital Briefing', 'Q3 in numbers: Gulf venture and private equity', '2026-11-13', '11:40', 1],

    ['ep-14', 'podcast', 'The Funds.ae Podcast', 'Episode 14 · The private credit boom, and its risks', '2026-11-24', '38 min', 5],
    ['ep-13', 'podcast', 'The Funds.ae Podcast', 'Episode 13 · What sovereign funds want from partners', '2026-11-20', '42 min', 5],
    ['ep-12', 'podcast', 'The Funds.ae Podcast', 'Episode 12 · Islamic finance meets private equity', '2026-11-17', '36 min', 5],
    ['ep-11', 'podcast', 'The Funds.ae Podcast', 'Episode 11 · Raising a first fund in a slow market', '2026-11-13', '40 min', 5],
    ['ep-10', 'podcast', 'The Funds.ae Podcast', 'Episode 10 · Infrastructure debt for beginners', '2026-11-10', '33 min', 5],
    ['ep-9', 'podcast', 'The Funds.ae Podcast', 'Episode 9 · Private credit for SMEs: who is filling the bank gap?', '2026-11-06', '38 min', 5],

    ['never-selling', 'interview', 'GP Conversations', '“We were never selling”: a developer on turning down a billion-dirham offer', '2026-11-25', '18:44', 2, 'Developer'],
    ['credit-founder', 'interview', 'GP Conversations', 'A credit fund founder on lending where banks won’t', '2026-11-24', '31:20', 2, 'Fund manager'],
    ['difc-platform', 'interview', 'CEO Conversations', 'Building a real estate platform from DIFC', '2026-11-20', '27:45', 2, 'CEO'],
    ['family-office-picks', 'interview', 'Investor Conversations', 'How a family office picks its fund managers', '2026-11-17', '24:10', 2, 'Investor'],
    ['banker-to-gp', 'interview', 'GP Conversations', 'From banker to GP: lessons from a first fund', '2026-11-13', '29:58', 2, 'Fund manager'],
    ['venture-debt-lender', 'interview', 'Investor Conversations', 'Venture debt in the Gulf, explained by a lender', '2026-11-10', '22:36', 2, 'Investor'],

    ['lps-first-time', 'event', 'On Stage', 'What LPs want from first-time fund managers', '2026-11-24', '41:12', 6, 'Panel discussion'],
    ['keynote-next-decade', 'event', 'Fund Managers Forum', 'The next decade of Gulf private capital', '2026-11-20', '28:30', 6, 'Conference keynote'],
    ['re-debt-rate-peak', 'event', 'On Stage', 'Real estate debt after the rate peak', '2026-11-17', '37:44', 6, 'Panel discussion'],
    ['webinar-fund-admin', 'event', 'Funds.ae Webinars', 'Choosing a fund administrator in ADGM and DIFC', '2026-11-15', '52:10', 7, 'Webinar'],
    ['family-office-team', 'event', 'Private Wealth Congress', 'Building a family office team', '2026-11-13', '25:16', 6, 'Fireside chat'],
    ['webinar-islamic-funds', 'event', 'Funds.ae Webinars', 'Structuring a Sharia-compliant real estate fund', '2026-11-08', '47:35', 7, 'Webinar']
  ].map(function (m) {
    return { id: m[0], kind: m[1], series: m[2], title: m[3], date: m[4], duration: m[5], thumb: m[6], label: m[7] || null };
  });

  // Podcast episode pages: a short description and what is covered (demo text).
  var EPISODES = {
    'ep-14': ['Private credit has become the Gulf’s fastest-growing private market. We look at who is lending, on what terms, and where the risks are building.', ['Why banks are stepping back from mid-market lending', 'How credit funds price risk in the Gulf', 'What could go wrong in a downturn']],
    'ep-13': ['Sovereign wealth funds are writing more co-investment cheques than ever. What do they look for in a fund manager, and what makes them walk away?', ['Co-investment versus fund commitments', 'Governance and reporting expectations', 'Building a long-term relationship']],
    'ep-12': ['Sharia-compliant structures are moving into private equity. We cover how deals are structured and what investors should ask.', ['Murabaha, Ijara and equity structures', 'Screening portfolio companies', 'Where demand is coming from']],
    'ep-11': ['Raising a first fund is hard in any market, and harder in a slow one. What first-time managers are doing differently in 2026.', ['Anchor investors and seed deals', 'Track record without a fund', 'Fees, terms and timelines']],
    'ep-10': ['A plain-English introduction to infrastructure debt: what it is, who buys it and why pension funds like it.', ['Senior versus junior infrastructure debt', 'Typical returns and risks', 'Gulf projects coming to market']],
    'ep-9': ['Small and medium-sized companies need credit that banks often will not provide. Who is filling the gap in the UAE?', ['Government-backed SME schemes', 'Private credit and fintech lenders', 'What borrowers should compare']]
  };

  var dateFmt = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null;
  function dateText(iso) { return dateFmt ? dateFmt.format(new Date(iso + 'T00:00:00Z')) : iso; }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function newestFirst(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }
  function ofKind(kind) { return MEDIA.filter(function (m) { return m.kind === kind; }).sort(newestFirst); }
  function episodeHref(item) { return 'PodcastEpisode.dc.html?ep=' + encodeURIComponent(item.id); }

  /** A CSS-only thumbnail: the series name, a play mark and the duration (no images). */
  function thumb(item, big) {
    var box = el('div', 'vp-thumb vp-t' + item.thumb + (big ? ' vp-thumb-big' : ''));
    box.setAttribute('aria-hidden', 'true');
    box.appendChild(el('span', 'vp-mark', item.series));
    box.appendChild(el('span', 'vp-play'));
    box.appendChild(el('span', 'vp-dur', item.duration));
    return box;
  }

  /** One card. Podcast episodes link to their episode page; the rest say "coming soon" until the media is live. */
  function card(item) {
    var isEpisode = item.kind === 'podcast';
    var node = el(isEpisode ? 'a' : 'article', 'vp-card');
    if (isEpisode) node.href = episodeHref(item);
    node.appendChild(thumb(item));
    node.appendChild(el('p', 'vp-kind', KIND_LABEL[item.kind] + (item.label ? ' · ' + item.label : '')));
    node.appendChild(el('h3', 'vp-title', item.title));
    node.appendChild(el('p', 'vp-meta', item.series + ' · ' + dateText(item.date) + ' · ' + item.duration));
    return node;
  }

  /* --------------------------------- Videos page --------------------------------- */

  function renderLibrary(root) {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-vp-tab]'));
    var current = 'all';
    function draw() {
      root.textContent = '';
      SECTIONS.forEach(function (s) {
        if (current !== 'all' && current !== s.id) return;
        var items = ofKind(s.kind);
        var section = el('section', 'vp-section');
        section.setAttribute('aria-labelledby', 'vp-' + s.id + '-title');
        var head = el('div', 'vp-head');
        var h2 = el('h2', null, s.title);
        h2.id = 'vp-' + s.id + '-title';
        head.appendChild(h2);
        head.appendChild(el('p', null, s.description));
        if (current === 'all' && items.length > ALL_SHOWN) {
          var more = el('button', 'vp-more', 'See all ' + items.length);
          more.type = 'button';
          more.addEventListener('click', function () { choose(s.id, true); });
          head.appendChild(more);
        }
        section.appendChild(head);
        var grid = el('div', 'vp-grid');
        (current === 'all' ? items.slice(0, ALL_SHOWN) : items).forEach(function (item) { grid.appendChild(card(item)); });
        section.appendChild(grid);
        root.appendChild(section);
      });
    }
    function choose(id, scroll) {
      current = SECTIONS.some(function (s) { return s.id === id; }) ? id : 'all';
      tabs.forEach(function (t) { t.setAttribute('aria-pressed', String(t.getAttribute('data-vp-tab') === current)); });
      try {
        var url = new URL(window.location.href);
        if (current === 'all') url.searchParams.delete('section'); else url.searchParams.set('section', current);
        window.history.replaceState(null, '', url);
      } catch (e) { /* the address just stays as it was */ }
      draw();
      if (scroll) document.querySelector('.vp-tabs').scrollIntoView({ block: 'start' });
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { choose(t.getAttribute('data-vp-tab'), false); }); });
    choose(new URLSearchParams(window.location.search).get('section') || 'all', false);
  }

  /* ------------------------------ Podcast episode page ------------------------------ */

  function renderEpisode(root) {
    var id = new URLSearchParams(window.location.search).get('ep');
    var episodes = ofKind('podcast');
    var item = episodes.filter(function (e) { return e.id === id; })[0];
    root.textContent = '';
    if (!item) {
      root.appendChild(el('h1', 'ep-title', 'Episode not found'));
      var back = el('p', 'ep-blurb');
      var link = el('a', null, 'See all podcast episodes');
      link.href = 'Videos.dc.html?section=podcasts';
      back.appendChild(link);
      root.appendChild(back);
      return;
    }
    document.title = item.title + ' · Funds.ae';
    var detail = EPISODES[item.id] || ['', []];
    root.appendChild(el('p', 'vp-kind', 'Podcast · ' + item.series));
    root.appendChild(el('h1', 'ep-title', item.title));
    root.appendChild(el('p', 'vp-meta', dateText(item.date) + ' · ' + item.duration));
    var player = el('div', 'ep-player');
    player.appendChild(thumb(item, true));
    player.appendChild(el('p', 'ep-soon', 'Audio coming soon (demo episode).'));
    root.appendChild(player);
    if (detail[0]) root.appendChild(el('p', 'ep-blurb', detail[0]));
    if (detail[1].length) {
      root.appendChild(el('h2', 'ep-sub', 'In this episode'));
      var list = el('ul', 'ep-topics');
      detail[1].forEach(function (t) { list.appendChild(el('li', null, t)); });
      root.appendChild(list);
    }
    var others = episodes.filter(function (e) { return e.id !== item.id; });
    if (others.length) {
      var more = el('section', 'vp-section');
      more.setAttribute('aria-labelledby', 'ep-more-title');
      var head = el('div', 'vp-head');
      var h2 = el('h2', null, 'More episodes');
      h2.id = 'ep-more-title';
      head.appendChild(h2);
      more.appendChild(head);
      var grid = el('div', 'vp-grid');
      others.slice(0, 4).forEach(function (e) { grid.appendChild(card(e)); });
      more.appendChild(grid);
      root.appendChild(more);
    }
  }

  function start() {
    var library = document.querySelector('[data-vp-library]');
    if (library) renderLibrary(library);
    var episode = document.querySelector('[data-vp-episode]');
    if (episode) renderEpisode(episode);
  }
  window.FundsAeMedia = Object.freeze({ sections: SECTIONS, items: MEDIA });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
