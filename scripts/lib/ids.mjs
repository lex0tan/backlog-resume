// The one definition of an item ID: a prefix of project/workstream words and a number of at least three digits (`SHOP-API-001`, `X-1000`).

const BODY = String.raw`[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3,}`

/** A whole string that is an item ID. */
export const ITEM_ID = new RegExp(`^${BODY}$`)

/** Item IDs inside free text, optionally qualified as `project:ID`. Global: use with `replace`/`matchAll`. */
export const ITEM_ID_TOKEN = new RegExp(String.raw`(?:[A-Za-z0-9._-]+:)?\b${BODY}\b`, 'g')
