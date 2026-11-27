// Which units of work a run has finished, so that a stopped run can go on where it stopped.
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { deleteJson, writeJson } from '@/src/lib/data/write'

const Saved = z.strictObject({ done: z.array(z.string()) })

export class Progress {
  private constructor(
    private readonly file: string,
    private readonly finished: Set<string>,
  ) {}

  /** With `resume`, the units saved by the last run; otherwise none, and the old record is cleared. */
  static async open(file: string, resume: boolean): Promise<Progress> {
    if (!resume) {
      await deleteJson(file)
      return new Progress(file, new Set())
    }
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Progress(file, new Set())
      throw error
    }
    return new Progress(file, new Set(Saved.parse(JSON.parse(text)).done))
  }

  has(key: string): boolean {
    return this.finished.has(key)
  }

  /** Records the unit at once: the next one may be where the run stops. */
  async done(key: string): Promise<void> {
    this.finished.add(key)
    await writeJson(this.file, { done: [...this.finished] })
  }

  /** Takes a unit back: a later run does it again. Nothing is written when it was not recorded. */
  async forget(key: string): Promise<void> {
    if (this.finished.delete(key)) await writeJson(this.file, { done: [...this.finished] })
  }

  /** The run is complete: a later `--resume` starts from the beginning. */
  async clear(): Promise<void> {
    await deleteJson(this.file)
  }
}
