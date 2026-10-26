// The Real Estate Capital News page's filter rules (js/fundsae-news-filter.js), loaded the same
// way the browser loads them: Capital Type and Asset Class filters work alone (any chosen value)
// and together (both must match), geography and search narrow further, sort and paging behave,
// and the URL round-trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const F = require('../../js/fundsae-news-filter.js');

const tag = (id) => ({ id, label: id.toUpperCase() });
const story = (id, date, { capital = [], asset = [], geo = [], featured = false, headline = `Story ${id}` } = {}) => ({
  id, headline, summary: `Summary of ${id}.`, source: 'Example Wire', publishedAt: date, featured,
  capitalTypes: capital.map(tag), assetClasses: asset.map(tag), geography: geo.map(tag)
});
const stories = [
  story('a', '2026-10-20T00:00:00Z', { capital: ['sovereign-wealth'], asset: ['office'], geo: ['uae'] }),
  story('b', '2026-10-21T00:00:00Z', { capital: ['pension-funds'], asset: ['industrial-logistics'], geo: ['uk'] }),
  story('c', '2026-10-22T00:00:00Z', { capital: ['sovereign-wealth', 'pension-funds'], asset: ['industrial-logistics'], geo: ['uae'] }),
  story('d', '2026-10-23T00:00:00Z', { capital: ['reits'], asset: ['office', 'retail'], geo: ['europe'], headline: 'Tidewell REIT buys Dubai mall' }),
  story('e', '2026-10-19T00:00:00Z', { capital: ['private-equity'], asset: ['residential-multifamily'], geo: ['uae'], featured: true })
];
const taxonomy = {
  capitalTypes: ['sovereign-wealth', 'pension-funds', 'reits', 'private-equity'].map(tag),
  assetClasses: ['office', 'industrial-logistics', 'retail', 'residential-multifamily'].map(tag),
  geographies: ['uae', 'uk', 'europe'].map(tag),
  sections: [
    { id: 'commercial-real-estate', topics: [], assetClasses: ['office', 'industrial-logistics', 'retail'] },
    { id: 'residential-real-estate', topics: [], assetClasses: ['residential-multifamily'] },
    { id: 'grants-funding', topics: ['grants-funding'], assetClasses: [] }
  ]
};
const ids = (state) => F.filterStories(stories, { capital: [], asset: [], geo: [], section: '', q: '', sort: 'newest', page: 1, ...state }, taxonomy).map((s) => s.id);

test('no filters: newest first, featured stories lead', () => {
  assert.deepEqual(ids({}), ['e', 'd', 'c', 'b', 'a']);
});

test('several Capital Types match any of them; several Asset Classes match any of them', () => {
  assert.deepEqual(ids({ capital: ['sovereign-wealth'] }), ['c', 'a']);
  assert.deepEqual(ids({ capital: ['sovereign-wealth', 'reits'] }), ['d', 'c', 'a']);
  assert.deepEqual(ids({ asset: ['office'] }), ['d', 'a']);
  assert.deepEqual(ids({ asset: ['office', 'industrial-logistics'] }), ['d', 'c', 'b', 'a']);
});

test('Capital Type and Asset Class together: both must match', () => {
  assert.deepEqual(ids({ capital: ['sovereign-wealth'], asset: ['industrial-logistics'] }), ['c']);
  assert.deepEqual(ids({ capital: ['sovereign-wealth', 'pension-funds'], asset: ['industrial-logistics'] }), ['c', 'b']);
  assert.deepEqual(ids({ capital: ['reits'], asset: ['industrial-logistics'] }), [], 'nothing matches both');
});

test('geography, home page boxes and search narrow further', () => {
  assert.deepEqual(ids({ geo: ['uae'] }), ['c', 'a', 'e']);
  assert.deepEqual(ids({ geo: ['uae'], capital: ['sovereign-wealth'], asset: ['office'] }), ['a']);
  assert.deepEqual(ids({ section: 'commercial-real-estate' }), ['d', 'c', 'b', 'a'], 'a box stands for its Asset Classes');
  assert.deepEqual(ids({ section: 'residential-real-estate', capital: ['reits'] }), []);
  assert.deepEqual(ids({ q: 'dubai mall' }), ['d'], 'every search word must appear');
  assert.deepEqual(ids({ q: 'STORY B' }), ['b'], 'case does not matter');
  assert.deepEqual(ids({ q: 'summary of c.' }), ['c'], 'summaries count');
  assert.deepEqual(ids({ q: 'industrial-logistics' }), ['c', 'b'], 'category labels count');
});

test('oldest first, and filtered views do not pin featured stories', () => {
  assert.deepEqual(ids({ sort: 'oldest' }), ['e', 'a', 'b', 'c', 'd']);
  assert.deepEqual(ids({ geo: ['uae'] }), ['c', 'a', 'e'], 'filtered: plain date order');
});

test('pages of twenty with "load more"', () => {
  const many = Array.from({ length: 45 }, (_, i) => story(`s${i}`, new Date(Date.UTC(2026, 9, 1, i)).toISOString()));
  const page1 = F.paginate(many, 1);
  assert.equal(page1.items.length, 20);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.total, 45);
  assert.equal(F.paginate(many, 2).items.length, 40);
  assert.equal(F.paginate(many, 3).hasMore, false);
  assert.equal(F.paginate([], 1).hasMore, false);
});

test('the URL round-trips, and unknown or malformed ids are dropped', () => {
  const state = F.parseQuery('?capital=reits,banks&asset=office&geo=uae&q=%20dubai%20%20mall%20&sort=oldest&page=2');
  assert.deepEqual(state, { capital: ['reits', 'banks'], asset: ['office'], geo: ['uae'], section: '', q: 'dubai mall', sort: 'oldest', page: 2 });
  assert.equal(F.toQuery(state), '?capital=reits%2Cbanks&asset=office&geo=uae&q=dubai+mall&sort=oldest&page=2');
  assert.deepEqual(F.parseQuery(F.toQuery(state)), state);
  assert.equal(F.toQuery(F.parseQuery('')), '');
  const known = F.known(F.parseQuery('?capital=reits,banks,<script>&asset=moon&section=grants-funding&geo=uk'), taxonomy);
  assert.deepEqual([known.capital, known.asset, known.section, known.geo], [['reits'], [], '', ['uk']], 'topic boxes are not asset filters');
  assert.equal(F.parseQuery('?page=99999').page, 1);
  assert.equal(F.parseQuery(`?q=${'x'.repeat(300)}`).q.length, 100);
});
