// Which lookups of a discontinued model are done: they run once, and again only with `--refresh`. The ledger
// lives under `.cache/` (never in git) and is written at once on each mark, so a stopped run keeps its marks.
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { writeJson } from '@/src/lib/data/write'

const Saved = z.strictObject({ done: z.array(z.string()) })

export class OnceLedger {
  private constructor(
    private readonly file: string,
    private readonly done: Set<string>,
  ) {}

  static async open(file: string): Promise<OnceLedger> {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new OnceLedger(file, new Set())
      throw error
    }
    return new OnceLedger(file, new Set(Saved.parse(JSON.parse(text)).done))
  }

  has(key: string): boolean {
    return this.done.has(key)
  }

  async mark(key: string): Promise<void> {
    this.done.add(key)
    await writeJson(this.file, { done: [...this.done] })
  }
}
