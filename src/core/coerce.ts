import { CliError } from './errors.js'
import type { CollectionMeta, FieldMeta } from './localApi.js'

const BUILT_IN_KEYS = new Set(['id', 'createdAt', 'updatedAt', '_status'])
const JSON_TYPES = new Set(['json', 'array', 'group', 'blocks', 'point'])

const asId = (v: string): string | number => (/^\d+$/.test(v) ? Number(v) : v)
const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean)

function coerceValue(slug: string, f: FieldMeta, value: string): unknown {
  const name = f.name!
  switch (f.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'code':
      return value

    case 'number': {
      const parse = (s: string) => {
        const n = Number(s)
        if (s.trim() === '' || !Number.isFinite(n)) throw new CliError(`Field "${name}" must be a number, got "${s}".`)
        return n
      }
      return f.hasMany ? list(value).map(parse) : parse(value)
    }

    case 'checkbox':
      if (value !== 'true' && value !== 'false') throw new CliError(`Field "${name}" must be true or false, got "${value}".`)
      return value === 'true'

    case 'date':
      if (Number.isNaN(Date.parse(value))) throw new CliError(`Field "${name}" is not a valid date: "${value}".`)
      return value

    case 'select':
    case 'radio': {
      const values = f.hasMany ? list(value) : [value]
      const options = f.options ?? []
      for (const v of values) {
        if (options.length && !options.includes(v)) {
          throw new CliError(`Field "${name}" must be one of: ${options.join(', ')}.`)
        }
      }
      return f.hasMany ? values : values[0]
    }

    case 'relationship':
    case 'upload':
      return f.hasMany ? list(value).map(asId) : asId(value)

    case 'richText':
      throw new CliError(
        `Field "${name}" is rich text and cannot be set with --set; put it in a --json file or edit it in the admin.`,
      )

    default:
      if (JSON_TYPES.has(f.type)) {
        try {
          return JSON.parse(value)
        } catch {
          throw new CliError(`Field "${name}" must be valid JSON.`)
        }
      }
      throw new CliError(`Field "${name}" (${f.type}) cannot be set from the command line in "${slug}".`)
  }
}

/** `["count=3","title=a=b"]` → `{ count: 3, title: "a=b" }`, coerced by the collection's field types. */
export function coerceSet(meta: CollectionMeta, pairs: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq < 1) throw new CliError(`"${pair}" must be written key=value.`)
    const key = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1)

    if (key === 'tenant') throw new CliError('Set the tenant with --tenant, not --set.')
    const field = meta.fields.find((f) => f.name === key)
    if (!field) {
      const names = meta.fields.map((f) => f.name).filter(Boolean).join(', ')
      throw new CliError(`Unknown field "${key}" in "${meta.slug}". Fields: ${names}.`)
    }
    out[key] = coerceValue(meta.slug, field, value)
  }
  return out
}

/** Throws CliError for keys of a --json object that are not fields of the collection. */
export function checkKnownKeys(meta: CollectionMeta, data: Record<string, unknown>): void {
  const known = new Set([...meta.fields.map((f) => f.name), ...BUILT_IN_KEYS])
  for (const key of Object.keys(data)) {
    if (key === 'tenant') throw new CliError('Set the tenant with --tenant, not in the JSON.')
    if (!known.has(key)) {
      const names = meta.fields.map((f) => f.name).filter(Boolean).join(', ')
      throw new CliError(`Unknown field "${key}" in "${meta.slug}". Fields: ${names}.`)
    }
  }
}
