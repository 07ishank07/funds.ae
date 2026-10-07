// The one GROQ query `npm run cms:pull` runs. It asks for exactly the fields
// the mapping uses, so nothing else in Sanity (drafts, hidden placements,
// editor notes) is ever downloaded. Hidden sponsors, Top Tweets items and
// packages (enabled == false) stay in Sanity and never reach the repository.

const published = '!(_id in path("drafts.**"))';

export const CONTENT_QUERY = `{
  "sponsors": *[_type == "sponsorItem" && enabled != false && ${published}] | order(slot asc, position asc, title asc) {
    "id": id.current, slot, title, blurb, label, logoText, website, url, colorFrom, colorTo,
    "image": image.asset->{url, mimeType, size}
  },
  "events": *[_type == "event" && ${published}] | order(startDate asc, title asc) {
    "id": id.current, title, eventType, startDate, endDate, city, venue, url, organiser, featured
  },
  "highlights": *[_type == "socialHighlight" && enabled != false && ${published}] | order(position asc, accountName asc) {
    "id": id.current, accountName, handle, text, url, initials, color
  },
  "tiers": *[_type == "advertiseTier" && enabled != false && ${published}] | order(position asc, tier asc) {
    tier, name, badge, price, priceNote, features, featured
  },
  "pages": *[_type == "page" && ${published}] | order(slug asc) {
    slug, title, intro, updatedAt, body
  }
}`;
