import type { FormFactor } from '@/src/lib/schema/model'

// Schematic outlines, not drawings of any product: behind-the-ear body and wire, in-ear shells, earbud.
const behindTheEar = (
  <>
    <path d="M62 26c14 6 18 28 10 46-4 10-14 12-18 6-3-5 2-10 4-18 3-11 0-22-6-28-3-5 4-9 10-6Z" />
    <path d="M52 28c-10-8-26-4-26 12v22" fill="none" />
  </>
)
const shell = (radius: number) => (
  <>
    <circle cx="50" cy="52" r={radius} />
    <circle cx="50" cy="52" r={radius / 3} fill="none" />
  </>
)

const SHAPES: Record<FormFactor, React.ReactNode> = {
  RIC: (
    <>
      {behindTheEar}
      <circle cx="26" cy="68" r="7" />
    </>
  ),
  BTE: (
    <>
      {behindTheEar}
      <path d="M20 62h12l-2 14h-8Z" />
    </>
  ),
  ITE: shell(30),
  ITC: shell(23),
  CIC: shell(17),
  IIC: shell(12),
  earbud: (
    <>
      <circle cx="46" cy="38" r="18" />
      <rect x="52" y="44" width="12" height="38" rx="6" />
    </>
  ),
}

/** Stands in for a photo we have no licence to show. */
export function FormFactorIcon({ formFactor = 'RIC' }: { formFactor?: FormFactor }) {
  return (
    <svg
      className="form-icon"
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${formFactor} hearing aid style`}
      fill="#d8e2ec"
      stroke="#17222e"
      strokeWidth="2.5"
    >
      {SHAPES[formFactor]}
    </svg>
  )
}
