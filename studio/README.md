# funds.ae Sanity Studio

The editors' CMS: the **News Review Queue** (ingested stories wait here until an approver
publishes them), news sources, Capital Types and Asset Classes, plus sponsors, events, the
home page "Top Tweets" box, the Advertise packages and the About/Privacy/Terms copy.
Jobs are not managed here.

```bash
cp .env.example .env      # fill in SANITY_STUDIO_PROJECT_ID
npm install
npm run dev               # http://localhost:3333
npm run schema:validate   # what CI checks
npm run build
npm run deploy            # https://<SANITY_STUDIO_HOST>.sanity.studio
```

Every limit lives in `schemaTypes/rules.js` (and, for news, `schemaTypes/newsRules.js`) and
must match the backend (`backend/test/cms.test.js` fails if they drift). The news workflow
buttons are in `actions/newsActions.jsx`; their logic is `schemaTypes/newsWorkflow.js`, tested
by `backend/test/workflow.test.js`.

Setup, publishing flow, how to add fields and troubleshooting:
[`docs/SANITY-CMS-GUIDE.md`](../docs/SANITY-CMS-GUIDE.md). The news queue:
[`docs/NEWS-REVIEW-GUIDE.md`](../docs/NEWS-REVIEW-GUIDE.md).
