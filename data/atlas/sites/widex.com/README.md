# widex.com

Widex's official multi-locale site (WS Audiology A/S); the en-us catalog at /en-us/hearing-aids/ lists Allure (AI RIC, RIC, BTE, ITE), SmartRIC and Moment Sheer, and the report flags it as needing render while the page text shows the model list. [1] [2]

## What this site is and whose

- Widex consumer website, with one section per locale; the footer reads © 2026, WS Audiology A/S. [1]
- The start page is the US site (en-us), titled 'Official Widex US website'. [2]
- There is a Widex global site at /en/. [3]
- The footer links 'For Professionals'; the report shows this goes to widexpro.com. [2]

## Structure

- robots.txt lists per-locale sitemaps (sitemap-<locale>.xml) and per-locale shops-sitemap pages. The report fetched 19 of them and counted 2910 URLs. [4] [5]
- en-us has 187 sitemap URLs; the largest sections are en-nz (232), en-au (209), en-gb (203) and en-ca (202). [5]
- US catalog URLs are /en-us/hearing-aids/allure/<slug>/ with slugs ai-ric-r-d, ric-r-d, bte-r-d and ite-r-d, plus /en-us/hearing-aids/smartric/. [6] [7] [8] [9] [10]
- Other locales use different path words: da-dk uses /hoereapparater/, de-de uses /hoergeraete/, es uses /audifonos/, and cs-cz uses /sluchadla/. [11] [12] [13] [14]
- The en-us templates include /support/{slug}, /service/{slug}, /blog/global/{slug}, /blog/local/us/{slug}, /campaign/us/{slug}, /local/us/{slug} and /tinnitus/relief/{slug}. [15]
- Some sitemap URLs expose Sitecore staging paths such as /en-us/sitecore/content/widex/widex-staging/home/hearing-aids/…. robots.txt disallows /sitecore/. [4]

## Catalog, support, documents and apps

- The US catalog page /en-us/hearing-aids/ lists Allure AI RIC R D, Allure RIC R D, Allure BTE R D, Allure ITE R D, SmartRIC and Moment Sheer. The /en/ global page lists the same six. [1] [16]
- The Moment Sheer link is on the catalog listing, but no model page URL for it appears in the report. [1]
- The Allure family overview is at /en-us/hearing-aids/allure/. [17]
- US support pages: /en-us/support/, /support/compatibility/, /support/accessories/, /support/app/ and /support/support-for-moment-hearing-aids/. [18] [19] [15] [20] [21]
- The US document library page does not host files. It points to www.wsaud.com/widex for user guides, datasheets, safety documents and declarations of conformity. [22]
- The US accessories support page also names a 'Document portal' for PDFs. [15]
- Apps: the US pages /en-us/hearing-aids/apps/ and /en-us/hearing-aids/apps/allure-app/ describe the Allure app. The support page covers the Allure and Moment apps, and the report lists evoke-app and moment-app templates. [23] [20] [24]
- Store links to the Widex Zen tinnitus app (iOS id 1195907597, Android com.widex.tinnitus) appear on the de-ch tinnitus page. [25]

## Rendering and quirks

- The report marks /en-us/hearing-aids/, /ar/hearing-aids/, /ar/hearing-aids/apps/, /de-de/service-und-support/ and /de-ch/support/ as needsRender. The captured text of /en-us/hearing-aids/ already lists the models, and the report gives no sign that the catalog needs scripts to show them. [1] [26] [27] [28] [29]
- The model pages, the US home and the global catalog page /en/hearing-aids/ are marked needsRender false. [6] [2] [16]
- Pages carry a location-picker overlay ('Welcome to Widex … select one of the websites below'). It lists more regions than the sitemaps cover, such as Russia. [16]
- The support contact form is protected by reCAPTCHA. [18]

## Links to other sites

- Outbound links: widexpro.com (professionals), wsa.com (corporate and careers), social networks, widexbutik.dk (Danish shop) and shop.widex.cz (Czech shop). [30] [14] [2]
- The US document library points to www.wsaud.com/widex. [22]
- The report shows PDFs on azurecdn.widex.com. They are a UK modern slavery statement, an ebooklet and a Moment connectivity guide, and none is a model datasheet. [21] [31] [32]
- The Moment support page links an issuu.com connectivity document. [21]
- The report records no redirects. [2]

## Web Archive

- Web Archive has copies of /en-us (2018–2026, latest 20261115060636), plus en-nz, en-au, en-gb, en-ca and en-in (2021–2026). [33]

## What the next agent should check

- Check why the report marks /en-us/hearing-aids/ needsRender true although its text lists the models. [1]
- Check for a Moment Sheer model page and whether it fits the model pattern. [1]
- Widen the model pattern to the Allure RIC, BTE and ITE slugs. The current pattern allure/[a-z0-9-]+ already covers them. [9]
- Check the wsaud.com/widex portal for user guides and datasheets. [22]

[1]: https://www.widex.com/en-us/hearing-aids/ (fetched 2026-11-27T22:32:00.006Z)
[2]: https://www.widex.com/en-us/ (fetched 2026-11-27T22:31:24.991Z)
[3]: https://www.widex.com/en/ (fetched 2026-11-27T22:30:51.861Z)
[4]: https://www.widex.com/robots.txt (fetched 2026-11-27T22:39:57.217Z)
[5]: https://www.widex.com/sitemap-en-us.xml (fetched 2026-11-27T22:29:37.288Z)
[6]: https://www.widex.com/en-us/hearing-aids/allure/ai-ric-r-d/ (fetched 2026-11-27T22:31:46.405Z)
[7]: https://www.widex.com/en-us/hearing-aids/allure/bte-r-d/ (fetched 2026-11-27T19:43:44.427Z)
[8]: https://www.widex.com/en-us/hearing-aids/allure/ite-r-d/ (fetched 2026-11-27T19:43:55.763Z)
[9]: https://www.widex.com/en-us/hearing-aids/allure/ric-r-d/ (fetched 2026-11-27T19:43:31.072Z)
[10]: https://www.widex.com/en-us/hearing-aids/smartric/ (fetched 2026-11-27T19:44:06.094Z)
[11]: https://www.widex.com/da-dk/hoereapparater/ (fetched 2026-11-27T22:33:00.147Z)
[12]: https://www.widex.com/de-de/hoergeraete/apps/ (fetched 2026-11-27T22:33:30.368Z)
[13]: https://www.widex.com/es/ (fetched 2026-11-27T22:31:32.083Z)
[14]: https://www.widex.com/cs-cz/ (fetched 2026-11-27T22:30:33.928Z)
[15]: https://www.widex.com/en-us/support/accessories/ (fetched 2026-11-27T22:40:03.708Z)
[16]: https://www.widex.com/en/hearing-aids/ (fetched 2026-11-27T22:34:36.342Z)
[17]: https://www.widex.com/en-us/hearing-aids/allure/ (fetched 2026-11-27T22:31:50.866Z)
[18]: https://www.widex.com/en-us/support/ (fetched 2026-11-27T22:40:36.247Z)
[19]: https://www.widex.com/en-us/support/compatibility/ (fetched 2026-11-27T22:40:01.047Z)
[20]: https://www.widex.com/en-us/support/app/ (fetched 2026-11-27T22:40:07.247Z)
[21]: https://www.widex.com/en-us/support/support-for-moment-hearing-aids/ (fetched 2026-11-27T22:32:24.187Z)
[22]: https://www.widex.com/en-us/support/document-library/ (fetched 2026-11-27T22:40:40.768Z)
[23]: https://www.widex.com/en-us/hearing-aids/apps/allure-app/ (fetched 2026-11-27T22:40:12.067Z)
[24]: https://www.widex.com/en-us/hearing-aids/apps/ (fetched 2026-11-27T22:32:08.847Z)
[25]: https://www.widex.com/de-ch/hearing-loss/tinnitus/ (fetched 2026-11-27T22:34:17.005Z)
[26]: https://www.widex.com/ar/hearing-aids/ (fetched 2026-11-27T22:32:37.907Z)
[27]: https://www.widex.com/ar/hearing-aids/apps/ (fetched 2026-11-27T22:32:44.712Z)
[28]: https://www.widex.com/de-de/service-und-support/ (fetched 2026-11-27T22:33:35.778Z)
[29]: https://www.widex.com/de-ch/support/ (fetched 2026-11-27T22:34:20.363Z)
[30]: https://www.widex.com/da-dk/ (fetched 2026-11-27T22:30:37.206Z)
[31]: https://www.widex.com/en-us/hearing-loss/ (fetched 2026-11-27T22:32:14.788Z)
[32]: https://www.widex.com/en-gb/ (fetched 2026-11-27T22:31:06.068Z)
[33]: https://www.widex.com/en-us/ (fetched 2026-11-27T22:30:26.027Z)
