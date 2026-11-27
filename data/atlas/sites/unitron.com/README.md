# unitron.com

Unitron's US English site (www.unitron.com/en-us), a Sonova brand, is server-rendered. Its catalog is /en-us/hearing-solutions/hearing-aids, and datasheets and user guides are PDFs on the same host. [1] [2]

## What this site is and whose

- Official Unitron brand site, US English locale; footer says 'A Sonova brand'. [1]
- Sells and presents hearing aids on the Smile, Vivante and Blu platforms (plus Ativo datasheets); consumers are sent to find a provider, with a separate professionals section. [3] [4]

## Structure

- Main sections: /en-us/hearing-health, /hearing-solutions, /support, /professionals, plus find-a-provider, contact-us, myunitron, global-locations and press-room. [1]
- Model pages follow /en-us/hearing-solutions/hearing-aids/{slug}; the report found moxi-s-rx, insera-s-r and product-comparison (not a model page). [5] [6] [7]
- Platform pages at /en-us/professionals/hearing-technology-platforms/{smile,vivante,blu}. [4] [8] [9]
- robots.txt lists about 60 per-locale sitemaps (e.g. /us/en_us/sitemap.xml). Every sitemap in the failure list returned HTTP 404, and none returned URLs (urlCount 0). [10]
- The sitemap refs all point to https://intl.unitron.com/ rather than XML sitemaps. [11]
- robots.txt allows everything for all user agents (no disallow rules). [10]

## Catalog, support, documents and apps

- Catalog: /en-us/hearing-solutions/hearing-aids. The product-comparison page lists the full range: Insera S-R, S-10 NW O, B-312 and B-312 NW O; Moxi S-RX, S-R, V-312, V-R and V-RT; Stride V-M, V-PR, V-SP and V-UP. [2] [7]
- Datasheets (PDF) are listed on /en-us/professionals/hearing-aid-resources, covering Moxi S-RX, S-R, V, B, Stride V and B, Insera B and S, and Ativo. They sit under /content/dam/.../*.pdf.coredownload.pdf. [3]
- User guides: /en-us/support/user-guides, with subpages blu, app and accessories. The blu page lists guides per Blu model; the user-guides hub also lists Smile, Vivante and Tempus categories. [12] [13] [14] [15]
- App user guides (Remote Plus 5.5 in many languages, Hearing Remote 5.5) are PDFs on /en-us/support/user-guides/app. [14]
- Remote Plus app: iOS id 1256680977, Android com.sonova.unitron.rcapp; page /en-us/hearing-solutions/remote-plus-app. [16] [17]
- Other PDFs: the Easy Line Pro user guide, the TrueFit fitting guide and Remote Adjust guide, and a TakeAlong flyer. [18] [19] [1]
- How-to videos for each model are at /en-us/support/hearing-aid-use-and-maintenance/how-to-videos/{slug}. [20]

## Rendering and quirks

- Catalog, model, support and user-guide pages are not flagged as needing rendering; they show their content in the fetched text. [2] [5] [12]
- Pages flagged needsRender: learning center, professional learning center, contact-us, myunitron, the accessories user-guide page, and many how-to-video pages. [21] [22] [23] [24] [15] [20]
- The PDF link lists in the report are very long. The datasheet and guide pages show 'View / Share / Copy' buttons, and the PDF URLs only appear in the report's pdfs lists. [3]
- The report crawled an internal duplicate path /content/unitron/language-masters/en/hearing-solutions/accessories. [25]

## Links to other sites

- Links to Sonova (sonova.com), Hear the World, and social networks. The footer says 'A Sonova brand'. [1]
- Login and ordering portals: b2b.myunitron.com (provider sign-in) and eservices.myunitron.com. [1] [24]
- Other regional sites: unitron.cn and unitron.co.kr, linked from Global Locations. Unitron also has many locale paths under unitron.com (e.g. /da-dk, /de-at). [26]
- No redirects were recorded. All PDFs are hosted on www.unitron.com. [1]

## Web Archive

- Web Archive has 21 captures of the en-us home in 2026 (latest 20261109231148) and 4 of the hearing-aids catalog (latest 20260617000736). [1] [2]

## What the next agent should check

- Fetch the catalog page and confirm which model links it carries. Only moxi-s-rx and insera-s-r were crawled as model pages, though the product-comparison page lists about 15 models. [2] [7]
- Check whether older models (Moxi V, Stride, Insera B) still have pages under /hearing-aids/{slug}. Their datasheets and guides still exist. [3] [13]
- Collect PDFs from the hearing-aid-resources and user-guides subpages, including the Smile, Vivante and Tempus categories not crawled. [12] [3]

[1]: https://www.unitron.com/en-us (fetched 2026-11-27T18:10:34.594Z)
[2]: https://www.unitron.com/en-us/hearing-solutions/hearing-aids (fetched 2026-11-27T18:10:53.172Z)
[3]: https://www.unitron.com/en-us/professionals/hearing-aid-resources (fetched 2026-11-27T18:11:25.323Z)
[4]: https://www.unitron.com/en-us/professionals/hearing-technology-platforms/smile (fetched 2026-11-27T18:11:44.389Z)
[5]: https://www.unitron.com/en-us/hearing-solutions/hearing-aids/moxi-s-rx (fetched 2026-11-27T18:11:38.280Z)
[6]: https://www.unitron.com/en-us/hearing-solutions/hearing-aids/insera-s-r (fetched 2026-11-27T18:11:42.053Z)
[7]: https://www.unitron.com/en-us/hearing-solutions/hearing-aids/product-comparison (fetched 2026-11-27T18:13:13.550Z)
[8]: https://www.unitron.com/en-us/professionals/hearing-technology-platforms/blu (fetched 2026-11-27T19:07:00.521Z)
[9]: https://www.unitron.com/en-us/professionals/hearing-technology-platforms/vivante (fetched 2026-11-27T19:06:56.417Z)
[10]: https://www.unitron.com/robots.txt (fetched 2026-11-27T19:06:48.052Z)
[11]: https://intl.unitron.com/ (fetched 2026-11-27T18:10:21.545Z)
[12]: https://www.unitron.com/en-us/support/user-guides (fetched 2026-11-27T18:11:19.073Z)
[13]: https://www.unitron.com/en-us/support/user-guides/blu (fetched 2026-11-27T19:06:52.560Z)
[14]: https://www.unitron.com/en-us/support/user-guides/app (fetched 2026-11-27T18:13:19.443Z)
[15]: https://www.unitron.com/en-us/support/user-guides/accessories (fetched 2026-11-27T18:13:37.972Z)
[16]: https://www.unitron.com/en-us/hearing-solutions/remote-plus-app (fetched 2026-11-27T18:10:55.438Z)
[17]: https://www.unitron.com/en-us/support (fetched 2026-11-27T18:11:02.215Z)
[18]: https://www.unitron.com/en-us/professionals/easy-line-pro (fetched 2026-11-27T18:12:12.921Z)
[19]: https://www.unitron.com/en-us/professionals/fitting-software (fetched 2026-11-27T18:12:19.483Z)
[20]: https://www.unitron.com/en-us/support/hearing-aid-use-and-maintenance/how-to-videos/moxi-s-r (fetched 2026-11-27T18:13:42.273Z)
[21]: https://www.unitron.com/en-us/hearing-health/unitron-learning-center (fetched 2026-11-27T18:10:43.667Z)
[22]: https://www.unitron.com/en-us/professionals/professional-learning-center (fetched 2026-11-27T18:12:06.651Z)
[23]: https://www.unitron.com/en-us/contact-us (fetched 2026-11-27T18:12:23.841Z)
[24]: https://www.unitron.com/en-us/myunitron (fetched 2026-11-27T18:12:29.410Z)
[25]: https://www.unitron.com/content/unitron/language-masters/en/hearing-solutions/accessories (fetched 2026-11-27T18:13:33.963Z)
[26]: https://www.unitron.com/en-us/global-locations (fetched 2026-11-27T18:12:43.235Z)
