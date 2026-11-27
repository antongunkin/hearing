export const config = {
  minDelayMs: 2000,
  maxDelayMs: 5000,
  /**
   * Requests to a Web Archive host are at least this far apart. The atlas spec asks for at least 4000;
   * 10000 (6 a minute) leaves a margin.
   * Read 2026-11-27: archive.org publishes no numeric limit for Wayback/CDX requests. Checked
   * https://archive.org/developers/wayback-cdx-server.html (404) and
   * https://blog.archive.org/2026/09/15/an-update-on-wayback-machine-access/ (HTTP 429 means too many
   * requests; no figure). The only figure found is second-hand: the `wayback` Python package's release notes
   * (v0.5.1, https://wayback.readthedocs.io/en/latest/release-history.html) say the server's hard limit is
   * about 24 requests a minute, i.e. one per 2.5 s; 10000 ms stays well under it.
   * 2026-11-27: raised to 10 s after repeated ECONNREFUSED from web.archive.org at 5 s.
   */
  archiveDelayMs: 10000,
  /** Hosts whose pages are old copies of someone else's site. */
  archiveHosts: ['web.archive.org'],
  eventsSince: '2023-11-01',
  /** A model counts as on sale when it was sold on or after this date. */
  onSaleSince: '2018-01-01',
  /** Limits of one site-atlas run. */
  atlas: { pageBudget: 60, sitemapBudget: 20, cdxSections: 6, maxReportUrls: 3000, keyPages: 8, moreUrls: 10, moreRounds: 2 },
  /** An official price that moves by more than this share is reviewed, not applied: it may be a sale or a misread. */
  maxAutoPriceChange: 0.25,
  /** Complaint themes are proposed only from at least this many reviews of the model. */
  minThemeReviews: 20,
  // FDA Product Classification (21 CFR 874, panel "Ear, Nose, Throat"), read 2026-11-26 from
  // https://api.fda.gov/device/classification.json, the API of
  // https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfPCD/classification.cfm
  // Air-conduction hearing aids: ESD, LRB (face plate), QUF (874.3300), OSM, QUG (874.3305, wireless),
  // QDD, QUH (874.3325, self-fitting), SCR (874.3335, software). KLW (874.3400): tinnitus masker.
  // Left out: bone-conduction and middle-ear implants, test equipment, ear protectors, training aids.
  fdaProductCodes: ['ESD', 'LRB', 'QUF', 'OSM', 'QUG', 'QDD', 'QUH', 'SCR', 'KLW'],
  openFdaUrl: 'https://api.fda.gov/device',
  itunesLookupUrl: 'https://itunes.apple.com/lookup',
  youtubeApiUrl: 'https://www.googleapis.com/youtube/v3',
  llm: {
    claudeModel: 'haiku',
    describeModel: 'sonnet',
    ollamaModel: 'qwen3:8b',
    ollamaUrl: 'http://localhost:11434',
    // Ollama's default context is small and silently truncates long pages.
    ollamaNumCtx: 16384,
    /** Deadline for one call to each provider. */
    timeoutMs: { claude: 300_000, ollama: 600_000, gemini: 300_000 },
    // Newest model named "Flash" with a free tier and video input, checked 2026-11-26:
    // https://ai.google.dev/gemini-api/docs/models (pricing: /docs/pricing, YouTube URLs: /docs/video-understanding#youtube)
    geminiModel: 'gemini-3.8-flash',
  },
}
