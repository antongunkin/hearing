// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

test('a production build on Vercel without NEXT_PUBLIC_SITE_URL fails', async () => {
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
  await expect(import('@/next.config')).rejects.toThrow(/NEXT_PUBLIC_SITE_URL/)
})

test('other builds without it, and production builds with it, pass', async () => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
  for (const env of ['preview', '']) {
    vi.stubEnv('VERCEL_ENV', env)
    vi.resetModules()
    await expect(import('@/next.config')).resolves.toBeDefined()
  }
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://hearing.example')
  vi.resetModules()
  await expect(import('@/next.config')).resolves.toBeDefined()
})
