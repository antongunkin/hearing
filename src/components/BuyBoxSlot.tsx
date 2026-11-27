import type { ModelType } from '@/src/lib/schema/model'

/** Space kept for "where to buy". Prescription aids are sold through professionals, so they have none. */
export function BuyBoxSlot({ type }: { type: ModelType }) {
  return type === 'rx' ? null : <div className="buy-box" aria-hidden="true" />
}
