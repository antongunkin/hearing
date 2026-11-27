// Apart from the Zod schemas so that browser code can use it without them.

/** What a slug or id looks like: lowercase ASCII words joined by hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
