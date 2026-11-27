# resound.com

resound.com is the live, multi-locale ReSound (GN Hearing) brand site; the en-us catalog at /en-us/hearing-aids/resound-hearing-aids lists model pages with plain HTML, and documents are on per-model /en-us/help/hearing-aids/{model} support pages. [1] [2]

## What this site is and whose

- The site is ReSound's brand site; the footer names GN Hearing A/S, Ballerup, Denmark as the owner. [3]
- The start page sells no hearing aids directly: it presents ReSound hearing aids, apps and accessories and refers visitors to hearing care professionals. [4]

## Structure

- robots.txt lists two sitemaps: /en-us/xmlsitemap and /en/sitemapindex. It disallows only /sitecore/content and */1000$. [5]
- The report fetched per-locale xmlsitemap files (ar-sa, cs-cz, da, de-at, de-ch, de-de, en-au, en-ca, en-gb, en-in, en-us, es-es, es-ln, fi-fi, fr-ch, fr-fr, it-it, ja-jp). The sitemaps hold 666 URLs in total; the largest sections are /en (207), /da (155), /en-us (155) and /en-ca (149). [6] [7]
- Locale prefixes come first in the URL, for example /en-us, /en-ca, /en and /da. The same path structure repeats under each prefix. [4] [8] [9] [10]
- Model page template: /en-us/hearing-aids/resound-hearing-aids/{slug}, with 12 URLs in the sitemap. The report lists enzo-3d, enzo-q and enzo2 as examples. [3]
- Support page template: /en-us/help/hearing-aids/{slug}, with 11 URLs. The report lists enzo-ia, enzo-q and key as examples. Accessory support is at /en-us/help/accessories/{slug} and app support at /en-us/help/apps/{slug}. [11] [12] [13]
- Model pages with a sub-path exist, for example /hearing-aids/resound-hearing-aids/quattro/{slug}. The sitemap also holds placeholder or link-resolver URLs such as /hearing-aids/LINK_Placeholder and /hearing-aids/~/link.aspx?_id=..., which a scraper should skip. [6]
- Press pages sit at /en-us/press/{slug}, and the sitemap marks each page with hreflang alternates for all locales. [6]

## Catalog, support, documents and apps

- The en-us catalog is /en-us/hearing-aids/resound-hearing-aids. The report fetched model pages for Sensia, Vivia, Nexia, Enzo IA, Savi, Key, and the en-us sitemap also lists Enzo Q, Enzo 3D and Enzo2. [1] [14] [15] [16] [17] [18] [19]
- Model slugs are not uniform. Sensia, Vivia, Nexia, Enzo IA, Savi and Key are served as resound-{name}, while the sitemap examples enzo-q, enzo-3d and enzo2 have no resound- prefix. [14] [3]
- Support hub for hearing aids: /en-us/help/hearing-aids, which lists Sensia, Vivia, Enzo IA, Savi, Nexia, OMNIA, LiNX Quattro, ENZO Q, Key and other ReSound hearing aids. [20]
- The Key support page lists user guides (RIE, RIE rechargeable, BTE, BTE power, custom, chargers) and quick guides for Key 61/62/67/77/88/98. The Enzo IA page lists a brochure, a user guide and a quick guide. The ENZO Q page lists a user guide, brochure, pairing guide and quick guides. [2] [11] [21]
- Accessory support: /en-us/help/accessories, and /en-us/help/accessories/multi-mic lists Multi-Mic+ and Micro Mic guides. [22] [12]
- App support: /en-us/help/apps, and /en-us/help/apps/smart-3d lists a pairing guide and user guides. The Smart 3D app is on iOS (id 1134918918) and Android (dk.resound.smart3d). The Smart app and Relief app are also described. [23] [13] [24]
- The Relief tinnitus app has its own iOS id 928432517 and Android id com.gnresound.tinnitus. [25]
- The device compatibility page is /en-us/help/compatibility. [26]

## Rendering and quirks

- All fetched pages report needsRender false and no failures occurred, so plain HTTP fetches are enough. [1] [4]
- The pages repeat a large navigation and footer block, so the model-specific content comes late in the text. [1] [20]
- The report found no JSON-LD types on any page. [1]

## Links to other sites

- Every page links to resoundpro.com, the professional site. The sitemap also lists pro.resound.com pages. [4] [6]
- The pages link to gn.com, resoundchina.com, jabra.dk, gnresoundblog.com, va.gov, and social networks. The en-us home page also links to resoundhearsay.com. [4]
- The Danish locale links to shop.resoundpatientsupport.com. [10]
- The English international Auracast page links to gnhearing.com. [27]
- The en-us Assist page lists one PDF on resound.com under /-/media/resound/resound-us/downloads/guides/. The report also lists PDFs on cdn1-originals.webdamdb.com and links to gngroup.webdamdb.com. [28]
- The report recorded no redirects. [4]

## Web Archive

- The Web Archive has copies of /en-us from 2018 to 2026 (latest 20261109231147), and of the en-us catalog page from 2019 to 2026 (latest 20260809080829). [29] [1]

## What the next agent should check

- Check that the catalog page links all models in the sitemap, including slugs without the resound- prefix (enzo-q, enzo-3d, enzo2), because the current modelUrlPattern requires resound-. [3] [6]
- Crawl the /en-us/help/hearing-aids/{slug} pages for document links, and check the PDF URL format since the report lists only one PDF on resound.com. [2] [28]
- Check whether the Canadian en-ca and international en catalogs list models that en-us lacks. [30] [8]

[1]: https://www.resound.com/en-us/hearing-aids/resound-hearing-aids (fetched 2026-11-27T18:59:45.015Z)
[2]: https://www.resound.com/en-us/help/hearing-aids/key (fetched 2026-11-27T18:59:24.441Z)
[3]: https://www.resound.com/en-us/hearing-aids/resound-hearing-aids/enzo-q (fetched 2026-11-27T18:59:37.103Z)
[4]: https://www.resound.com/en-us/ (fetched 2026-11-27T17:43:27.349Z)
[5]: https://www.resound.com/robots.txt (fetched 2026-11-27T18:59:20.527Z)
[6]: https://www.resound.com/en-us/xmlsitemap (fetched 2026-11-27T17:42:08.109Z)
[7]: https://www.resound.com/en/sitemapindex (fetched 2026-11-27T17:40:40.257Z)
[8]: https://www.resound.com/en-ca/ (fetched 2026-11-27T17:43:20.899Z)
[9]: https://www.resound.com/en/ (fetched 2026-11-27T17:43:15.912Z)
[10]: https://www.resound.com/da/ (fetched 2026-11-27T17:43:24.253Z)
[11]: https://www.resound.com/en-us/help/hearing-aids/enzo-ia (fetched 2026-11-27T18:59:28.253Z)
[12]: https://www.resound.com/en-us/help/accessories/multi-mic (fetched 2026-11-27T19:00:12.186Z)
[13]: https://www.resound.com/en-us/help/apps/smart-3d (fetched 2026-11-27T19:00:15.308Z)
[14]: https://www.resound.com/en-us/hearing-aids/resound-hearing-aids/resound-sensia (fetched 2026-11-27T17:45:41.977Z)
[15]: https://www.resound.com/en-us/hearing-aids/resound-hearing-aids/resound-vivia (fetched 2026-11-27T17:45:44.776Z)
[16]: https://www.resound.com/en-us/hearing-aids/resound-hearing-aids/resound-nexia (fetched 2026-11-27T17:45:47.952Z)
[17]: https://www.resound.com/en-us/hearing-aids/resound-hearing-aids/resound-enzo-ia (fetched 2026-11-27T17:45:50.950Z)
[18]: https://www.resound.com/en-us/hearing-aids/resound-hearing-aids/resound-savi (fetched 2026-11-27T17:46:20.628Z)
[19]: https://www.resound.com/en-us/hearing-aids/resound-hearing-aids/resound-key (fetched 2026-11-27T17:46:25.968Z)
[20]: https://www.resound.com/en-us/help/hearing-aids (fetched 2026-11-27T17:47:20.805Z)
[21]: https://www.resound.com/en-us/help/hearing-aids/enzo-q (fetched 2026-11-27T19:00:08.048Z)
[22]: https://www.resound.com/en-us/help/accessories (fetched 2026-11-27T18:59:33.687Z)
[23]: https://www.resound.com/en-us/help/apps (fetched 2026-11-27T17:47:24.692Z)
[24]: https://www.resound.com/en-us/hearing-aids/apps (fetched 2026-11-27T17:45:37.328Z)
[25]: https://www.resound.com/en-us/hearing-loss/tinnitus/types (fetched 2026-11-27T17:47:09.545Z)
[26]: https://www.resound.com/en-us/help/compatibility (fetched 2026-11-27T19:00:17.850Z)
[27]: https://www.resound.com/en/hearing-aids/auracast-hearing-aids (fetched 2026-11-27T17:47:38.974Z)
[28]: https://www.resound.com/en-us/hearing-aids/assist (fetched 2026-11-27T17:44:27.803Z)
[29]: https://www.resound.com/en-us/ (fetched 2026-11-27T17:43:10.586Z)
[30]: https://www.resound.com/en/hearing-aids/resound-hearing-aids (fetched 2026-11-27T17:47:35.885Z)
