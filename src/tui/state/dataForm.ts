import { MANAGED_FIELDS } from '../../core/coerce.js'
import type { CollectionMeta, Doc } from '../../core/localApi.js'

export interface DataRow {
  name: string
  type: string
  /** Text shown and edited; JSON for complex types. */
  value: string
  readOnly: boolean
  note?: string
}

const HIDDEN = new Set(['tenant'])
const SKIPPED_TYPES = new Set(['join', 'ui'])
const JSON_TYPES = new Set(['json', 'array', 'group', 'blocks', 'point'])

function show(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Editable rows for a document of `meta` (or a blank one): scalars as text, complex types as JSON. */
export function dataForm(meta: CollectionMeta, doc?: Doc): DataRow[] {
  return meta.fields
    .filter((f): f is typeof f & { name: string } => Boolean(f.name) && !HIDDEN.has(f.name!) && !MANAGED_FIELDS.has(f.name!) && !SKIPPED_TYPES.has(f.type))
    .map((f) => {
      if (f.type === 'richText') {
        return {
          name: f.name,
          type: f.type,
          value: doc?.[f.name] ? '(rich text)' : '',
          readOnly: true,
          note: 'rich text: edit in the admin',
        }
      }
      return {
        name: f.name,
        type: f.type,
        value: show(doc?.[f.name]),
        readOnly: false,
        note: JSON_TYPES.has(f.type) ? 'JSON' : undefined,
      }
    })
}

/** `key=value` pairs (for `coerceSet`) of the editable rows that differ from `original`. */
export function changedPairs(rows: DataRow[], original: DataRow[]): string[] {
  const before = new Map(original.map((r) => [r.name, r.value]))
  return rows
    .filter((r) => !r.readOnly && r.value !== (before.get(r.name) ?? ''))
    .map((r) => `${r.name}=${r.value}`)
}
