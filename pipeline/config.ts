export const config = {
  /** A getter, so the site URL is read after `.env.local` has been loaded. No personal contacts here. */
  get userAgent() {
    const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
    // A bot that cannot say where to read about it does not go out at all.
    if (!site) throw new Error('NEXT_PUBLIC_SITE_URL is not set (see .env.example): the User-Agent needs it')
    return `HearingDBBot/0.1 (+${site}/about-bot)`
  },
  minDelayMs: 2000,
  maxDelayMs: 5000,
  releasedAfter: '2023-11-01',
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
