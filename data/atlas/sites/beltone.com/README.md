# beltone.com

Beltone's live brand site: server-rendered (no scripts needed), US catalog at /en-us/products/hearing-aids with model pages and per-model support pages listing user-guide downloads; en-ca mirrors it and /en is an international site with different URLs. [1] [2]

## What this site is and whose

- beltone.com is the Beltone brand site, with a US edition at /en-us. [3]
- The /en pages carry a Beltone Group address in Ballerup, Denmark and a country selector. [4]
- The site also has a separate shop at shop.beltone.com, titled Beltone's Official Online Store. [5]

## Structure

- robots.txt disallows only /sitecore/content and lists sitemaps /en-us/xmlsitemap and /en/sitemapindex. [6]
- The sitemaps hold 1934 URLs: 1662 under /en-us, 160 under /en, 112 under /en-ca. [7] [8]
- Per-locale xmlsitemap files exist for da, en-au, en-ca, en-gb, en-in, en-us, es-es, es-ln, fr-fr and it-it. de-at, de-de, fi-fi, ko-kr, pl-pl and pt-br return 404. [9]
- US model URL template: /en-us/products/hearing-aids/{slug} (8 pages). en-ca uses the same template (8 pages). [10] [11]
- The en-us sitemap lists some odd /en/en-us/... URLs such as login and add-a-lead. [7]
- Most of the US sitemap is clinic pages /en-us/location/{state}/{city}/{id} and articles /en-us/articles/{slug} (250). [12] [13]
- The /en site uses a different model template: /en/hearing-aids/beltone-hearing-solutions/{slug} (23 pages). [14]

## Catalog, support, documents and apps

- US catalog page: /en-us/products/hearing-aids. Menu models: Illuminate, Envision, Commence, Boost Max S, Serene, Achieve. [1] [3]
- A Boost Ultra model page exists at /en-us/products/hearing-aids/beltone-boost-ultra, although the menu does not list it. [15] [3]
- Support hub /en-us/help-center/hearing-aids-support lists support pages for Illuminate, Envision, Commence, Boost Max S, Serene, Achieve, Rely, Boost Ultra and legacy models. [2]
- Per-model support pages list user guides (English and Spanish) by style, plus how-to topics, e.g. Achieve, Illuminate, Rely and Boost Ultra. [16] [17] [18] [19]
- The report finds no PDF links on the support pages it crawled. Its only PDF is a GN charger notice from May 2023, linked from the Achieve model pages. [10]
- The en-ca hearing-aids support page links a product list PDF on cdn1-originals.webdamdb.com (March 2024). [20]
- The international /en site has support pages at /en/support/hearing-aids-support/{slug}. Its Achieve guides auto-download on click. [4]
- Apps: the model pages link the HearMax app (iOS id 1161360579, Android com.beltone.hearmax). Apps support lists HearMax, Tinnitus Calmer and HearPlus. [21] [22]
- The cost page gives price ranges by tier only, with no per-model prices. [23]

## Rendering and quirks

- Every crawled page has needsRender false, including the model pages, so the catalog and models work without scripts. [1] [21]

## Links to other sites

- The pages link ownabeltone.com (en-us and en-ca) and the shop at shop.beltone.com. [3] [5]
- The report lists no redirects. [3]

## Web Archive

- Web Archive has captures of /en-us (2019 to 2026, latest 20261104074120), /en, /en-ca and the US catalog page. [3]
- The catalog page /en-us/products/hearing-aids has captures from 2023 to 2026, latest 20260921085907. [1]

## What the next agent should check

- Check whether the model pattern should include beltone-boost-ultra, and whether the catalog page lists Boost Ultra and Rely. [15] [2]
- Check the support pages for real guide PDF URLs. The user-guide links were not visible in the page text. [16]
- Decide whether to scrape the en-ca and /en editions, which use different URL templates and model sets. [24] [14]

[1]: https://www.beltone.com/en-us/products/hearing-aids (fetched 2026-11-27T17:07:54.404Z)
[2]: https://www.beltone.com/en-us/help-center/hearing-aids-support (fetched 2026-11-27T17:08:21.098Z)
[3]: https://www.beltone.com/en-us/ (fetched 2026-11-27T17:07:06.527Z)
[4]: https://www.beltone.com/en/support/hearing-aids-support/beltone-achieve-support (fetched 2026-11-27T18:48:45.504Z)
[5]: https://shop.beltone.com/ (fetched 2026-11-27T17:10:39.602Z)
[6]: https://www.beltone.com/robots.txt (fetched 2026-11-27T18:48:26.904Z)
[7]: https://www.beltone.com/en-us/xmlsitemap (fetched 2026-11-27T17:07:00.430Z)
[8]: https://www.beltone.com/en/sitemapindex (fetched 2026-11-27T17:05:09.170Z)
[9]: https://www.beltone.com/da/xmlsitemap (fetched 2026-11-27T17:05:16.314Z)
[10]: https://www.beltone.com/en-us/products/hearing-aids/beltone-achieve (fetched 2026-11-27T17:08:16.787Z)
[11]: https://www.beltone.com/en-ca/products/hearing-aids/beltone-achieve (fetched 2026-11-27T17:09:35.629Z)
[12]: https://www.beltone.com/en-us/location/al/albertville/0050749002 (fetched 2026-11-27T17:07:21.820Z)
[13]: https://www.beltone.com/en-us/articles (fetched 2026-11-27T17:11:07.479Z)
[14]: https://www.beltone.com/en/hearing-aids/beltone-hearing-solutions/beltone-achieve (fetched 2026-11-27T18:48:42.713Z)
[15]: https://www.beltone.com/en-us/products/hearing-aids/beltone-boost-ultra (fetched 2026-11-27T18:48:34.624Z)
[16]: https://www.beltone.com/en-us/help-center/hearing-aids-support/beltone-achieve-support (fetched 2026-11-27T18:48:31.487Z)
[17]: https://www.beltone.com/en-us/help-center/hearing-aids-support/beltone-illuminate-support (fetched 2026-11-27T18:49:06.049Z)
[18]: https://www.beltone.com/en-us/help-center/hearing-aids-support/beltone-rely-support (fetched 2026-11-27T18:49:09.427Z)
[19]: https://www.beltone.com/en-us/help-center/hearing-aids-support/beltone-boost-ultra-support (fetched 2026-11-27T18:48:37.516Z)
[20]: https://www.beltone.com/en-ca/help-center/hearing-aids-support (fetched 2026-11-27T17:09:57.632Z)
[21]: https://www.beltone.com/en-us/products/hearing-aids/beltone-illuminate (fetched 2026-11-27T17:07:59.897Z)
[22]: https://www.beltone.com/en-us/help-center/apps-support (fetched 2026-11-27T17:08:24.749Z)
[23]: https://www.beltone.com/en-us/help-center/the-cost-of-hearing-aids (fetched 2026-11-27T17:08:36.372Z)
[24]: https://www.beltone.com/en-ca/products/hearing-aids (fetched 2026-11-27T17:09:11.292Z)
