// Which model pages search engines may index. Client-safe: types only from the schemas.
import type { Model } from '@/src/lib/schema/model'
import { specRows } from './spec-rows'

/** A discontinued model's page is indexed only with 3 or more sourced specification rows, or a document. */
export function isIndexable(model: Model): boolean {
  return model.discontinued === undefined || specRows([model]).length >= 3 || model.documents.length >= 1
}
