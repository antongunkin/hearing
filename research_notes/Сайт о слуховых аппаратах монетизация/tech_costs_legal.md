# Technical Build, Operating Costs and Legal Guardrails for an AI-Automated Hearing-Aid News/Review Site (US, prices checked November 2026)

Research date: 2026-11-26. All prices in USD unless noted. Vendor pricing pages were fetched directly where possible (Anthropic, OpenAI, Google, Firecrawl, n8n). Other prices come from third-party aggregators and are marked as such. Some line items in the budget scenarios are estimates (marked "est.") built from the sourced unit prices, not quotes.

## 1. Pipeline components and 2025-2026 prices (sourcing, scraping, LLMs, images, automation, CMS/hosting, SEO, email)

### Takeaway
The software pipeline is cheap. Even a premium frontier model costs roughly $0.50-$2.50 to research and write one 1,500-2,500-word review, about $0.01-$0.05 per short news item, and $0.003-$0.24 per AI image. A full stack (LLM + images + scraping + n8n + hosting + SEO + email) runs about $100-$250/month at low volume and $600-$1,500/month at high volume. Paid SEO tools and human review cost far more than the AI does.

### Cited Findings

**LLM APIs: Anthropic (official page, fetched Nov 2026)**
- Claude Opus 5.5: $4/MTok input, $20/MTok output; cache hits $0.20/MTok (0.05x); Batch $2/$10 — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Claude Sonnet 5.5: $2 input / $10 output per MTok; cache hit $0.10; Batch $1/$5. Claude Sonnet 5: $2/$10. The launch "introductory" price is now standard, and the planned September 1, 2026 rise to $3/$15 will not happen — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Claude Haiku 5.5: $0.10 input / $0.50 output per MTok for prompts up to 100k tokens; $0.50/$2.50 above 100k. Claude Haiku 4.5: $1/$5 — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Top tier Claude Fable 5.2: $8/$40 per MTok — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Batch API gives 50% off input and output, and it stacks with prompt caching — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Web search tool: $10 per 1,000 searches plus tokens. The web fetch tool has no surcharge beyond tokens. An average webpage (10 kB) is about 2,500 tokens — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Claude 4.7+ models use a tokenizer that produces about 30% more tokens for the same text — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)

**LLM APIs: OpenAI (official page, fetched Nov 2026)**
- gpt-5.6-sol $4/$20; gpt-5.6-terra $2/$12; gpt-5.6-luna $0.20/$1.20; gpt-5.5 $5/$30; gpt-5.4 $2.50/$15; gpt-5.4-mini $0.75/$4.50; gpt-5.4-nano $0.20/$1.25; gpt-5-mini $0.25/$2; gpt-5-nano $0.05/$0.40 (per MTok). The page also lists GPT-6 models, for example gpt-6-sol at $2/$10 — [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- Batch is about 50% off (gpt-5.4 Batch: $1.25/$7.50) — [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- Web search: $10 per 1,000 calls plus content tokens — [OpenAI pricing](https://developers.openai.com/api/docs/pricing)

**LLM APIs: Google Gemini (official page, fetched Nov 2026)**
- Gemini 3.1 Pro Preview: $2 input / $12 output (≤200k prompt); Batch $1/$6 — [Google AI pricing](https://aistudio.google.com/docs/pricing)
- Gemini 3 Flash Preview: $0.50/$3; Gemini 2.5 Flash-Lite: $0.10/$0.40. Gemini 2.5 Pro and 2.5 Flash are deprecated, and from December 1, 2026 their requests route to newer models — [Google AI pricing](https://aistudio.google.com/docs/pricing)
- Grounding with Google Search on Gemini 3+: 5,000 free requests/month, then $14 per 1,000 — [Google AI pricing](https://aistudio.google.com/docs/pricing)

**Image generation APIs**
- Google: Nano Banana 2 (Gemini 3.1 Flash Image) about $0.067/image at 1K, $0.101 at 2K, $0.151 at 4K. Nano Banana 2.1 $0.0336 at 1K. Nano Banana Pro (Gemini 3 Pro Image) $0.134 at 1K/2K, $0.24 at 4K. Gemini 2.5 Flash Image $0.039 ($0.0195 batch), shutting down March 15, 2027. The page did not include Imagen 4 pricing — [Google AI pricing](https://aistudio.google.com/docs/pricing)
- OpenAI: gpt-image-2 $8/MTok image input, $30/MTok image output, $5/MTok text input. gpt-image-1.5 $8/$32. gpt-image-1-mini $2.50/$8. The pricing page gives no per-image price and points to a calculator — [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- Flux on fal.ai (third-party reading of fal pages, Sept 2026): FLUX.1 [schnell] $0.003/MP, FLUX.1 [dev] $0.025/MP, FLUX1.1 [pro] $0.04/MP, rounded up per megapixel — [ModelsLab fal pricing summary](https://modelslab.com/fal-ai-pricing). Other aggregators put Flux Pro at $0.04-$0.055/image — [CostBench](https://costbench.com/compare/flux-vs-midjourney/)
- Midjourney: subscription only, Basic $10, Standard $30, Pro $60/month (March 2026, aggregator) — [CostBench](https://costbench.com/compare/flux-vs-midjourney/)

**Scraping and automation**
- Firecrawl: Free 1,000 credits; Hobby $19/month ($16 annual) 5,000 credits; Standard $99 ($83 annual) 100,000 credits; Growth $399 500k; Scale $749 1M — [Firecrawl pricing](https://www.firecrawl.dev/pricing)
- n8n Cloud (billed annually): Starter €20/month 2.5K executions; Pro €50/month 10K; Business €667/month 40K (self-hosted). The Community Edition is self-hostable from GitHub, with no license fee listed — [n8n pricing](https://n8n.io/pricing/)

**Hosting / CMS**
- Vercel Pro: $20/month platform fee including one deploying seat and $20 usage credit; extra seats $20/month; 1 TB Fast Data Transfer included, then from $0.15/GB. A default spend alert is set at $200/cycle — [Vercel Pro plan docs](https://vercel.com/docs/plans/pro-plan)

**SEO tools**
- Ahrefs (checked November 9, 2026): Starter $29, Lite $129, Standard $249, Advanced $449/month; annual billing about 20% cheaper — [Growigami Ahrefs pricing](https://growigami.com/blog/ahrefs-pricing). G2 (April 2026) lists Advanced at $499. Sources conflict — [G2](https://www.g2.com/products/ahrefs/pricing)
- Semrush restructured its plans in 2026, and its SEO plan starts at $139/month (checked Nov 3, 2026) — [Growigami Semrush pricing](https://growigami.com/blog/semrush-pricing). The older Classic plans were Pro $139.95, Guru $249.95, Business $499.95 — [seo.com](https://www.seo.com/blog/semrush-pricing/)

**Email**
- beehiiv renamed its plans in October 2026: Scale became Lite ($49/month annual, $59 monthly at 1,000 subscribers) and Max became Pro ($95 annual, $109 monthly at 1,000 subscribers). Prices rise with subscriber count — [beehiiv blog: pricing 2026](https://www.beehiiv.com/blog/beehiiv-pricing-2026)

**Testing data source (relevant to sourcing)**
- HearAdvisor (a lab tied to HearingTracker) tests hearing aids on a KEMAR manikin with an 8-speaker ring and 12 recorded sound scenes, and scores them with HASPI v2 into a 0-5 "SoundScore." HearAdvisor and HearingTracker share a founder and staff — [ENT & Audiology News](https://www.entandaudiologynews.com/development/how-i-do-it/post/hearadvisor-s-scientific-and-consumer-friendly-approach-to-evaluating-hearing-aids); [Frontiers in Audiology and Otology 2024](https://www.frontiersin.org/articles/10.3389/fauot.2024.1406362/full); [HearingTracker](https://www.hearingtracker.com/expert-vetting-our-hearing-aid-review-process)

### Inferences
**Per-article LLM cost (est., from the official per-token prices above).** The model assumes an agentic flow with three passes. Research: about 5 searches plus 10-15 page fetches of about 2.5-5k tokens each. Draft: about 2,000 words, which is about 3.5k output tokens with the new tokenizer. Then a fact-check and SEO pass. Totals: about 200k input and 12k output tokens ("typical"), or 500k input and 20k output ("heavy", with re-sent context and no caching).

| Model | Typical (200k in / 12k out + 5 searches) | Heavy (500k in / 20k out + 10 searches) |
|---|---|---|
| Claude Opus 5.5 ($4/$20) | ~$1.09 | ~$2.50 |
| Claude Sonnet 5.5 ($2/$10) | ~$0.57 | ~$1.30 |
| Claude Haiku 5.5 ($0.10/$0.50, <100k prompt per call) | ~$0.08 | ~$0.20 |
| GPT-5.4 ($2.50/$15) | ~$0.73 | ~$1.65 |
| gpt-5.4-mini ($0.75/$4.50) | ~$0.25 | ~$0.56 |
| Gemini 3.1 Pro ($2/$12) | ~$0.61 (grounding free under 5k/month) | ~$1.24 |
| Gemini 3 Flash ($0.50/$3) | ~$0.14 | ~$0.31 |

- Prompt caching and the Batch API can cut these figures by 50-80%. News summaries (about 10k input / 1k output) cost about $0.03 on Sonnet 5.5 and under $0.01 on Haiku, Flash or mini models.
- A sensible split is a cheap model (Haiku 5.5, Gemini Flash or gpt-5.4-mini) for news triage and classification, and a frontier model (Sonnet or Opus 5.5) for reviews and comparisons, plus a second model as an independent fact-checker.
- Images: 2-4 images per article at $0.04-$0.13 each come to about $0.10-$0.50 per article. Image cost is negligible.
- Midjourney is subscription-only. Third-party sources describe it as selling GPU hours, and I found no official public API. That makes it a poor fit for an n8n pipeline. Google, OpenAI or Flux via fal/Replicate are better fits.
- News sourcing: manufacturer newsrooms (Sonova/Phonak, Demant/Oticon, WS Audiology/Signia and Widex, GN/ReSound and Jabra Enhance, Starkey) can be monitored by RSS where it exists and by Firecrawl change-detection where it does not. The FDA 510(k) and De Novo databases are free public data (FDA openFDA API). Press-release wires (PR Newswire, Business Wire, GlobeNewswire) publish free public feeds. I did not verify which manufacturers currently offer RSS feeds (see Gaps).

**Budget scenarios (monthly, est.)**

| Line item | Low (~60 news + 8 reviews/month) | Medium (~150 news + 20 reviews) | High (~300 news + 40 reviews/comparisons) |
|---|---|---|---|
| LLM API | $10-25 (Haiku/Flash news + Sonnet reviews) | $40-80 | $120-300 (Opus + second-model fact-check) |
| Image API | $5-10 | $15-30 | $40-80 |
| Scraping (Firecrawl) | $0-19 | $19-99 | $99-399 |
| Automation (n8n) | ~$5-10 VPS self-host, or €20 Starter | €50 Pro | €50 Pro, or self-host + $40-80 server |
| Hosting | $20 Vercel Pro, or about $10-30 managed WordPress (est., WP prices not verified) | $20-60 | $50-200 (traffic overages) |
| SEO tools | $0 (Search Console) to $29 Ahrefs Starter | $129-139 (Ahrefs Lite or Semrush) | $249-449 |
| Email (beehiiv) | $0 free tier (not verified) to $59 | $59-109 | $109+ (scales with list) |
| Domain | about $1-2/month (est.) | same | same |
| **Software subtotal** | **~$60-180** | **~$350-600** | **~$800-1,600** |

One-time setup (est.): domain about $10-20, logo and theme $0-500, developer or n8n workflow build $0 if you build it yourself, or $2k-10k freelance. Legal review of the disclaimer, privacy policy and affiliate-disclosure templates: about $500-2,500 (an estimate; no source found).

### Gaps
- Per-image prices for OpenAI gpt-image-2 by quality and size were not on the pricing page, which only gives per-token rates. Prior knowledge puts gpt-image-1 at about $0.01-$0.17 per image depending on quality, but this was not verified in this session.
- Imagen 4 per-image price was not found on the fetched page.
- Apify, Make and Zapier pricing; WP Engine, Kinsta and Cloudways pricing; Kit (ConvertKit) pricing; and the beehiiv free-tier limits were not fetched (limited tool budget). Verify them on vendor pages.
- I did not verify which manufacturers currently publish working RSS feeds.
- Ahrefs and Semrush mid-tier prices conflict across third-party sources.

## 2. Costs of human involvement still needed (medical reviewer, editor, devices, measurement, photography)

### Takeaway
The biggest recurring cost is human: an audiologist reviewer at about $60-$100/hour, plus devices for hands-on testing at $250-$2,000 per pair. A lab-grade KEMAR setup is "price on request" and well beyond a small site's budget. Partnering with or citing a lab such as HearAdvisor, or building a cheaper coupler-based setup, is the realistic option.

### Cited Findings
- Freelance medical content reviewers advertise $30-$47/hour (Epoch Times, about 10 hours/week) and $20-$75/hour (MyHealthTeam). ZipRecruiter's average for generic "freelance reviewer" is $47.71/hour — [JournalismJobs (Epoch Times listing)](https://www.journalismjobs.com/1693478-medical-content-reviewer-the-epoch-times); [ZipRecruiter](https://www.ziprecruiter.com/Jobs/Remote-Article-Reviewer); [ZipRecruiter](https://www.ziprecruiter.com/Jobs/Freelance-Reviewer)
- Audiologists on Kolabtree set their own rates, for example $60/hour and $100/hour — [Kolabtree audiology experts](https://kolabtree.com/find-an-expert/subject/audiology)
- Some health publishers pay medical reviewers per article or by monthly retainer, for example for 4-6 reviews/month — [Greenhouse job listing (RVOH)](https://job-boards.greenhouse.io/rvohcontentfreelance/jobs/4304309005)
- Many experienced freelance medical writers charge per project rather than by the hour — [AMWA blog](https://blog.amwa.org/how-should-i-set-my-freelance-medical-writing-rates)
- Device prices (2026): Apple AirPods Pro (hearing-aid feature, needs an iPhone or iPad) up to about $250 per pair. Jabra Enhance Plus about $799. Jabra Enhance Select $1,195-$1,995 per pair (sources vary). Lexie B2 about $999 list. Sony has exited the OTC hearing-aid market. AirPods Pro 2 are discontinued, and AirPods Pro 3 also support the Hearing Aid feature — [Consumer Reports](https://www.consumerreports.org/health/hearing-aids/over-the-counter-hearing-aids-brands-comparison-a3246025494/); [CBS News](https://www.cbsnews.com/essentials/best-cheap-hearing-aids/); [NCOA Jabra review](https://ncoa.org/product-resources/hearing-aids/jabra-enhance-review)
- HearingTracker's 2026 price survey and OTC roundups track true costs — [HearingTracker price survey](https://www.hearingtracker.com/hearing-aid-prices-survey); [HearingTracker OTC](https://www.hearingtracker.com/otc-hearing-aids)
- The GRAS 45BB KEMAR, including the 45BB-2 hearing-aid variant (1-channel, ear simulator, delivered calibrated), is sold "price on request" by GRAS and its reseller GoMeasure — [GoMeasure 45BB-2](https://www.gomeasure.dk/?p=19555); [GRAS](https://www.grasacoustics.com/products/head-torso-simulators-kemar?page=3)
- HearAdvisor's lab is an acoustically treated, low-reverberation room with an 8-speaker ring and KEMAR. Testing covers "Initial" and "Tuned" fits — [Frontiers 2024](https://www.frontiersin.org/articles/10.3389/fauot.2024.1406362/full); [HearingTracker launch article](https://www.hearingtracker.com/news/hearadvisor-launches-audio-lab-to-test-and-rate-otc-and-prescription-hearing-aids)

### Inferences
- Medical review cost per article (est.): 0.75-1.5 hours × $60-$100 comes to about $45-$150 per review or comparison. Monthly: Low (8 reviews) about $400-$1,200; Medium (20) about $900-$3,000; High (40) about $1,800-$6,000. News items can go out without clinical review if they stay factual and make no health claims.
- Device budget (est.): buying 1-2 OTC models a month at $250-$2,000 comes to about $300-$3,000/month. Reselling or returning devices within retailer return windows (often 30-100 days for hearing aids) can offset part of this. This is not verified per retailer, and returning devices bought only for review raises ethical questions.
- Measurement: KEMAR-class systems are likely in the tens of thousands of dollars (not verified, since the price is on request). The low and medium options are: (a) license or cite HearAdvisor or other published lab data with attribution, (b) hire an audiologist with clinic real-ear and coupler equipment by the hour, or (c) do qualitative wear tests only and say so openly.
- Editor (est., unsourced): a part-time freelance health editor at about 10-40 hours/month. No rate source was found.
- Photographer (est., unsourced): real product photos are needed to back up any "we tested it" claim. The cheapest route is in-house smartphone photography or a light box ($50-$200 one-time).

**Human-involvement budget summary (monthly, est.)**

| Item | Low | Medium | High |
|---|---|---|---|
| Audiologist medical reviewer | $400-1,200 | $900-3,000 | $1,800-6,000 (or retainer) |
| Editor / fact-checker | $0 (owner) | $500-1,500 | $2,000-4,000 |
| Devices for hands-on tests | $0-500 (cite labs, test cheap units) | $500-1,500 | $1,500-3,000 |
| Lab measurements | $0 (cite published data) | per-hour audiologist clinic time | lab partnership or own coupler/KEMAR rig (one-time, price on request) |
| Photography | $0-200 one-time light box | $200-500/month | $500-1,500/month |

### Gaps
- No published per-article rate for audiologist medical reviewers. The figures above are hourly listings and self-set marketplace rates.
- No KEMAR or ear-simulator list price, and no HearAdvisor partnership or data-licensing terms.
- No sourced freelance editor or photographer rates for health content.

## 3. Legal constraints (copyright, trademark/AI images, FTC endorsements and fake-review rule, FDA claims, privacy/health data)

### Takeaway
The main legal risk is the FTC, not copyright. The site must not say or imply hands-on testing, expert testing or "reviews" that did not happen, and it must disclose affiliate links clearly. AI-written comparison content is legal if it is framed honestly (for example, "spec comparison based on manufacturer data, reviewed by audiologist X"). Pure AI output is not copyrightable, and health-data tracking on lead forms falls under the FTC's Health Breach Notification Rule.

### Cited Findings

**FTC Consumer Reviews and Testimonials Rule (16 CFR Part 465)**
- Final rule announced August 2024 (5-0 vote), published 89 FR 68034 (Aug 22, 2024), effective October 21, 2024 — [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials); [Federal Register](https://www.govinfo.gov/content/pkg/FR-2024-08-22/html/2024-18519.htm)
- The rule bans reviews and testimonials that misrepresent that they come from a real person, including AI-generated fakes, or from someone with no actual experience of the product, or that misrepresent the reviewer's experience — [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)
- FTC staff Q&A: a "consumer review" is a consumer's evaluation posted on a platform for such reviews. The rule targets misrepresenting a reviewer's experience. Businesses are liable when they write or buy reviews they "knew or should have known were false." The rule "authorizes courts to impose civil penalties for knowing violations." Section 465.6 bars misrepresenting that a website a business controls gives independent reviews, and an ownership disclosure does not cure an express false claim of independence. The Q&A is staff guidance with no safe harbor — [FTC Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers)
- The FTC published a 2025 fake-review warning-letter template, a sign of active enforcement — [FTC 2025 warning template](https://search.ftc.gov/system/files/ftc_gov/pdf/2025-Fake-Review-Warning-Template.pdf)

**FTC Endorsement Guides (16 CFR Part 255, revised 2023)**
- The revised Guides took effect July 26, 2023 — [Federal Register](https://www.federalregister.gov/documents/2023/07/26/2023-14795/guides-concerning-the-use-of-endorsements-and-testimonials-in-advertising)
- Endorsements must reflect the endorser's honest opinions, findings, beliefs or experience. An expert endorser must have the expertise claimed and can be liable if they endorse without examining or testing the product as an expert normally would — [Kirkland alert](https://kirkland.com/publications/kirkland-alert/2023/07/federal-trade-commission-releases-first-updates-to-endorsement-guides-in-14-years); [FTC Endorsement Guides](https://www.ftc.gov/news-events/topics/truth-advertising/advertisement-endorsements)
- Affiliate disclosure: "affiliate link" alone or a "buy now" button is not adequate. "Paid link" next to the link, or "I get commissions for purchases made through links in this post," is acceptable — [Perkins Coie](https://perkinscoie.com/insights/update/ftc-finalizes-updated-guidance-influencer-and-consumer-review-programs); [Kelley Drye](https://www.kelleydrye.com/viewpoints/blogs/ad-law-access/new-endorsement-guides-include-big-changes-but-few-surprises)

**Copyright and AI output**
- US Copyright Office, "Copyright and AI, Part 2: Copyrightability" (Jan 29, 2025): purely AI-generated material, or material without enough human control over its expressive elements, is not protected. Prompts alone are not enough. Human selection, arrangement or modification can be protected, and AI assistance does not bar protection for human contributions — [Copyright Office NewsNet](https://copyright.gov/newsnet/2025/1060.html); [Reed Smith](https://www.reedsmith.com/en/perspectives/2025/02/copyright-office-anticipated-part-two-report-ai-addressing-copyrightability); [Hogan Lovells](https://www.hoganlovells.com/en/publications/us-copyright-office-issues-report-on-copyrightability-of-ai-assisted-and-generated-works)

**FDA OTC hearing-aid rule**
- Final rule 87 FR 50698 (Aug 17, 2022), effective Oct 17, 2022. It created the OTC category (21 CFR 800.30) for adults 18+, with labeling and output limits. Hearing aids that don't meet 800.30 are prescription devices (801.422). The rule preempts conflicting state law — [Federal Register](https://www.federalregister.gov/documents/2022/08/17/2022-17230/medical-devices-ear-nose-and-throat-devices-establishing-over-the-counter-hearing-aids); [DLA Piper](https://www.dlapiper.com/en-lu/insights/publications/2022/09/fda-finalizes-otc-hearing-aid-rule); [eCFR 800.30 (Cornell LII)](https://www.law.cornell.edu/cfr/text/21/800.30)

**Health data, tracking pixels, lead generation**
- The FTC amended the Health Breach Notification Rule in 2024. It covers health apps and sites not covered by HIPAA. Sharing health information with third parties through tracking technology without authorization can be a "breach of security" — [Federal Register HBNR 2024](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule); [DWT](https://www.dwt.com/blogs/privacy--security-law-blog/2024/05/ftc-finalizes-hbnr-to-cover-health-app-breaches)
- In the FTC's first HBNR enforcement (GoodRx, Feb 2023), the complaint cited pixels sending health-related URLs to ad platforms — [Holland & Knight](https://hklaw.com/en/insights/publications/2023/02/ftc-seeks-firstever-health-breach-notification-rule-enforcement)
- In July 2023 the FTC and HHS OCR jointly warned about about 130 hospitals and telehealth providers about third-party trackers — [FTC/OCR letter](https://www.ftc.gov/system/files/ftc_gov/pdf/FTC-OCR-Letter-Third-Party-Trackers-07-20-2023.pdf); [HHS tracking guidance](https://www.hhs.gov/sites/default/files/use-online-tracking-technologies.pdf)

### Inferences
- **Does an AI-written "review" without testing violate the fake-review rule?** Part 465 is aimed at *consumer reviews* and testimonials. An editorial article by a publisher is most likely not a "consumer review" under that definition. But publishing it as a hands-on review ("we tested," "after two weeks of wear," a fake reviewer persona, invented user quotes or star ratings attributed to people) misrepresents experience. That is deceptive under FTC Act §5 and the Endorsement Guides, and fake personas or quotes can fall directly under Part 465 as AI-generated fake testimonials. If the site earns affiliate commissions, the FTC can treat it as an endorser/advertiser. Safe framing: "spec comparison," "roundup based on manufacturer data and published lab results," "medically reviewed by [real name, AuD]." Only use "tested"/"review" language when someone actually tested the device.
- **Fake expertise:** listing an audiologist as reviewer when they only skimmed the article, or inventing an AI "expert" byline, creates the expert-endorser liability above (the endorser must examine the product as an expert normally would).
- **Do not create a fake "independent lab"** or rating seal. Section 465.6 bars misrepresenting the independence of a review site the business controls. If the site is ever owned by, or paid by, a manufacturer or clinic network, that must be disclosed.
- **Affiliate disclosure:** put a clear disclosure at the top of each article (before the first link), plus "paid link" labels near buttons. A footer-only disclosure is not enough.
- **Copyright, news rewriting (inference, not sourced in this session):** facts (specs, launch dates, prices) are not copyrightable, but copying the wording, structure or long quotes of press releases or articles is. Rewrite from several sources, add original analysis, link to sources, and keep quotes short. Press releases are generally issued for redistribution, but manufacturer press-kit photos usually come with license terms (editorial use only, credit required). Read and log each kit's terms. Put a DMCA agent registration and takedown process in place (the US Copyright Office DMCA agent registration is a low fixed fee; amount not verified in this session).
- **AI images are not protected:** the site cannot stop competitors copying AI images, and the images give no exclusive brand asset. Real photos of tested devices are both legally and commercially stronger.
- **AI images of branded products (inference, not sourced):** realistic AI images that show a specific brand's hearing aid can mislead (wrong design, features or colors), may be read as "real product photos," and can raise trademark or false-endorsement issues if logos appear. Prefer generic, unbranded illustrations, label them "AI-generated illustration," and use manufacturer press images (within license) or your own photos for actual products.
- **FDA:** the FDA regulates manufacturers' labeling. Editorial content is mostly regulated by the FTC (advertising). Still, avoid medical claims (for example "cures tinnitus," "prevents dementia," "treats hearing loss in children" with OTC devices), and do not suggest OTC aids for users under 18 or with severe or profound loss, since OTC is limited to adults 18+ with perceived mild-to-moderate loss. Add a health disclaimer ("not medical advice; see an audiologist or ENT; seek urgent care for sudden hearing loss").
- **HIPAA:** a publisher or affiliate site is generally not a HIPAA covered entity. It could become a business associate only if it handles PHI on behalf of clinics under contract. The bigger risk is the FTC HBNR and FTC Act if online hearing tests, "find a clinic" forms or quiz answers about hearing loss are sent to Meta or Google pixels. Keep health-related form data out of ad pixels, use server-side consent controls, and get explicit consent before selling or sharing leads.
- **CCPA/CPRA and state health-privacy laws (inference, not sourced):** state privacy laws treat health data as "sensitive." Washington's My Health My Data Act, for example, requires separate consent for consumer health data. Lead-generation sites need a privacy policy, opt-outs for "sale/sharing," and consent records. GDPR applies only if the site targets EU users; geo-blocking or a GDPR-compliant consent banner is enough.

### Gaps
- No sourced figure for current FTC civil-penalty amounts per violation (inflation-adjusted yearly; prior knowledge puts it around $50k+ per violation, not verified here).
- No FTC enforcement action found that targets AI-written editorial product reviews by an affiliate publisher specifically.
- Trademark law on AI images of branded products, and case law on aggregating or rewriting news (hot news, fair use), were not researched with primary sources in this session.
- CCPA/CPRA thresholds, Washington MHMDA details and GDPR specifics were not fetched.
- FDA guidance on third-party advertising claims for OTC hearing aids was not found; the FTC is assumed to be the primary regulator of ad claims.

## 4. Practical quality controls for AI content (spec fact-checking, hallucination risk, editorial workflow)

### Takeaway
The workflow needs to be human-gated: AI drafts, a script and a second model check specs against primary sources, a human editor approves, and an audiologist signs off on health claims. "Tested" claims are allowed only when real testing data exists. Credible competitors (HearingTracker/HearAdvisor) publish their methodology, combining lab measurement with separate hands-on wear tests.

### Cited Findings
- HearingTracker evaluates hearing aids two ways: standardized sound tests in HearAdvisor's lab and hands-on wear and use tests by its own review team. It publishes an expert-vetting process — [HearingTracker expert vetting](https://www.hearingtracker.com/expert-vetting-our-hearing-aid-review-process)
- HearAdvisor's method is published (procedures v1.0, a peer-reviewed Frontiers 2024 paper). Score weights come from a survey of 107 consumers and 95 hearing professionals. The authors call for further validation against real-world benefit — [Frontiers 2024](https://www.frontiersin.org/articles/10.3389/fauot.2024.1406362/full)
- FTC: an expert endorser must test the product as extensively as an expert normally would — [Kirkland alert](https://kirkland.com/publications/kirkland-alert/2023/07/federal-trade-commission-releases-first-updates-to-endorsement-guides-in-14-years)
- Anthropic web fetch has a `max_content_tokens` limit to control cost when pulling large source pages — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)

### Inferences (proposed process, not sourced as industry standard)
1. **Ingest:** n8n cron pulls RSS, Firecrawl diffs of manufacturer newsrooms, FDA openFDA 510(k) queries and PR wires. It removes duplicates by URL or hash and stores raw source text and screenshots, giving an audit trail.
2. **Structured spec extraction:** a cheap model extracts specs (battery life, IP rating, channels, Bluetooth LE Audio/Auracast, OTC vs Rx, price, FDA status) into a JSON schema from manufacturer spec sheets only. Each field keeps a source URL and quoted snippet. Fields without a source are left null and never filled in by the model.
3. **Spec database as single source of truth:** articles read specs from the database, not free-form from the LLM. Comparison tables are built from the database.
4. **Draft:** a frontier model writes from database fields plus cited sources, with a system prompt that forbids invented experiences, quotes, test results or persona bylines.
5. **Automated fact-check:** a second model from a different vendor checks every number and claim against the stored sources and flags anything unsupported. A regex/linter blocks phrases like "we tested," "in our experience" or "after wearing" unless a test record exists. A medical-claims linter blocks "cure," "treat," "prevent dementia" and similar.
6. **Human gates:** an editor approves every review or comparison. The audiologist reviews health statements and is named, with credentials and a review date. News items can auto-publish only after checks pass, with a short delay and a correction workflow.
7. **Disclosure and labeling:** a per-article "How we made this" box (AI-assisted, sources used, tested or not tested, reviewer name), an affiliate disclosure above the fold, and "AI-generated illustration" captions on images.
8. **Maintenance:** re-check prices and specs monthly through the scraper, keep a visible "last updated" date and a public corrections log, and keep records (sources, test notes, reviewer sign-off) as evidence if the FTC or a manufacturer challenges a claim.

### Gaps
- No published hallucination-rate benchmarks for spec extraction in this domain were researched.
- No sourced industry-standard editorial SOP for AI-assisted health publishing (for example from Google's guidance or medical-journalism bodies) was gathered in this session.
