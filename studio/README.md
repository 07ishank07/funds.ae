# funds.ae Sanity Studio

The editors' CMS for sponsors, events, the home page "Top Tweets" box, the Advertise
packages and the About/Privacy/Terms copy. News and jobs are not managed here.

```bash
cp .env.example .env      # fill in SANITY_STUDIO_PROJECT_ID
npm install
npm run dev               # http://localhost:3333
npm run schema:validate   # what CI checks
npm run build
npm run deploy            # https://<SANITY_STUDIO_HOST>.sanity.studio
```

Every limit lives in `schemaTypes/rules.js` and must match the backend
(`backend/test/cms.test.js` fails if they drift).

Setup, publishing flow, how to add fields and troubleshooting:
[`docs/SANITY-CMS-GUIDE.md`](../docs/SANITY-CMS-GUIDE.md).
