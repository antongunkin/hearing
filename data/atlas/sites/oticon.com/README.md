# oticon.com

oticon.com is Oticon's live US brand site (Demant group); the catalog is at /products/hearing-aids, with model pages at /products/{n}/{slug}, and documents are on external CDNs (damcdn.demant.com, p3.aprimocdn.net, assets.ha.demant.com). [1] [2] [3]

## What this site is and whose

- Oticon's own consumer and professional site; the US edition (Government Services, tax exemption certificates, US-language documents). [4] [5] [6]
- The home page says Oticon, Reveal, Zeal, Intent, Play SI and Verit are trademarks of Oticon A/S. [4]
- Current families on the home page: Reveal, Zeal, Intent, Jet PX, Play SI, Verit. [4]
- The site is a live brand site with a single brand, oticon. [4]

## Structure

- robots.txt returns 200, allows everything for all agents and lists https://www.oticon.com/sitemap.xml, which has 369 URLs. [7] [8]
- The sitemap's largest sections are /products (111), /support (80), /professionals (68), /inside-oticon (43) and /hearing-loss (23); /products-nhs has 12 URLs. [8]
- Model pages follow /products/{n}/{slug} (73 in the sitemap), for example /products/100051/oticon-opn-bte-plus-power and /products/1069796/oticon-cros-re-minirite-r. [2] [9]
- Family pages follow /products/hearing-aids/family/{slug} (16 in the sitemap). Category pages follow /products/hearing-aids/category/{slug} (5: behind-the-ear, in-the-ear, children-and-teens and others). [10] [11] [12] [13]
- Accessory pages follow /products/accessories/{n}/{slug} and /products-nhs/accessories/{n}/{slug} (12 each, same ids and slugs). [14] [15]
- The catalog still lists discontinued or older families (Opn, Opn S, Opn Play, Xceed Play, Ruby, Siya, More, Zircon) next to current ones. [11] [12]

## Catalog, support, documents and apps

- Catalog: /products/hearing-aids lists models grouped by category and families. The report shows it with 102 internal links and no render needed. [1]
- Category pages list the models with their form factors: behind-the-ear, in-the-ear, children-and-teens. [11] [12] [13]
- Support pages: /support, /support/compatibility-guide, /support/pairing, /support/troubleshooting, /support/oticon-app, /support/care-and-cleaning, /support/batteries-and-charging. [16] [17] [18] [19]
- Model pages have a Product downloads block with Overview and Technical Data entries (for example Oticon CROS RE miniRITE R, English (United States)); the PDF links were not listed in the report for that page. [9] [2]
- /products/app links 7 PDFs on damcdn.demant.com: Companion App instructions for use (IFU) in several versions, a CBR document and a tinnitus SoundSupport information sheet. [3]
- /support/compatibility-guide links 4 PDFs: charger compatibility, phone compatibility list, streaming and accessories overview, and CROS compatibility overview. [17]
- The Reveal family page links 6 PDFs (trifold, sales sheet, consumer brochure, differentiation tool, patient language guide, portfolio diagram). [20]
- The Oticon Companion app is at iOS id 1597064213 and Android com.oticon.app, linked from /products/app and /check-compatibility. [3] [21]

## Rendering and quirks

- The home page, /products/hearing-aids, the family pages (Intent, Reveal, Jet PX, Play SI, Verit, Real, Own, Own SI, Play PX, Xceed) and /products/app are marked as needing no render. [4] [1] [10] [3]
- Marked as needing render: /products, /products/accessories, an accessory page (/products/accessories/728329/easy-le-adapter), /support, /support/compatibility-guide, /support/troubleshooting, /find-hearing-center, /hearing-test, /check-compatibility. /products/accessories shows no items in its text. [22] [23] [14] [16] [17] [19]
- The text of the model pages read here (Opn BTE Plus Power, CROS RE miniRITE R) is cut off at the Product downloads block. [2] [9]
- /support/oticon-app/help-with-the-oticon-app shows only a title and footer in the text, no article list. [24]

## Links to other sites

- Documents are hosted on damcdn.demant.com (17 PDFs), p3.aprimocdn.net (44, mostly state tax exemption forms) and assets.ha.demant.com (1 CROS compatibility PDF). [3] [6] [17]
- /about-us/marketsites links to country sites such as oticon.co.uk, oticon.de, oticon.fr, oticon.ca, oticon.com.au, and medton-hedim.co.il. [25]
- Professionals pages link to myoticon.com, reveal.oticon.global and zeal.oticon.global; /about-us links to demant.com; the footer links to careers-demant.icims.com. [26] [27] [28]
- The report lists no redirects. [4]

## Web Archive

- Web Archive has copies of the home page every year 2018–2026, latest 2026-11-17; /support also from 2018, latest 2026-10-09. [16]
- /products has copies only in 2025 (2) and 2026 (5), latest 2026-08-20; /hearing-loss has copies in 2025 and 2026 only. [22] [29]

## What the next agent should check

- Check that the modelUrlPattern (excluding the cros, jet-px, more, opn, own, play-px, real, ruby, siya, xceed, zircon families) matches the intended current models in the sitemap's /products/{n}/{slug} URLs. [2] [9]
- Check whether model pages (full text) show the Product downloads PDF links, and fetch them with render if the plain fetch lacks them. [9]
- Check whether current Reveal, Zeal, Intent, Verit and Play SI models have /products/{n}/{slug} pages; the family pages show models but the model URLs are not shown in the pages read. [10] [20]
- Check the /products-nhs section and the market sites for other editions of the catalog. [15] [25]

[1]: https://www.oticon.com/products/hearing-aids (fetched 2026-11-27T17:26:39.186Z)
[2]: https://www.oticon.com/products/100051/oticon-opn-bte-plus-power (fetched 2026-11-27T18:54:00.867Z)
[3]: https://www.oticon.com/products/app (fetched 2026-11-27T17:26:46.152Z)
[4]: https://www.oticon.com/ (fetched 2026-11-27T17:25:11.805Z)
[5]: https://www.oticon.com/government-services/for-patients (fetched 2026-11-27T17:28:30.237Z)
[6]: https://www.oticon.com/inside-oticon/tax-exemption-certificates (fetched 2026-11-27T17:28:07.677Z)
[7]: https://www.oticon.com/robots.txt (fetched 2026-11-27T18:53:57.171Z)
[8]: https://www.oticon.com/sitemap.xml (fetched 2026-11-27T17:25:08.747Z)
[9]: https://www.oticon.com/products/1069796/oticon-cros-re-minirite-r (fetched 2026-11-27T18:54:04.075Z)
[10]: https://www.oticon.com/products/hearing-aids/family/intent (fetched 2026-11-27T17:27:15.361Z)
[11]: https://www.oticon.com/products/hearing-aids/category/behind-the-ear (fetched 2026-11-27T18:54:09.119Z)
[12]: https://www.oticon.com/products/hearing-aids/category/in-the-ear (fetched 2026-11-27T18:54:43.254Z)
[13]: https://www.oticon.com/products/hearing-aids/category/children-and-teens (fetched 2026-11-27T18:54:46.963Z)
[14]: https://www.oticon.com/products/accessories/728329/easy-le-adapter (fetched 2026-11-27T17:27:26.470Z)
[15]: https://www.oticon.com/products-nhs/accessories/136477/connectclip (fetched 2026-11-27T17:25:30.179Z)
[16]: https://www.oticon.com/support (fetched 2026-11-27T17:25:32.378Z)
[17]: https://www.oticon.com/support/compatibility-guide (fetched 2026-11-27T17:26:49.451Z)
[18]: https://www.oticon.com/support/pairing (fetched 2026-11-27T17:26:54.004Z)
[19]: https://www.oticon.com/support/troubleshooting (fetched 2026-11-27T17:26:51.828Z)
[20]: https://www.oticon.com/products/hearing-aids/family/reveal (fetched 2026-11-27T17:27:28.747Z)
[21]: https://www.oticon.com/check-compatibility (fetched 2026-11-27T17:25:43.737Z)
[22]: https://www.oticon.com/products (fetched 2026-11-27T17:25:27.954Z)
[23]: https://www.oticon.com/products/accessories (fetched 2026-11-27T17:26:41.682Z)
[24]: https://www.oticon.com/support/oticon-app/help-with-the-oticon-app (fetched 2026-11-27T18:54:16.975Z)
[25]: https://www.oticon.com/about-us/marketsites (fetched 2026-11-27T17:28:25.225Z)
[26]: https://www.oticon.com/professionals (fetched 2026-11-27T17:25:50.994Z)
[27]: https://www.oticon.com/professionals/hearing-solutions/ai (fetched 2026-11-27T17:25:58.993Z)
[28]: https://www.oticon.com/about-us (fetched 2026-11-27T17:25:37.417Z)
[29]: https://www.oticon.com/hearing-loss (fetched 2026-11-27T17:25:20.711Z)
