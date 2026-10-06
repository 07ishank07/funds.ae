# Source terms review

Checked on 30 September 2026. It covers the 75 live sources marked `licenseStatus: "pending_review"` in `backend/config/sources.news.json`: 73 publisher feeds and 2 APIs, from 67 publishers.

> This is research to help you decide. It is not legal advice. Terms change, so re-read a publisher's page before you rely on it, and get a UAE media lawyer's view before launch.
> The official (L1) and wire (L2) sources were not part of this review. The build guide still asks you to check their reuse terms too, for example the Open Government Licence for UK bodies.

## 1. What was checked

funds.ae is a commercial site: it carries advertising and sponsors. For each source it:

- fetches the feed about once a day, identifying itself as `FundsAeNewsBot`;
- shows the headline, the publisher's own excerpt (up to 280 characters), the source name and a link to the original article;
- shows no images and never stores the full article;
- is planned to add AI-written summaries built from the headline and excerpt (build guide Part D).

So a licence that covers only "personal, non-commercial" use does not cover funds.ae.

For every publisher, a script:

- opened the home page;
- followed its terms, legal, copyright and RSS links, and tried the usual paths (`/terms`, `/terms-of-use`, `/legal` and so on);
- pulled out every sentence about feeds, commercial use, automated access, reproduction, linking or AI;
- read `robots.txt` on the host that serves the feed.

Where the script was blocked, I read the pages another way or left them for you (section 7.4). Every quote below comes from the publisher's own page, as it read on 30 September 2026.

## 2. Results at a glance

| Result | Publishers | Sources | Status now |
|---|---:|---:|---|
| [The feed is blocked by robots.txt](#71-feed-blocked-by-robotstxt) | 4 | 4 | **Disabled today** |
| [The terms allow feed display, with conditions](#72-terms-allow-feed-display-with-conditions) | 4 | 5 | Your decision: these can become `terms_reviewed` |
| [The terms need permission for a site like funds.ae](#73-permission-needed) | 39 | 46 | Ask the publisher |
| [A script could not read the terms](#74-terms-not-read-by-the-script) | 20 | 20 | Read them yourself |
| **Total** | **67** | **75** | |

Of the 88 feeds still enabled, most sit in the "permission needed" or "not read" rows. **As things stand, only the L1 (public-sector) and L2 (wire) sources, plus the few in section 7.2, have a clear basis for public commercial use.**

## 3. Four findings that apply across the list

1. **Commercial use is the main problem.** Almost every publisher allows free use for personal, non-commercial purposes only. Examples:
   - The National: "Material on these platforms is solely for your personal, non-commercial use."
   - The New York Times: "We allow the use of NYTimes.com RSS feeds for personal use in a news reader or as part of a non-commercial blog."

   A public feed with a Subscribe button does not grant a commercial licence.

2. **Many publishers forbid automated access outright.** Examples include PEI Group, Bloomberg, SCMP, Inc42, CoinDesk, Financial Post and Al Jazeera. Two say that robots.txt gives no permission:
   - Guardian: "Our robots.txt notice does not, and shall not, constitute the Guardian's permission"
   - Dow Jones: "your rights are not expanded … by our use or configuration of exclusionary protocols (e.g., the Robots Exclusion Protocol …)"

3. **AI use is restricted separately.** These publishers restrict AI use of their content, whatever they allow for display: the FT, the Guardian (site and API), Business Insider, Dow Jones, the Economic Times, SCMP, the BBC, Crunchbase and PEI Group. Several go beyond training:
   - Business Insider: "grounding … or as part of a retrieval-augmented generation"
   - Economic Times: "any other automated or technology-enabled summarization or aggregation"

   **Keep AI summaries off for these sources**, even if you get display permission, unless the permission says otherwise. When the summary feature is built (Phase 3), add a per-source `allowAiSummary` flag that defaults to false.

4. **"Headline and link only" is not safe everywhere.** Two publishers name headlines explicitly:
   - AltAssets and FinTech Global both forbid redistributing "any of the Content, including headlines (such as using them as part of any syndication, Content aggregation, news aggregation …)".
   - PEI Group's terms say you may not "create a link to any part of the Sites other than the home page without PEI's written permission". That rules out article links for six private-markets titles.

## 4. What changed in the config today

- **`termsUrl` added to 53 sources.** It points to the page that was read. `licenseStatus` is unchanged: every one of the 75 is still `pending_review`.
- **Four feeds disabled** because their publishers' robots.txt disallows the feed path for all bots: tech.eu, Axios, Finextra and Gulf Times. The pipeline must not fetch them (CLAUDE.md: "Never bypass bot blocking"). Each carries a dated note.
- Enabled live sources: 92 → 88. Nothing else changed.

## 5. What you need to decide

For each source, set one of these in `sources.news.json`:

| Decision | Set | When |
|---|---|---|
| Terms allow our use | `"licenseStatus": "terms_reviewed"`, `termsUrl`, `"termsReviewedAt": "YYYY-MM-DD"` | You have read the page and accept any conditions (section 7.2) |
| Publisher said yes | `"licenseStatus": "permission_granted"`, `"termsReviewedAt": "YYYY-MM-DD"`, and a `notes` line saying who agreed, when and to what | You have written permission |
| Publisher said no, or you won't ask | `"licenseStatus": "blocked"`, `"enabled": false` | Validation requires `enabled: false` for blocked sources |
| Not decided yet | leave `pending_review` | Don't launch publicly with it enabled |

To show the headline and link but not the excerpt, set `"allowExcerpt": false`.

Here is an example `sources.news.json` entry after a publisher says yes. The name, dates and conditions are placeholders:

```json
"licenseStatus": "permission_granted",
"termsUrl": "https://www.thenationalnews.com/terms-and-conditions/",
"termsReviewedAt": "2026-10-20",
"notes": "Permission by email from <name, role> on 2026-10-18: headline, excerpt and link; no AI summaries."
```

**Suggested path to launch:**

1. **Launch on the sources with a clear basis:** L1 and L2 (after a similar check), plus section 7.2 once you accept its conditions.
2. **Ask for permission, highest value first:**
   - The National (3 feeds, priority 1);
   - PEI Group (6 titles, one request);
   - AGBI and ITP Media (Arabian Business, Construction Week);
   - Wamda and Gulf News;
   - then the global titles.

   Some run formal licensing desks:
   - NYT Licensing: https://nytlicensing.com/contact/
   - The Guardian: licensing@theguardian.com (it also mentions NLA licences for news aggregators)
   - Times Syndication Service, for the Economic Times: tss@timesgroup.com
   - Wrights Media, for City AM: CityAM@wrightsmedia.com
   - Forbes content partnerships
   - GlobalData, for Private Banker International
   - The Economist syndication: https://www.economist.com/syndication/contact-us
   - The BBC, for business use of RSS
3. **Decide what runs meanwhile.** The most cautious option is to disable every source in sections 7.3 and 7.4 until you have an answer, because many forbid the automated fetching itself, not only the display. I can make that change when you say so.

## 6. Permission request (email template)

> **Subject:** Permission to list [Publication] headlines on funds.ae
>
> Hello,
>
> I run funds.ae, a UAE news and careers site for fund managers and private-markets professionals. We would like to include [Publication]'s RSS feed ([feed URL]) in our news listing.
>
> For each article we would show only the headline, the short description from your feed (up to 280 characters), your name as the source, and a direct link to the article on your site. We don't copy full articles, don't use your images, and don't use your content for AI training. Our fetcher identifies itself as FundsAeNewsBot, contact [contact email], and checks the feed about once a day.
>
> The site carries advertising and sponsorship, so we are asking for permission for commercial use. Could you confirm whether this is acceptable, and on what terms? If you would rather we showed headlines and links only, or you have a licensing programme for this, we are happy to follow it.
>
> Thank you,
> [Name], funds.ae

Keep each reply. When a publisher says yes, record it as shown in section 5.

## 7. Details by publisher

### 7.1 Feed blocked by robots.txt

These are now disabled. robots.txt applies to the host that serves the feed.

| Publisher | Source | robots.txt | Terms, for reference |
|---|---|---|---|
| tech.eu | `tech-eu` | `Disallow: /feed/` for `*` | "Republish material or use any part of our Publication for commercial purposes without prior written permission." |
| Axios | `axios` | `api.axios.com` (the feed host): `Disallow: /` for `*` | Terms not read |
| Finextra | `finextra` | `Disallow: /rss/` for `*` (plus `Crawl-delay: 60`) | Site answers 403 to scripts |
| Gulf Times | `gulf-times` | `Disallow: /rss` and `/rssFeed/*` for `*` | "you agree to do so only for your personal, non-commercial use." |

### 7.2 Terms allow feed display, with conditions

| Publisher | Sources | What the terms say | Conditions for funds.ae |
|---|---|---|---|
| TechCrunch | `techcrunch-venture`, `techcrunch-fundraising` (already disabled: stale) | [RSS terms](https://techcrunch.com/rss-terms-of-use/): "you are only permitted to display the content that is provided in the feed, with attribution to TechCrunch, and you must link to the full article on TechCrunch." "You may not incorporate advertising into any TechCrunch RSS feed." "You may not remove our attribution or links, or otherwise modify our feed content." | Show the feed text **unmodified**: our 280-character cut could count as modifying it, so either confirm the feed's descriptions fit or set `allowExcerpt: false`. No AI summaries. Note that the general terms say "The Services are provided solely for your personal noncommercial use", so the RSS terms have to be read as the specific permission. |
| Yahoo Finance | `yahoo-finance` | [Terms](https://guce.yahoo.com/terms): "If you use an RSS feed provided by us … you are only permitted to display the content that is provided in the feed, without modification, and you must provide attribution to our source website and link to the full article …". "You may not incorporate advertising into any Yahoo RSS Feed." | Same as TechCrunch. The same page also says "Unless otherwise expressly stated, you may not access or reuse the Services … for any commercial purpose", so this relies on the RSS clause being that express statement. |
| AlleyWatch | `alleywatch` | [Terms](https://www.alleywatch.com/terms-and-conditions/): "you may from time to time excerpt and use materials set forth on this site consistent with the principles of 'fair use'." | "Fair use" is a US doctrine; UAE copyright exceptions are narrower. Headline, short excerpt and link, with no AI summary. |
| FRED (St. Louis Fed) | `fred-api` (disabled: no adapter yet) | [API terms](https://fred.stlouisfed.org/docs/api/terms_of_use.html): the notice "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis." must appear. [FRED terms](https://fred.stlouisfed.org/legal/): series marked "Public Domain: Citation requested" and "Copyrighted: Citation required" "may be used for internal commercial uses and may be displayed in textbooks, newsletters, or reports to clients provided that appropriate attribution is given". Other copyrighted series need the owner's permission. | Use only public-domain or citation series, cite FRED and the original source, show the notice, and don't use FRED data for AI. Decide series by series when the adapter is built. |

### 7.3 Permission needed

Each of these limits use to personal or non-commercial purposes, forbids automated access or redistribution, or both.

**Private markets**

| Publisher | Sources | Key terms |
|---|---|---|
| PEI Group: PE Hub, Private Equity International, Private Funds CFO, New Private Markets, Venture Capital Journal, Buyouts | `pe-hub`, `private-equity-international`, `private-funds-cfo`, `new-private-markets`, `venture-capital-journal`, `buyouts` | [PEI terms](https://www.pei.group/terms-and-conditions/): no "“deep-link,” “scraper,” “robot,” “bot,” “spider,” … to access, acquire, copy … any portion of the Sites … without our prior express written consent". "nor may you create a link to any part of the Sites other than the home page without PEI's written permission." There is also an AI clause. [Buyouts](https://www.buyoutsinsider.com/terms): "only for your own personal, non-commercial use"; no robots "regardless of whether such use may be considered a fair use". **One request covers all six.** |
| AltAssets | `altassets` | [Terms](https://www.altassets.net/altassets-legals-terms-of-use): "You may not: Redistribute any of the Content, including headlines (such as using them as part of any syndication, Content aggregation, news aggregation …)"; nor "Deep link to, frame, spider, harvest or scrape the Content". |
| Private Equity Wire (Global Fund Media) | `private-equity-wire` | [Terms](https://www.privateequitywire.co.uk/terms): "The User expressly agrees to use the Service strictly for personal purpose." "Copying for reproduction, for redistribution or other purpose … is expressly prohibited." |
| Private Banker International (GlobalData) | `private-banker-international` | [Terms](https://www.globaldata.com/terms-conditions/): "You must not use any part of the content on our site for commercial purposes without obtaining a licence to do so from us or our licensors." GlobalData offers licences (see the site's "License our content" page). |
| Crunchbase News | `crunchbase-news`, `crunchbase-news-venture` | [Terms](https://about.crunchbase.com/terms-of-service/): no one who "“Crawls,” “scrapes,” or “spiders” any page … (through use of manual or automated means)"; no AI training. But: "you may display insubstantial excerpts of Content for criticism, commentary, news reporting … provided: The use does not compete with the Service; and Proper attribution is provided to Crunchbase". **Likely a quick yes**; ask them to confirm that RSS use is allowed. |

**Start-ups and fintech**

| Publisher | Sources | Key terms |
|---|---|---|
| Inc42 | `inc42` | [Terms](https://inc42.com/terms-and-conditions/): no "scraper, robot, bot, spider, automated device … to access, acquire, copy, or monitor any portion of the Media … without the prior express written consent of Inc42". There is also a framing and linking clause (8.5). Republishing requests go to the address on that page. |
| FinTech Global | `fintech-global` | [Terms](https://fintech.global/term-conditions/): the same wording as AltAssets, including "Redistribute any of the Content, including headlines". |
| Wamda | `wamda` | [Legal page](https://www.wamda.com/legal): "Wamda is licensed under a creative commons attribution-nonCommercial - noDerivs 3.0 unported license". NonCommercial excludes a site with ads. |

**UAE and Gulf**

| Publisher | Sources | Key terms |
|---|---|---|
| The National | `the-national-business`, `the-national-markets`, `the-national-property` | [Terms](https://www.thenationalnews.com/terms-and-conditions/): "Material on these platforms is solely for your personal, non-commercial use." "Use of the material on any other website or networked computer environment, or use of the material for any purpose other than personal, non-commercial use … is prohibited." **Highest-priority request.** |
| Gulf News | `gulf-news` | [Terms](https://gulfnews.com/about-gulf-news/term-conditions): "Access of this Site is for non-commercial use only." |
| Arab News (SRMG) | `arab-news` | [Terms](https://www.arabnews.com/node/51204): no copying, reproducing, distributing … "to the public or for commercial purposes, without obtaining prior written approval". The publisher "reserves the right to impose any conditions upon permission of establishing any electronic link to this website". |
| Asharq Al-Awsat (SRMG) | `asharq-al-awsat` | [Terms](https://english.aawsat.com/home/page/987341): the same wording as Arab News. |
| Al Jazeera | `al-jazeera` | [Terms](https://www.aljazeera.com/terms-and-conditions/): "only for your own personal, non-commercial use"; no "“spider”, “scraper”, “bot” or other automated technology … to access, copy, view or record any portion of the Service". |

**Global business**

| Publisher | Sources | Key terms |
|---|---|---|
| Financial Times | `ft-home`, `ft-companies` | [Terms](https://www.ft.com/terms): "we expressly prohibit any use of our content or data (including any associated metadata) in any manner for any machine learning and/or artificial intelligence purposes". The script captured only this clause from the page, so read its reuse sections yourself. FT sells republishing licences. |
| Bloomberg | `bloomberg-markets`, `bloomberg-business` | [Terms](https://www.bloomberg.com/notices/tos/): "You shall not use or attempt to use any 'scraper,' 'robot,' 'bot,' 'spider,' … to access, acquire, copy, or monitor any portion of the Service"; "You may not recirculate, redistribute or publish the analysis and presentation included in the Service without BLP's prior written consent." |
| CNBC (Versant) | `cnbc-top-news`, `cnbc-finance` | [Terms](https://versantmedia.com/terms/), linked from cnbc.com/terms: a licence "for your personal and non-commercial use only". CNBC also has a licensing and reprints page. |
| MarketWatch (Dow Jones) | `marketwatch` | [Dow Jones terms](https://www.dowjones.com/terms-of-use/): "you may not access or use the Content, including without limitation, any Content made available through one of our RSS feeds, in any commercial product or service, without our express written consent." There are also AI and text-and-data-mining bans. |
| Business Insider | `business-insider` | [Terms](https://www.businessinsider.com/terms): "only for your own personal, non-commercial use". No robot copying. No AI use, "including any use of the Sites' content for training, fine tuning, or grounding … or as part of a retrieval-augmented generation". |
| Fortune | `fortune` | [Terms](https://fortune.com/terms-of-use/): "only for your personal, non-commercial use". No inserting advertising into content received "in an Embedded Video …, RSS feed or a podcast". |
| Forbes | `forbes-business` | [Terms](https://www.forbes.com/terms-and-conditions/): "solely for personal, non-commercial, and informational/entertainment use". No "data mining, robot, spider … scraping, indexing, or extraction". Forbes licenses custom feeds through its content partnerships team. |
| The Economist | `economist-finance` | [Terms](https://www.economistgroup.com/terms-of-use): "All Economist Content is strictly for personal, non-commercial use only." "Except as expressly permitted above, you may not reproduce, modify or in any way commercially exploit any Economist Content." |
| BBC | `bbc-business` | [Using BBC content](https://www.bbc.co.uk/usingthebbc/terms/can-i-use-bbc-content/): "For business use of our RSS feeds you'll need to get our permission, and there may be a fee to pay." Individuals may add the feed to their own site only if "You don't change the RSS feed". Using content for AI needs permission. |
| The Guardian | `guardian-business` | [Terms](https://www.theguardian.com/help/terms-of-service): "Your use of the Guardian Site and Guardian Content is for your own personal and non-commercial use only." No bots without written approval. "Our robots.txt notice does not, and shall not, constitute the Guardian's permission". The terms mention NLA licences for news aggregators. |
| The New York Times | `nyt-business`, `nyt-dealbook` | [RSS page](https://www.nytimes.com/rss): "We allow the use of NYTimes.com RSS feeds for personal use in a news reader or as part of a non-commercial blog." "Commercial use of the Service is prohibited without prior written permission from NYT which may be requested by contacting us at: https://nytlicensing.com/contact/ ." |
| Nikkei Asia | `nikkei-asia` | [RSS page](https://info.asia.nikkei.com/rss): "provided solely for the purpose of allowing individuals to view headlines from Nikkei Asia within newsreaders for their personal, noncommercial use. Republication, copying or redistribution by any means is expressly prohibited." |
| South China Morning Post | `scmp-business` | [Terms](https://www.scmp.com/terms-conditions): "You are expressly prohibited from using any automated system (including web crawlers, spiders, or scrapers) to access, extract, or index SCMP Content for any purpose." Use is personal and non-commercial only. |
| The Economic Times | `economic-times-markets` | [Terms](https://economictimes.indiatimes.com/terms-conditions): "personal and non-commercial use only". No AI or text-and-data-mining use, including "any other automated or technology-enabled summarization or aggregation … where such use has not been expressly approved". Republishing requests go to Times Syndication Service (tss@timesgroup.com). |
| Mint | `mint-markets` | [Terms](https://www.livemint.com/terms-of-use): content only "strictly for personal, non-commercial use". "Automated scraping/crawling/bulk downloading is prohibited." |
| The Straits Times (SPH Media) | `straits-times-business` | [SPH terms](https://www.sph.com.sg/legal/website_tnc/): no reproducing, displaying or providing access "on another website or server, for example through framing, mirroring, linking, spidering, scraping … without the prior written permission of SPH Media." |
| Euronews | `euronews-business` | [Terms](https://www.euronews.com/terms-and-conditions): "no copying, redistribution, retransmission, publication or commercial exploitation of downloaded material will be permitted without the express permission of Euronews". |
| Financial Post (Postmedia) | `financial-post` | [Terms](https://financialpost.com/terms-of-service): "for your own personal and non-commercial use only". No "robot, spider, other automatic device, or manual process to monitor or copy our web pages … without our prior express written permission". |
| The Globe and Mail | `globe-and-mail-business` | [Terms](https://www.theglobeandmail.com/privacy-terms/terms-and-conditions/): no one may "create a media monitoring service, aggregate, deep link, republish … without the prior written consent of The Globe and Mail". |
| CoinDesk | `coindesk` | [Terms](https://www.coindesk.com/terms): "you will not use any robot, spider, scraper, or other automated means to access the Services for any purpose without our express written permission." |
| Guardian Open Platform (API) | `guardian-api` (disabled: no adapter yet) | [API terms](https://www.theguardian.com/open-platform/terms-and-conditions): "You may make OP Content available to end users of Your Website strictly for their personal and non-commercial use only". There are also AI, text-and-data-mining and bot restrictions and an advertising condition. For commercial use, contact licensing@theguardian.com. |

### 7.4 Terms not read by the script

Please read these yourself in a browser; each takes a few minutes. Where a terms page was found, it is listed.

| Publisher | Source | Where to look | Why the script failed |
|---|---|---|---|
| Hedgeweek | `hedgeweek` | Site footer. It may share Private Equity Wire's terms, since both appear to be Global Fund Media titles. | No terms page at the usual paths |
| Opalesque | `opalesque` (already disabled: 403) | Site footer | Site answers 403 to scripts |
| Top1000funds | `top1000funds` (already disabled: 403) | Site footer | Site answers 403 to scripts |
| Sifted | `sifted` | https://sifted.eu/terms-of-use | Answers 403 to scripts |
| EU-Startups | `eu-startups` | Site footer | Site answers 403 to scripts |
| YourStory | `yourstory` | https://yourstory.com/terms-and-conditions | Answers 403 to scripts |
| TechCabal | `techcabal` | Site footer | No terms page found |
| Crowdfund Insider | `crowdfund-insider` | Site footer | Site answers 403 to scripts |
| The Fintech Times | `the-fintech-times` | Site footer | No terms page at the usual paths |
| Fintech News Singapore | `fintech-news-singapore` | "Privacy Policy / Disclaimer" in the footer (Fintech News Network, © CK Finanzpro GmbH) | No terms page at the usual paths |
| Fintech News Middle East | `fintech-news-me` | As above: same network | No terms page at the usual paths |
| Arabian Business (ITP Media Group) | `arabian-business` | "Terms & Conditions" in the footer | Site answers 403 to scripts |
| Construction Week (ITP Media Group) | `construction-week-middle-east` | "Terms & Conditions" in the footer | Site answers 403 to scripts |
| AGBI | `agbi` | https://www.agbi.com/privacy-terms-conditions/ | Text is drawn by script |
| Economy Middle East | `economy-middle-east` | Site footer | No terms page found |
| Saudi Gazette | `saudi-gazette` | Site footer | No terms page found |
| Times of Oman | `times-of-oman` | Site footer | No terms page found |
| Semafor | `semafor` | Site footer | No terms page found |
| DW | `dw-business` | https://www.dw.com/en/legal-notice/a-63500643 | Text is drawn by script |
| City AM | `city-am` | https://www.cityam.com/licensing-and-reuse-of-content/: licensing is run by Wrights Media (CityAM@wrightsmedia.com) | The terms page found covers only contributors |

When you have read one, add its `termsUrl` and your decision (section 5). Based on the pattern above, expect most of these to say personal and non-commercial too.

## 8. Keeping this current

- Re-check terms before launch and then once a year. Publishers change them: the Guardian's changelog shows at least three changes in 2023 alone.
- `npm run check-sources -- --config` checks that feeds work, not whether you may use them. robots.txt is not yet part of that check. Adding it would catch a newly blocked feed automatically, and I can add it if you want.
- Record every permission (who, when, what was agreed) in `notes`, and keep the email.
