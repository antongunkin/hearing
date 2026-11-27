# hearingsolutions.philips.com

Live, multi-locale Philips HearLink hearing aid brand site (Demant). The en-us catalog at /en-us/products/hearing-aids is static HTML and lists HearLink 60/50/40/30 models. Manuals are PDFs on damcdn.demant.com. [1] [2]

## What this site is and whose

- Philips Hearing Solutions site for Philips HearLink hearing aids; footer reads © Demant 2026. [3]
- Footer says Philips and the Philips Shield Emblem are registered trademarks of Koninklijke Philips N.V., used under license. [3]
- The home page promotes HearLink 60 as a new premium behind-the-ear aid. [3]
- No prices or online shop in the pages seen; the site points to hearing centers (find-hearing-center, where to buy). [3] [4]

## Structure

- Locale-prefixed site: /{locale}/ with about 40 locales (en-us, es-es, pt-pt, nl-nl, he-il, ...). [3] [5]
- Top-level sections per locale: products, support, hearing-test, hearing-loss, find-hearing-center, about-us. [3]
- Model URL template: /{locale}/products/{id}/{slug}, e.g. /en-us/products/335844/hearlink-30-minirite-t-r. [4]
- Accessory URL template: /{locale}/products/accessories/{id}/{slug}; the accessories list is /en-us/products/accessories. [6]
- Category pages under /products/hearing-aids/category/{bluetooth|rechargeable|discreet}. [7] [8] [9]
- robots.txt allows everything and lists about 42 sitemaps on philips.hearingsolutions.demant.com, one per locale plus a root sitemap.xml. 19 were fetched, giving 1020 URLs. [10]

## Catalog, support, documents and apps

- Catalog (en-us): /en-us/products/hearing-aids lists HearLink 60 miniRITE R; 50 miniRITE, miniBTE R, IIC, CIC; 40 miniRITE T(R), miniBTE T(R); 30 IIC, CIC, ITC, ITE HS, ITE FS, miniRITE T(R), miniBTE T(R/T). [1]
- Category pages repeat the model lists with tags (Rechargeable, Bluetooth, telecoil). [7] [8]
- Model pages have a Product downloads block: Technical Data, Instructions for Use, Professional brochure. [4] [11]
- The HearLink 2 app page lists 9 PDF instructions for use (versions 1.2.0 to 1.8.0 and 2.3.0). [2]
- HearLink 2 app: iOS id 1597063716, Android com.philips.hearlink2. The page states no publisher. [2]
- The es-es compatibility guide links a streaming and accessories compatibility PDF. [12]
- Support pages: pairing, compatibility-guide, care-and-cleaning, batteries-and-charging, warranty, troubleshooting. /en-us/support/download failed to fetch (http-error). [13] [14] [15] [16]

## Rendering and quirks

- The en-us home, catalog, category, model-adjacent app, pairing, compatibility and warranty pages do not need scripts. [3] [1] [14]
- Flagged as needing render: en-us /support, /hearing-test and /find-hearing-center, and some locale homes (he-il, es-ec, es-cl, ko-kr, en-ae). [13] [17] [18] [5]
- The en-us support index page text shows only link titles. Its sub-links are probably rendered by script. [13]
- Model pages are served with text content, including the downloads titles, but the PDF links were not in the extracted pdfs for model pages. [4]

## Links to other sites

- PDFs are hosted on damcdn.demant.com (30 PDFs seen). [2]
- External links: philips.com, facebook, instagram, youtube, apps.apple.com, play.google.com, bluetooth.com (Auracast), costco.com (warehouse locations). [18] [12] [2]
- The report records no redirects. [3]

## Web Archive

- Web Archive fetches of en-us, en-ae, th-th, pt-pt, ro-ro and es-co were excluded (HTTP 403, archive-excluded). The report lists no archive sections. [3]

## What the next agent should check

- Check why the current pattern excludes hearlink-30 models, although the en-us catalog and model pages show them. [1] [4]
- Fetch the en-us model pages and read their PDF links; the report lacks them for models. [11]
- Fetch https://philips.hearingsolutions.demant.com/en-us/sitemap.xml (listed in robots.txt, not fetched) to list all model IDs. [10]
- Retry /en-us/support/download, which failed, and check for HearLink 60 model pages. [3]

[1]: https://www.hearingsolutions.philips.com/en-us/products/hearing-aids (fetched 2026-11-27T17:32:58.826Z)
[2]: https://www.hearingsolutions.philips.com/en-us/products/hearlink-2-app (fetched 2026-11-27T17:33:11.449Z)
[3]: https://www.hearingsolutions.philips.com/en-us (fetched 2026-11-27T17:36:03.261Z)
[4]: https://www.hearingsolutions.philips.com/en-us/products/335844/hearlink-30-minirite-t-r (fetched 2026-11-27T18:56:16.849Z)
[5]: https://www.hearingsolutions.philips.com/he-il (fetched 2026-11-27T17:30:35.491Z)
[6]: https://www.hearingsolutions.philips.com/en-us/products/accessories (fetched 2026-11-27T18:55:45.206Z)
[7]: https://www.hearingsolutions.philips.com/en-us/products/hearing-aids/category/bluetooth (fetched 2026-11-27T17:33:14.510Z)
[8]: https://www.hearingsolutions.philips.com/en-us/products/hearing-aids/category/rechargeable (fetched 2026-11-27T17:33:18.948Z)
[9]: https://www.hearingsolutions.philips.com/en-us/products/hearing-aids/category/discreet (fetched 2026-11-27T17:33:22.647Z)
[10]: https://www.hearingsolutions.philips.com/robots.txt (fetched 2026-11-27T18:55:37.179Z)
[11]: https://www.hearingsolutions.philips.com/en-us/products/454004/hearlink-30-minibte-t (fetched 2026-11-27T18:56:21.955Z)
[12]: https://www.hearingsolutions.philips.com/es-es/support/compatibility-guide (fetched 2026-11-27T17:35:10.229Z)
[13]: https://www.hearingsolutions.philips.com/en-us/support (fetched 2026-11-27T17:33:08.820Z)
[14]: https://www.hearingsolutions.philips.com/en-us/support/pairing (fetched 2026-11-27T17:33:04.096Z)
[15]: https://www.hearingsolutions.philips.com/en-us/support/care-and-cleaning (fetched 2026-11-27T18:56:25.352Z)
[16]: https://www.hearingsolutions.philips.com/en-us/support/batteries-and-charging (fetched 2026-11-27T18:56:30.592Z)
[17]: https://www.hearingsolutions.philips.com/en-us/hearing-test (fetched 2026-11-27T17:33:25.386Z)
[18]: https://www.hearingsolutions.philips.com/en-us/find-hearing-center (fetched 2026-11-27T17:32:53.885Z)
