# Funds.ae: setup guide

Most of this is done in a web browser. Nothing needs to be installed unless you want the website forms to work (section 7).

You will: (1) put the files on GitHub, (2) turn on GitHub Pages, (3) let GitHub run the daily job, (4) check the site, (5) manage sponsors and events, (6) switch from demo data to real news, and optionally (7) run the Funds.ae server so the contact, newsletter, sponsorship, "Post a role" and "Submit your event" forms are received.

Whenever this guide says **save to GitHub**, do this in vscode.dev:

1. Click the **Source Control** icon in the left sidebar (it looks like a branch).
2. Hover over the word **Changes** and click the **+** icon. (Same as `git add .`)
3. Type a short message in the box at the top, for example `update site`.
4. Click **Commit**. (Same as `git commit -m "update site"`)
5. Click **Sync Changes** or **Push**. (Same as `git push`)

---

## How the folders fit together

| Folder or file | What it is |
|---|---|
| `frontend_demo/` | The website pages: `this.html` (home), `Careers.dc.html`, `Advertise.dc.html`, `Contact.dc.html`, `About.dc.html`, `Privacy.dc.html`, `Terms.dc.html` |
| `index.html` | Sends visitors from the site root to `frontend_demo/this.html` |
| `i18n.js` | The English / Arabic switch used by every page |
| `js/` | The scripts that fill the pages with data and send the forms. The pages already load them; there is nothing to paste |
| `api/v1/` | The data the pages read (news, jobs, events, sponsors), rebuilt every day |
| `backend/` | The programs that build `api/v1/`, plus the optional server |
| `admin/` | The sponsor manager |
| `assets/sponsors/` | Sponsor logos and images uploaded by the sponsor manager |
| `.github/workflows/` | The daily job, the sponsor/events publisher and the tests |

## 1. Put the files on GitHub

1. Open your repository in vscode.dev.
2. Make sure the file list has everything in the table above at the top level (`.github`, `admin`, `api`, `assets`, `backend`, `frontend_demo`, `js`, `index.html`, `i18n.js`, `.gitignore`, `.nojekyll`).
   - Mac users: folders starting with a dot are hidden in Finder. Press **Cmd + Shift + .** to show them.
3. **Save to GitHub**.
4. On github.com, check that `.github/workflows` contains four files: `ci.yml`, `daily-ingest.yml`, `publish-content.yml` and `tests.yml`.

## 2. Turn on GitHub Pages

1. On github.com: your repository → **Settings** → **Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, and click **Save**.
3. After a minute the page shows your site address, for example `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

## 3. Let GitHub run the job

1. On github.com, open your repository → **Settings** → **Actions** → **General**.
2. Under **Workflow permissions**, leave the default (**Read repository contents**). Each workflow asks for exactly the permissions it needs.
3. Click the **Actions** tab. If GitHub asks you to enable workflows, click the green button.
4. In the left list, click **Daily news and jobs update**, then **Run workflow** → **Run workflow**.
5. Wait about one minute and refresh. A green tick means it worked. A red cross: click it, then the step with the red cross, to read what went wrong.

From now on this runs by itself every day at 07:00 UAE time.

## 4. Check the site

Open `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/` (it forwards to `frontend_demo/this.html`).

- The top line shows today's date and a small **Demo data** label while the site uses sample data.
- **UAE News** and **Global News** switch between the two news lists. **View All** appears when a list has more stories than fit.
- The search box above the logo filters the stories as you type.
- The careers column, events, sponsor areas and the two tile grids (real estate and infrastructure; grants and funding) all come from the backend.
- On the Careers page, the role list, **Featured Employers** (click one to see only its roles) and the events list come from the backend.
- The **العربية** button switches the interface to Arabic.
- On GitHub Pages the forms say "This demo site does not send forms yet. Nothing was sent." That is expected: GitHub Pages cannot receive forms. See section 7.

If you still see old content, wait five minutes (GitHub Pages caches files) and press **Ctrl + Shift + R**.

You can see the raw data too, for example `.../api/v1/news.json` or `.../api/v1/events.json`.

## 5. Manage sponsors and events

### Create an access token (once)
1. On github.com, click your profile picture (top right) → **Settings** → **Developer settings** (bottom of the left menu).
2. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
3. Name it `Funds.ae sponsor manager` and set an expiry date.
4. **Repository access**: **Only select repositories** → pick your website repository.
5. **Permissions** → **Repository permissions** → **Contents**: **Read and write**. Leave everything else as **No access**.
6. Click **Generate token** and copy it. GitHub shows it only once. Keep it in a password manager. Never paste it into a file in the repository.

### Use the sponsor manager
1. Open `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/admin/`.
2. Check the username, repository and branch, paste the token, click **Connect**. Leave **Remember** unticked on shared computers.
3. Choose an area on the left: **Platinum sponsors**, **Gold sponsors**, **Sponsored posts**, **Videos and podcasts**, **Featured companies** or **Career resources**. Each shows where it appears and how many items fit.
4. Edit text and links (links must start with `https://`, or use `#` for "no link yet"), upload logos or images (PNG, JPG or WebP, up to 500 KB), reorder, hide or add items.
5. Click **Save changes**. The site updates in about two minutes. If the publish step finds a problem, the previous sponsors stay live and the **Actions** tab explains what to fix.

### Events
Events are listed in `backend/config/events.json`. Copy the example from the notes at the top of that file, one block per event, and **save to GitHub**. The site updates in about two minutes; past events drop off by themselves. While the site is in demo mode it shows sample events instead.

## 6. Switch to real news (live mode)

1. In vscode.dev open `backend/config/settings.json`.
2. Change `"mode": "demo"` to `"mode": "live"`.
3. **Save to GitHub**, then run the workflow again (step 3.4).
4. Open `.../api/v1/sources.json`. Each source shows a `status`:
   - `ok`: working.
   - `error` or `not-found`: the feed address is wrong or blocked. Open the source's `url` in a browser. If you don't see XML with `<item>` or `<entry>`, find the right feed address on the publisher's site, or set `"enabled": false` for that source in `backend/config/sources.news.json`.
5. Before relying on a publisher, read its terms of use for RSS feeds. Some allow personal use only. Disable any source whose terms don't fit a commercial site.
6. To add job listings, follow the notes at the top of `backend/config/sources.jobs.json`. To post your own roles, edit `backend/config/jobs.manual.json` (the example roles are hidden automatically in live mode).
7. In live mode the **Demo data** label disappears, and any area without real data shows "Nothing to show yet" instead of sample content.
8. Replace the sample sponsors (all marked "(demo)") with real, contracted sponsors, and add real events to `events.json`.

## 7. Receive the website forms (optional)

GitHub Pages only serves files, so it cannot receive forms. To accept them, run the Funds.ae server on a host that keeps files between restarts (for example a small VPS, or Render/Railway/Fly.io with a persistent disk). It serves the website, the data API and the forms from one address.

1. Put the repository on the host and install Node.js 20 or newer.
2. In the `backend` folder run `npm ci`.
3. Copy `backend/.env.example` to `backend/.env` (or set the same values in your host's dashboard) and fill in at least:
   - `ALLOWED_ORIGINS=https://your-domain.ae`
   - `TRUST_PROXY=true` if the host puts a proxy in front of the app (most do)
   - `HSTS=true` once the site is on HTTPS
   - `SUBMISSIONS_HASH_SALT=` a long random value
   - `ADMIN_API_TOKEN=` a long random value (at least 32 characters) if you want to read submissions over the web
4. Start it with `npm run serve`. Visit `https://your-domain.ae/`: the forms now show "Thank you…" messages instead of the demo notice.
5. Read submissions either in `backend/data/submissions/*.jsonl` on the server, or with
   `curl -H "Authorization: Bearer YOUR_ADMIN_API_TOKEN" "https://your-domain.ae/api/v1/admin/submissions?kind=contact"`
   (`kind` is `contact`, `newsletter`, `advertise`, `event` or `job`).
6. "Post a role" and "Submit your event" entries are never published automatically. Review them and copy the ones you approve into `backend/config/jobs.manual.json` or `backend/config/events.json`.
7. Delete old submissions regularly with `npm run submissions:prune` (keeps 180 days by default; change `submissions.retentionDays` in `settings.json`). Update the Privacy Policy page to say what the forms collect and how long it is kept.

Submissions contain personal data. They are stored outside `api/`, are never published, and `.gitignore` keeps them out of GitHub.

## Troubleshooting

| What you see | What to do |
|---|---|
| Site still shows old content | Wait 5–10 minutes, then Ctrl + Shift + R |
| The Arabic button is missing | Check that `i18n.js` is at the top level of the repository, next to `index.html` |
| Workflow has a red cross | Open it and read the failed step. A message such as `settings.json is not valid JSON` means a missing or extra comma |
| Sponsors, events or CMS content did not update | Actions → **Publish content** → read the failed step; each problem is described in plain words |
| Sponsor manager says the token is not accepted | The token was copied incompletely or has expired. Create a new one |
| Sponsor manager says "not allowed" | The token needs Contents: Read and write on this repository |
| A news source keeps failing | See step 6.4. Failing sources pause themselves for 7 days |
| Forms say "Too many attempts" | Each visitor can send 5 forms a minute and 30 an hour. Adjust in `settings.json` if needed |
| No daily updates for a while | GitHub pauses schedules on inactive repositories. Go to Actions, open the workflow, and click **Enable workflow** if shown |

Technical details: [`backend/README.md`](backend/README.md).
