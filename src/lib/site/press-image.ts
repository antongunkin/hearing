// Server only. A product photo is shown only under the brand's press-kit licence.
import { readdir } from 'node:fs/promises'
import type { Brand } from '@/src/lib/schema/brand'

const IMAGE = /\.(?:avif|jpe?g|png|webp)$/

/** The URL of `<slug>.<ext>` in `dir` (served at `/images`), or undefined when it must not or cannot be shown. */
export async function pressImage(slug: string, brand: Brand, dir = 'public/images'): Promise<string | undefined> {
  if (brand.imageLicense !== 'press-kit-editorial') return undefined
  let names: string[]
  try {
    names = await readdir(/*turbopackIgnore: true*/ dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const name = names.sort().find((file) => IMAGE.test(file) && file.replace(IMAGE, '') === slug)
  return name && `/images/${name}`
}
