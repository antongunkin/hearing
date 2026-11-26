# SEO Landscape and Risks for a New AI-Automated Hearing-Aid Review/News Site (2025-2026)

Research date: 2026-11-26. US/English Google. Many industry figures come from vendor blogs or secondary coverage; this is flagged where it applies. Items older than 2025 are dated.

## 1. Google policies on AI/automation, YMYL/E-E-A-T, and what happened to AI-heavy sites in 2024-2026 updates

### Takeaway
Google does not ban AI content as such. It does penalize "many pages generated ... without adding value," whether AI, humans or both produce them, and from mid-2025 to late 2026 it has enforced this through repeated spam updates and visible waves of manual actions. Health/YMYL sites without visible, verifiable expertise were among the hardest hit in core updates. A mostly AI-generated hearing-aid site that publishes at volume without first-hand testing or credentialed review sits squarely inside the risk zone.

### Cited Findings
**Policy text (primary, Google)**
- Scaled content abuse definition: "when many pages are generated for the primary purpose of manipulating search rankings." Listed examples include "Using generative AI tools or other similar tools to generate many pages without adding value for users" and "Creating multiple sites with the intent of hiding the scaled nature of the content." — [Google Search Central, Spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- Scraping policy covers "Copying content from other sites, modify it only slightly (for example, by substituting synonyms...)", "Reproducing content feeds from other sites without providing some type of unique benefit to the user", and "Republishing content from other sites without adding any original content or value, or even citing the original source." This applies directly to an AI rewrite-based news aggregator. — [Google Spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- Site reputation policy: applies "where third-party content is published on a host site mainly because of that host's already-established ranking signals." The spam policies page links to a 2026/08 Google blog post on changes to this policy (details not retrieved). — [Google Spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- Google's generative-AI guidance: AI can help with research and structure if the result meets Search Essentials and spam policies. "Using generative AI tools ... to generate many pages without adding value for users may violate" the scaled content abuse policy. "It is critical to manually factcheck and review all AI-generated content for accuracy" before publishing. Disclosure of how automation was used is suggested. The same review applies to titles, meta descriptions, structured data and alt text. AI-generated images must carry IPTC `DigitalSourceType` = `TrainedAlgorithmicMedia` metadata (Merchant Center context). The page points to Quality Rater Guidelines sections 4.6.5 and 4.6.6 (scaled content abuse, low-effort content). — [Google, Using generative AI content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content)
- Danny Sullivan (Search Liaison), quoted secondhand from Search Central Live NYC: Google doesn't "really care how you're doing this scaled content, whether it's AI, automation, or human beings." In a 2024 interview he framed the issue as content created at scale with the sole intent of ranking. — [Libril (secondary, quotes and dates)](https://libril.com/blog/is-ai-content-against-tos); [Search Engine Roundtable 2024 interview](https://www.seroundtable.com/interview-google-august-core-update-38024.html)
- May 2026: Google reportedly rewrote the opening definition of spam to include "attempting to manipulate generative AI responses" in Search. Single secondary source; not verified on Google's page. — [Stan Ventures](https://www.stanventures.com/news/7-google-spam-updates-later-where-seo-stands-in-2026-7573/)
- May 15, 2026: Google (John Mueller) published a guide, "optimizing your website for generative AI features on Google Search." It stresses "non-commodity content," debunks "AEO/GEO" myths, and says standard SEO fundamentals still apply. — [Google Search Central Blog, May 2026](https://developers.google.com/search/blog/2026/05/a-new-resource-for-optimizing)

**Update timeline (primary, Google Search Status Dashboard)** — [Google Search Status Dashboard](https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history)
- 2024: March core (Mar 5 to Apr 19; this is when Helpful Content was folded into core and the scaled content abuse policy launched) and March spam update; June spam; August core; November core; December core; December spam.
- 2025: March core (Mar 13-26); June core (Jun 30 to Jul 16); August spam (Aug 26 to Sep 21); December core (Dec 11-29).
- 2026: February Discover core update (Feb 5-26); March spam (Mar 24-25); March core (Mar 27 to Apr 8); May core (May 21 to Jun 1); June spam (Jun 24-26); August spam (Aug 18-20); September spam (Sep 24 to Oct 7); November core (Nov 10-24); a December 2026 core update listed as starting Nov 24, 2026 (still in progress at the time of research).
- That is 5 spam updates in 2026 alone, a much faster cadence than 2024-2025.

**Manual action waves**
- Starting around June 2025, Google issued manual actions for scaled content abuse to sites mass-publishing AI content in the UK, US and EU. Search Console notices cited "aggressive spam techniques, such as large-scale content abuse." Some reports describe full deindexing. Sources are agency/blog posts, not Google. — [Libril (citing Pedro Dias)](https://libril.com/blog/is-ai-content-against-tos); [Something Inc. case study](https://somethinginc.com/blog/scaled-ai-content-manual-action-case-study/)
- Case study: an 850,000-URL AI "local news" section received a scaled content abuse manual action and also lost its ChatGPT citations. This shows a Google penalty can spill over into LLM visibility. — [Something Inc.](https://somethinginc.com/blog/scaled-ai-content-manual-action-case-study/)
- Oct-Nov 2026: practitioners report a rise in manual actions. Marie Haynes went from "essentially no requests to several per week" and named thin content, pure spam and scaled content, with "major spam problems" the most common. Daniel Foley Carter said Google is ramping up on scaled content abuse and link spam. Google made no official statement, and the article's author found no further spike in the following month. — [Search Engine Roundtable, Oct 8, 2026 (updated Nov 9)](https://seroundtable.com/google-search-manual-action-spike-42258.html)
- Some SEOs report that even well-performing AI content got scaled content abuse actions, which suggests site-wide pattern review. Anecdotal. — [Layer3 Labs (summary of reports)](https://www.layer3labs.io/guides/scaled-content-abuse)

**Health/YMYL impact in core updates (secondary, treat as directional)**
- December 2025 core update: ALM Corp's analysis of 847 affected sites reported impact rates of 67% for health content and 71% for affiliate sites. Reported visibility losses were Healthline -24.7%, Medical News Today -37.4% and WebMD -20.8%. Losses clustered on pages with "Staff Writer" bylines or no verifiable credentials, and medical pages without physician authorship lost visibility for symptom and treatment queries. Many blogs reuse the same ALM dataset. — [ALM Corp](https://almcorp.com/blog/google-december-2025-core-update-complete-guide); [PPC Land](https://ppc.land/health-sites-that-once-dominated-seo-just-got-crushed-by-google/)
- The same coverage reports 60-95% traffic losses for mass-produced, unedited AI content. Sites using AI inside a workflow with human expertise and review could still rank, per a Mueller paraphrase (secondhand). — [ALM Corp](https://almcorp.com/blog/google-december-2025-core-update-complete-analysis-recovery-guide/)
- Estimated recovery for YMYL sites is 6-12 months, versus 2-6 months for non-YMYL. This is an agency estimate. — [ALM Corp](https://almcorp.com/blog/google-december-2025-core-update-complete-guide)
- Site reputation abuse precedent (2024-2025): Forbes Advisor, including its health section, apparently received a manual action around September 2024. Its traffic was down 83% YoY in January 2025 (Similarweb via WSJ), dipped to near zero by February 2025, and began recovering in March 2025. Google said "no amount of first-party involvement alters the fundamental third-party nature of the content." — [BuzzStream](https://www.buzzstream.com/blog/forbes-advisor-analysis/); [Search Engine Roundtable](https://www.seroundtable.com/google-hit-forbes-advisor-38147.html); [Sistrix](https://www.sistrix.com/?p=169359)

### Inferences
- Hearing aids are FDA-regulated medical devices, and buying decisions involve health and money, so the site will be judged as YMYL. The December 2025 pattern (losses for anonymous or uncredentialed health content) means that an AI-written site with no named audiologist/clinician author or reviewer starts at a structural disadvantage.
- The 2026 spam cadence (5 updates) plus the manual action uptick in late 2026 means a high-volume AI publishing pipeline faces repeated algorithmic and manual risk. A manual action can mean deindexing and can also cut LLM citations.
- A "rewrite other outlets' news" pipeline matches the scraping-policy examples almost word for word. This is the highest-risk content type for this project.
- The safe use of AI per Google's own wording is AI-assisted research, drafting and structure, with human fact-checking, original value and moderate volume. Fully automated, unreviewed publishing is not safe.

### Gaps
- Could not retrieve the 2026/08 Google blog post on site reputation policy changes, or the exact May 2026 spam-definition wording, from primary sources.
- No public data on hearing-aid-specific sites hit by 2025-2026 updates.
- Google does not publish counts of manual actions. The 2025 and 2026 "waves" come from practitioner reports.
- Did not retrieve the current Quality Rater Guidelines text (YMYL/E-E-A-T sections) directly. The rater guidelines' emphasis on E-E-A-T for YMYL comes from earlier versions (2022-2025) and was not re-verified here.

## 2. AI Overviews / AI Mode impact on CTR, and Google's product-review guidance

### Takeaway
When an AI Overview appears, clicks to organic results fall roughly by half. AI Overviews appear on most health queries (about 51-88% depending on the study) but far less on shopping queries. AI Mode is close to zero-click. Google's review guidance explicitly asks for first-hand evidence, quantitative measurements and comparisons, which a purely AI-generated site cannot honestly provide.

### Cited Findings
**CTR studies**
- Pew Research (March 2025 browsing data, 900 US adults, 68,879 searches): users clicked a traditional result in 8% of visits with an AI summary versus 15% without one. They clicked links inside the summary 1% of the time. Sessions ended after 26% of AI-summary searches versus 16% without. About 18% of searches showed an AI summary. Question-style queries showed one 60% of the time, and 10+ word queries 53%. Wikipedia, YouTube and Reddit were the most-cited sources, and .gov sites made up 6% of AI-summary sources. — [Pew Research Center, July 22, 2025](https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/)
- Ahrefs (300k keywords, GSC data, Dec 2023 vs Dec 2025): an AI Overview correlates with a 58% lower CTR for position 1 (up from -34.5% in its April 2025 study). Position 2 is about -50.8% and position 10 about -19.4%. Post dated February 4, 2026. — [Ahrefs](https://ahrefs.com/blog/ai-overviews-reduce-clicks-update)
- Seer Interactive (Sept 2025): organic CTR on AIO queries was 0.70% when the brand was cited in the AIO versus 0.52% when not. Later Seer data (secondary) shows a partial rebound in early 2026 (1.31% in Dec 2025 to 2.36% in Feb 2026). — [Presenc.ai summary (secondary)](https://presenc.ai/research/ai-overviews-ctr-impact-2026); [Seoryon reconciliation (secondary)](https://seoryon.com/observatoire-recherche-ia/ai-overviews-ctr)
- Sistrix: an AIO at the top of the SERP cuts position-1 click rate by about 60%. — [Sistrix (via Reddit analysis)](https://www.sistrix.com/blog/reddit-and-the-11-4-million-daily-click-funnel)
- Zero-click: SparkToro/Similarweb clickstream data (Jan-Apr 2026) found 68.01% of US Google searches ended without a click, up from 60.45% in 2024. Secondary coverage. — [Rankbits (secondary)](https://rankbits.com/blog/zero-click-search-stats-2026); [Digitaleer (secondary)](https://www.digitaleer.com/ai-impact-google-search-traffic-2026/)
- AI Mode: a Semrush study of about 69M sessions reportedly found about 93% zero-click, with only 6-8% of AI Mode sessions going to an external site. Secondary, primary not found. — [Digitaleer (secondary)](https://www.digitaleer.com/ai-impact-google-search-traffic-2026/)
- Publisher referrals: Reuters Institute/Chartbeat report Google Search referrals to publishers down about 33% YoY globally through late 2025, and -38% in the US. Secondary. — [Search Engine Journal](https://www.searchenginejournal.com/impact-of-ai-overviews-how-publishers-need-to-adapt/556843/)

**AIO prevalence on health queries**
- WebFX (130k+ health queries): AIOs on 51% of healthcare searches, rising to 73.9% for queries of 7+ words. Vendor study. — [WebFX](https://www.webfx.com/blog/healthcare/ai-overviews-in-healthcare/)
- WebSci '26 audit (900 health queries, Google US): AIOs triggered on 87.7%. — [ACM DL](https://dl.acm.org/doi/10.1145/3795513.3807429)
- BrightEdge: about 6 in 10 healthcare queries trigger AI. Treatment and procedure queries reached 100% AIO presence by December 2025, and local/provider queries were at 0%. — [BrightEdge](https://www.brightedge.com/resources/weekly-ai-search-insights/healthcare-ai-evolution-google-2023-2025)
- Cross-topic arXiv study (2025 data): 58% of health queries were answered by AI, versus 13% of shopping queries. — [arXiv 2602.13415](https://arxiv.org/pdf/2602.13415)

**Google review guidance (primary)**
- Reviews system rewards "insightful analysis and original research" by "experts or enthusiasts who know the topic well," over thin summaries. It "is improved at a regular and ongoing pace" (no longer separately announced). — [Google, Reviews system](https://developers.google.com/search/docs/appearance/reviews-system)
- Best practices: provide "visuals, audio, or other links of your own experience"; "Share quantitative measurements about how something measures up in various categories of performance"; justify top picks with "first-hand supporting evidence"; "Explain what sets something apart from its competitors"; "Describe how a product has evolved from previous models or releases"; "Consider including links to multiple sellers"; make ranked lists stand on their own; prioritize "quality and originality ... not the length." — [Google, Write high-quality reviews](https://developers.google.com/search/docs/specialty/ecommerce/write-high-quality-reviews)

### Inferences
- Informational hearing-health queries ("signs of hearing loss," "how do hearing aids work," "does Medicare cover hearing aids") are likely to be heavily absorbed by AIOs. Commercial "best"/"vs"/brand-review queries likely see fewer AIOs, based on the shopping-query figure of 13%, but those are exactly the queries where Google's review guidance demands first-hand evidence.
- An AI-only site cannot honestly produce first-hand photos, audio recordings or measurements. Fabricating them would be deceptive and risky (FTC endorsement rules also apply; not researched here). The realistic path is real devices plus a human tester, or licensed lab data with attribution.
- Being cited in the AIO helps CTR only marginally (Seer: 0.70% vs 0.52%), so AIO citation is not a substitute for ranking.

### Gaps
- No AIO-prevalence data specific to hearing-aid queries, and none specific to product-review intent.
- Primary Seer and Semrush AI Mode reports were not retrieved, only secondary summaries.

## 3. Hearing-aid SERP difficulty, dominant domains, and long-tail opportunity

### Takeaway
Head terms ("best hearing aids" about 20k/mo, KD 47; "OTC hearing aids" about 10k/mo, KD 44) are held by national review publishers and affiliate sites with old, high-authority domains. Several mid-volume informational and attribute terms show low Ahrefs KD ("does Medicare cover hearing aids" 9.1k, KD 4; "bluetooth hearing aids" 9.1k, KD 4; "rechargeable hearing aids" 1.8k, KD 7), but these are the query types most exposed to AI Overviews. The strongest independent player, HearingTracker/HearAdvisor, competes on lab measurements, which raises the bar for a new site.

### Cited Findings
- Ahrefs US monthly volumes and KD (June 2026), via SEO Brothers: best hearing aids 20,000 / KD 47; otc hearing aids 10,000 / 44; does medicare cover hearing aids 9,100 / 4; bluetooth hearing aids 9,100 / 4; how much do hearing aids cost 5,500 / 22; hearing aid cost 2,400 / 29; rechargeable hearing aids 1,800 / 7; signs of hearing loss 1,600 / 12; hearing aid prices 1,100 / 22; hearing aids near me 22,000 / 6; audiologist near me 26,000 / 12. "Best hearing aids" and "otc hearing aids" are "dominated by national review publishers and affiliate sites." — [SEO Brothers, updated June 2, 2026](https://seobrothers.com/guides/audiology-seo/)
- Conflicting volume: UpperRank lists "best hearing aids" at about 2,400/mo, which suggests tool disagreement. — [UpperRank](https://upperrank.co/how-to-rank-for/hearing-aids)
- Forbes Health ranks with "Best Hearing Aids Of 2026, According To Experts," which includes hands-on testing by named individuals. — [Forbes Health](https://www.forbes.com/health/hearing-aids/best-hearing-aids/)
- HearingTracker and HearAdvisor: HearAdvisor is an acoustic lab using a KEMAR manikin and recorded real-world scenes, testing "Initial Fit" and "Tuned Fit." Its SoundScore feeds the HearingTracker Score, and it had tested 65 hearing-aid pairs per a later release. HearingTracker adds hands-on wear testing, and the two companies share a founder and personnel. — [HearingTracker review process](https://www.hearingtracker.com/expert-vetting-our-hearing-aid-review-process); [ENT & Audiology News](https://www.entandaudiologynews.com/news/post/independent-lab-tests-and-rates-hearing-aids)
- In AI-assistant answers (Nov 2026 benchmark, 787 answers across ChatGPT, Copilot, Gemini, AI Mode, AIO and Perplexity), the most-recommended brands were Jabra Enhance 51.6%, Audien 29.4%, MDHearing 23.3%, Eargo 17.3%, Audicus 7.6% and Lexie 5.5%. A search snippet from the same index (Oct 2026) said independent sources (hearingtracker.com, consumerreports.org, hearadvisor.com) lead citations and no brand's own domain is in the top 10 cited domains. The cited-domain detail was not confirmed on the fetched page. — [LLM Authority Index, Hearing Aids](https://llmauthorityindex.com/industries/hearing-aids)
- Reddit is a major SERP competitor. Ahrefs found Reddit in 83.9% of "Discussions and forums" SERP features (the feature appears on 11.7% of 145M US results). Sistrix ranks reddit.com about #3-4 most visible US domain (2025-2026), and SE Ranking reports Reddit's share of top-3 positions at 10.24% after the May 2026 core update. — [Ahrefs](https://ahrefs.com/blog/discussions-and-forums-serps/); [Sistrix](https://www.sistrix.com/blog/reddit-domain-analysis/); [SE Ranking](https://seranking.com/blog/reddit-ai-search/)
- Local intent ("hearing aids near me") has AIO presence near 0% (BrightEdge, local/provider queries) but is won by clinics with Google Business Profiles, not review sites. — [BrightEdge](https://www.brightedge.com/resources/weekly-ai-search-insights/healthcare-ai-evolution-google-2023-2025); [SEO Brothers](https://seobrothers.com/guides/audiology-seo/)

### Inferences
- Long-tail opportunity most plausibly lies in queries where incumbents are thin and AIOs struggle: specific model-vs-model comparisons (e.g., new OTC releases), app/pairing troubleshooting for specific models and phones, firmware/app update news, accessory compatibility, and real ownership-cost breakdowns. This is inference; no keyword data was retrieved for these.
- The same long-tail is where Google's review guidance (first-hand evidence, evolution from previous models) applies most, so an AI-only approach still struggles to stand out against HearingTracker's lab data and Reddit's first-hand threads.
- Low-KD informational terms (Medicare coverage, Bluetooth) are attractive on paper. However, AIO prevalence for health how/what queries is high (51-100%), so expected clicks per ranking are low.

### Gaps
- No SERP snapshot listing the actual top-10 domains for each core term (e.g., whether Healthline, NCOA, Consumer Reports, Verywell, CNET or brands rank). This needs a live SERP or Ahrefs/Semrush check.
- No volume/KD data for brand + review terms (e.g., "Jabra Enhance review," "Sony CRE-E10 review," "Apple AirPods Pro hearing aid") or for troubleshooting queries.
- No traffic estimates for hearingtracker.com or competitors.

## 4. Google News / Discover eligibility for a news aggregator; rewritten-news performance; duplicate content

### Takeaway
Google's February 2026 Discover core update explicitly favors "in-depth, original, and timely content" from sites with topic expertise and demotes clickbait. Combined with the scraping policy, an AI-rewritten news aggregator has poor prospects in Discover and Google News, and it carries spam risk.

### Cited Findings
- February 2026 Discover core update (US English first): aims to show "more in-depth, original, and timely content from websites with expertise in a given area"; systems "identify expertise on a topic-by-topic basis"; reduces "sensational content and clickbait"; favors "locally relevant content from websites based in their country." To expand to all countries and languages later. — [Google Search Central Blog, Feb 5, 2026](https://developers.google.com/search/blog/2026/02/discover-core-update)
- Scraping policy examples include reproducing content feeds "without providing some type of unique benefit," and republishing "without adding any original content or value, or even citing the original source." — [Google Spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- Third-party analysis says republished coverage without original reporting is losing Discover visibility after the February 2026 update. This is interpretation, not Google policy. — [ALM Corp](https://almcorp.com/blog/google-discover-core-update-february-2026-local-publishers-data/); [Stan Ventures](https://www.stanventures.com/news/googles-february-2026-discover-update-rewrites-the-rules-of-visibility-6832/)
- Google itself now puts AI summaries in Discover (AI-generated headlines/summaries called a "feature"; a "Dive deeper" test gives AI overviews instead of sending users to publishers). This further reduces clicks for commodity news. — [Nieman Lab, Jan 2026](https://www.niemanlab.org/2026/01/discover-isnt-the-only-place-google-is-experimenting-with-ai-generated-snippets/); [Android Authority](https://www.androidauthority.com/google-discover-dive-deeper-3713257/)
- Discover needs no special markup; indexed pages that follow Discover content policies are eligible, but eligibility does not guarantee visibility. — [Keywords Everywhere tracker (secondary)](https://keywordseverywhere.com/news/google-discover/)

### Inferences
- For hearing-aid "news" (new model launches, FDA/OTC regulatory changes, firmware updates), the original sources are brand press releases, the FDA, HearingTracker and Hearing Review. A rewrite adds no unique value unless it adds original testing, expert commentary, or data (e.g., price tracking, spec comparison tables).
- Hearing-aid news is a small niche. Discover traffic likely depends on topic-level expertise signals that a new AI site won't have.

### Gaps
- Did not retrieve the current Google News content policies or Publisher Center rules (Google News inclusion has been automatic since about 2019, per earlier knowledge, not re-verified).
- No data on how AI-generated news sites perform in Google News specifically.

## 5. Alternative traffic channels (YouTube, Reddit, Pinterest, Facebook, newsletters, LLM referrals)

### Takeaway
LLM referrals are growing fast but are still a small share of traffic (about 0.3-1% of sessions). In AI answers for hearing aids, independent lab/review sources and brands dominate. YouTube and Reddit are among the most-cited sources in Google's own AI answers, which makes them both competitors and distribution channels.

### Cited Findings
- ChatGPT referrals were 0.23% of referral traffic in April 2026 and 0.32% in May 2026 (SE Ranking, 101,574 sites). Conductor found AI referrals at about 1.08% of total sessions across 13,770 domains. ChatGPT's share of AI referrals ranges from about 63% to 95% depending on the study. — [SE Ranking](https://seranking.com/blog/chatgpt-referral-traffic-may-2026/); [MissionGrowth (secondary)](https://missiongrowth.io/blog/ai-referral-traffic-statistics)
- ChatGPT's share of generative-AI site visits fell from about 76% (June 2025) to about 53% (May 2026) as Gemini and Claude grew (Similarweb). After ChatGPT's May 2026 links update, the homepage share of ChatGPT referrals jumped to about 60%. — [Similarweb AI Search stats](https://aisearch.similarweb.com/blog/gen-ai-stats/)
- A 52-site study reported 97.9% session growth from ChatGPT after the May 2026 links update. Small vendor sample. — [Botpresso](https://botpresso.com/chatgpt-may-links-update-traffic-impact-study/)
- In Google AI summaries, Wikipedia, YouTube and Reddit are the most-linked sources (15% of AIO sources combined). — [Pew Research, 2025](https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/)
- Reddit's AI citations roughly doubled from mid-2025 to early 2026 (BrightEdge) and then plateaued. Semrush reports that Reddit citations in ChatGPT fell at some point. — [BrightEdge](https://brightedge.com/resources/weekly-ai-search-insights/reddit-breakout-year-search-visibility-33x-footprint-expansion); [Semrush](https://www.semrush.com/blog/reddits-citations-in-chatgpt-fall/)
- A Google penalty can remove LLM citations too (manual-action case study). — [Something Inc.](https://somethinginc.com/blog/scaled-ai-content-manual-action-case-study/)
- Google's May 2026 guide calls common "AEO/GEO" ideas myths and says SEO fundamentals and non-commodity content drive visibility in generative features. — [Google Search Central Blog](https://developers.google.com/search/blog/2026/05/a-new-resource-for-optimizing)
- Google added a July 2026 documentation guide on analyzing social and video platform content, and a June 2026 note on llms.txt files (contents not retrieved). — [Google Search Central, Latest documentation updates](https://developers.google.com/search/updates)

### Inferences
- The hearing-aid audience skews older (60+). YouTube (unboxing, fitting, app walkthroughs, sound samples) and Facebook groups plausibly match it better than Pinterest. No hearing-aid-specific channel data was found.
- An email newsletter (e.g., OTC deals, new-model alerts) is the only channel insulated from algorithm changes. No benchmark data was gathered.
- For GEO, being cited depends on being an original source (measurements, prices, comparison data). Rewritten content is unlikely to be cited over HearingTracker, Consumer Reports or brand sites.

### Gaps
- No data on YouTube, Pinterest or Facebook-group traffic potential for hearing aids, or on the age demographics of hearing-aid shoppers by channel.
- No hearing-aid-specific LLM referral volumes.
- Reddit self-promotion rules (r/HearingAids) were not researched.

## 6. Realistic time-to-traffic for a new domain in a YMYL niche

### Takeaway
New domains rarely reach page one. Only about 2% of top-10 domains are under 2 years old, and the median top-10 domain is about 17 years old. Only about 1.7% of new pages reach the top 10 within a year. In YMYL health, expect 12+ months before meaningful organic traffic, and only with real expertise signals and links.

### Cited Findings
- SE Ranking (100k SERPs, US, April 9, 2026): domains under 2 years old hold 2.03% of top-10 domains and 1.42% of top-3 spots. Median top-10 domain age is 17.3 years and median top-3 is 19.6 years. 57% of top-10 domains are 15+ years old. — [SE Ranking, May 21, 2026](https://seranking.com/blog/domain-age-ranking-factor/)
- Ahrefs (secondary report of a May 2025 study, 2M+ pages): only 1.74% of newly published pages reach the top 10 within one year, down from 5.7% in 2017. — [Crowdo (secondary)](https://crowdo.net/blog/how-long-to-rank-in-google-2025/); original 2017/2022 study: [Ahrefs](https://ahrefs.com/blog/?p=14254)
- After a core-update hit, YMYL recovery is estimated at 6-12 months (agency estimate). — [ALM Corp](https://almcorp.com/blog/google-december-2025-core-update-complete-guide)
- Domain migrations take 229 days on average to regain traffic (SEJ). Not a new-domain measure, but it indicates trust-building timescales. — [Search Engine Journal](https://www.searchenginejournal.com/how-long-should-seo-migration-take/492050/)

### Inferences
- Domain age correlates with ranking, though that does not prove causation (old domains have more links and brand). Either way, a new hearing-aid site should plan for 12-24 months before head terms are realistic, with earlier traffic only from low-KD long-tail.
- Buying an expired domain to shortcut this is explicitly targeted ("expired domain abuse," per the March 2026 spam update coverage) and is not a safe path. — [Stan Ventures](https://www.stanventures.com/news/7-google-spam-updates-later-where-seo-stands-in-2026-7573/)

### Gaps
- No study measures time-to-first-traffic specifically for new YMYL/health domains.
- Ahrefs' 2025 figure (1.74%) came only through secondary sources; the primary page was not retrieved.
