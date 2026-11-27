/** Space kept for a display ad, so that one arriving later moves nothing. Empty until ads are on. */
export function AdSlot({ id, minHeight }: { id: string; minHeight: number }) {
  return <div className="ad-slot" data-ad-slot={id} style={{ height: minHeight }} aria-hidden="true" />
}
