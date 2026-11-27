# jabraenhance.com

Live US brand site of Jabra Enhance selling three OTC Enhance Select models (M3, M2, M1) at /product/enhanceselect{m1,m2,m3}; pages are server-rendered, user guide PDFs are on cdn.jabraenhance.com and support articles on help.jabraenhance.com. [1] [2] [3]

## What this site is and whose

- Jabra Enhance online store selling Enhance Select hearing aids directly to consumers. [4]
- Homepage lists three models: Enhance Select M3 ($1,695, was $1,995), M2 ($1,695) and M1 ($1,195). [4]
- The M-series are FDA-cleared self-fitting over-the-counter hearing aids. [5]
- Purchases include 3 years of virtual audiology, a 100-day trial and a 3-year warranty. [4] [6]
- Older Lively models and Enhance Plus earbuds still have user guide pages. [7] [8]

## Structure

- robots.txt lists five sitemaps: sitemap.xml (index), sitemap-products.xml, blog/sitemap.xml, copp/sitemap.xml and copp/sitemap-accessories.xml. [9] [10]
- sitemap-products.xml lists only the three model pages enhanceselectm3, m2 and m1. [2]
- The sitemap index also points to sitemap-0.xml, which lists static pages and product comparison pages such as /product/m3-vs-500 and /product/700-vs-100. [10] [11]
- URL templates: /product/{slug}, /accessories/{slug}, /start/{model}/{step}, /blog/{slug} and help.jabraenhance.com/{category}/{article}. [12] [13]
- /product/{x}-vs-{y} comparison pages share the /product/ prefix with model pages, so the model pattern must not match them. [6] [11]
- The sitemap holds 100 URLs, mostly under /start (36), /accessories (19) and /product (12). [4]

## Catalog, support, documents and apps

- The catalog is https://www.jabraenhance.com/product (JSON-LD ItemList). [1]
- Model pages are /product/enhanceselectm1, m2 and m3. [12] [5] [14]
- The help center /help links user guide PDFs for M3, M2 and M1 on cdn.jabraenhance.com/shared/userguides/. [3]
- Each model page links its own user guide PDF. [12] [5] [14]
- /start lists device quick-start guides: Select 700, 500, 300 and 50R are current; 200, 100 and 50 are marked Discontinued. [15]
- /start links two getting-started PDFs on sound-files.jabraenhance.com for devices bought before 12/13/21. [15]
- help.jabraenhance.com/user-guides lists the Select, Enhance Plus and Lively guide groups. [16]
- The Lively guide page is help.jabraenhance.com/user-guides/former-lively-model-user-guides, and the Plus guide is at /user-guides/enhance-plus-user-guide. [7] [8]
- The Jabra Enhance Select app is iOS id1502033340 and Android com.lively.app. [12] [17]
- A tinnitus support article links the ReSound Tinnitus Relief app (iOS 928432517, Android com.gnresound.tinnitus). [18]

## Rendering and quirks

- Homepage, catalog, model pages, /help and the sitemaps are flagged as not needing rendering. [4] [1] [12] [3]
- /start, /contact-us, /compatibility and /survey need rendering. [15] [19] [20] [21]
- On help.jabraenhance.com, /user-guides, /troubleshooting-our-products and /audiology-services-appointments need rendering, while individual articles do not. [16] [22] [23] [24]
- Several accessory pages (wax guard bundle, cleaning kit, domes, mic filter bundle) need rendering. [25] [26] [27]
- robots.txt disallows /purchase, /cart, /refer, /account, /my-account, /schedule, /getapp, /activate and /articles. [9]

## Links to other sites

- /help/user-guides redirects to help.jabraenhance.com/user-guides. [28]
- Document hosts: cdn.jabraenhance.com (user guides) and sound-files.jabraenhance.com (getting-started guides). [3] [15]
- help.jabraenhance.com is a separate help-center subdomain. [16]
- External links are mostly social, BBB, YouTube, research and state licensing sites; the terms page links jabra.com warranty and the about page links the GN careers site. [29] [30]
- The hearing-aid-guide and online-hearing-test blog pages link a third-party PDF on hearingloss.org, which is not a product document. [31] [32]

## Web Archive

- Web Archive has copies of /product (2022–2026, latest 20261027011215), the homepage, /start, /accessories, /blog and /refer. [1]

## What the next agent should check

- Check that the model pattern excludes /product/{x}-vs-{y} pages and whether other Select models exist beyond M1–M3. [11] [1]
- Check whether the Select 700, 500, 300 and 50R quick-start guides map to models still sold. [15]
- Fetch help.jabraenhance.com/user-guides with rendering to list the Select guide PDFs, and check the Enhance Plus and Lively guide PDFs. [16] [8] [7]

[1]: https://www.jabraenhance.com/product (fetched 2026-11-27T22:14:17.430Z)
[2]: https://www.jabraenhance.com/sitemap-products.xml (fetched 2026-11-27T22:12:44.436Z)
[3]: https://www.jabraenhance.com/help (fetched 2026-11-27T22:13:35.374Z)
[4]: https://www.jabraenhance.com/ (fetched 2026-11-27T22:13:01.681Z)
[5]: https://www.jabraenhance.com/product/enhanceselectm2 (fetched 2026-11-27T22:14:20.543Z)
[6]: https://www.jabraenhance.com/product/m3-vs-500 (fetched 2026-11-27T22:14:38.888Z)
[7]: https://help.jabraenhance.com/user-guides/former-lively-model-user-guides (fetched 2026-11-27T22:36:55.771Z)
[8]: https://help.jabraenhance.com/user-guides/enhance-plus-user-guide (fetched 2026-11-27T22:36:50.773Z)
[9]: https://www.jabraenhance.com/robots.txt (fetched 2026-11-27T22:12:37.515Z)
[10]: https://www.jabraenhance.com/sitemap.xml (fetched 2026-11-27T22:12:41.549Z)
[11]: https://www.jabraenhance.com/sitemap-0.xml (fetched 2026-11-27T22:12:56.953Z)
[12]: https://www.jabraenhance.com/product/enhanceselectm3 (fetched 2026-11-27T22:13:05.240Z)
[13]: https://www.jabraenhance.com/accessories (fetched 2026-11-27T22:13:21.773Z)
[14]: https://www.jabraenhance.com/product/enhanceselectm1 (fetched 2026-11-27T22:14:24.664Z)
[15]: https://www.jabraenhance.com/start (fetched 2026-11-27T22:13:37.952Z)
[16]: https://help.jabraenhance.com/user-guides (fetched 2026-11-27T22:36:47.625Z)
[17]: https://help.jabraenhance.com/connecting-to-your-phone-app/how-to-connect-to-the-jabra-enhance-select-app (fetched 2026-11-27T22:15:03.792Z)
[18]: https://help.jabraenhance.com/audiology-services/your-guide-to-tinnitus-support-with-jabra-enhance (fetched 2026-11-27T22:15:32.395Z)
[19]: https://www.jabraenhance.com/contact-us (fetched 2026-11-27T22:13:26.057Z)
[20]: https://www.jabraenhance.com/compatibility (fetched 2026-11-27T22:13:54.433Z)
[21]: https://www.jabraenhance.com/survey (fetched 2026-11-27T22:13:40.490Z)
[22]: https://help.jabraenhance.com/troubleshooting-our-products (fetched 2026-11-27T22:15:16.651Z)
[23]: https://help.jabraenhance.com/audiology-services-appointments (fetched 2026-11-27T22:15:21.485Z)
[24]: https://help.jabraenhance.com/setup/how-to-setup-your-hearing-aids (fetched 2026-11-27T22:14:59.995Z)
[25]: https://www.jabraenhance.com/accessories/wax-guard-bundle (fetched 2026-11-27T22:16:26.340Z)
[26]: https://www.jabraenhance.com/accessories/cleaning-kit (fetched 2026-11-27T22:16:30.132Z)
[27]: https://www.jabraenhance.com/accessories/open-domes (fetched 2026-11-27T22:16:39.477Z)
[28]: https://help.jabraenhance.com/user-guides (fetched 2026-11-27T22:15:35.751Z)
[29]: https://www.jabraenhance.com/terms-and-conditions (fetched 2026-11-27T22:14:14.226Z)
[30]: https://www.jabraenhance.com/about (fetched 2026-11-27T22:13:45.402Z)
[31]: https://www.jabraenhance.com/hearing-aid-guide (fetched 2026-11-27T22:13:10.344Z)
[32]: https://www.jabraenhance.com/blog/online-hearing-test (fetched 2026-11-27T22:14:29.673Z)
