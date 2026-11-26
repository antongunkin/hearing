export const config = {
  /** A getter, so the site URL is read after `.env.local` has been loaded. No personal contacts here. */
  get userAgent() {
    return `HearingDBBot/0.1 (+${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/about-bot)`
  },
  minDelayMs: 2000,
  maxDelayMs: 5000,
  releasedAfter: '2023-11-01',
  llm: {
    claudeModel: 'haiku',
    ollamaModel: 'qwen3:8b',
    ollamaUrl: 'http://localhost:11434',
    // Newest model named "Flash" with a free tier and video input, checked 2026-11-26:
    // https://ai.google.dev/gemini-api/docs/models (pricing: /docs/pricing, YouTube URLs: /docs/video-understanding#youtube)
    geminiModel: 'gemini-3.8-flash',
  },
}
