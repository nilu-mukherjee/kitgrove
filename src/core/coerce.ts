import { CliError } from './errors.js'
import type { CollectionMeta, FieldMeta } from './localApi.js'

const BUILT_IN_KEYS = new Set(['id', 'createdAt', 'updatedAt', '_status'])

/** Written by Payload itself for authentication; changing them by hand breaks sign-in. */
const AUTH_INTERNALS = [
  'salt',
  'hash',
  'resetPasswordToken',
  'resetPasswordExpiration',
  'resetPasswordRequestedAt',
  'loginAttempts',
  'lockUntil',
  'sessions',
  '_verified',
  '_verificationToken',
  'apiKey',
  'apiKeyIndex',
  'enableAPIKey',
]
/** Written by Payload when a file is uploaded. */
const UPLOAD_METADATA = ['url', 'thumbnailURL', 'filename', 'mimeType', 'filesize', 'width', 'height', 'focalX', 'focalY', 'sizes']
const TIMESTAMPS = ['createdAt', 'updatedAt']

/** Fields that exist on collections but are maintained by Payload, never by commands or forms. */
export const MANAGED_FIELDS: ReadonlySet<string> = new Set([...AUTH_INTERNALS, ...UPLOAD_METADATA, ...TIMESTAMPS])
const NEVER_IN_JSON: ReadonlySet<string> = new Set([...AUTH_INTERNALS, ...UPLOAD_METADATA])

/** The fields of a collection a person can meaningfully set. */
export function editableFields(meta: CollectionMeta): FieldMeta[] {
  return meta.fields.filter((f) => f.name && !MANAGED_FIELDS.has(f.name))
}
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
    if (MANAGED_FIELDS.has(key) && meta.fields.some((f) => f.name === key)) {
      throw new CliError(`Field "${key}" is managed by Payload and cannot be set here.`)
    }
    const field = meta.fields.find((f) => f.name === key)
    if (!field) {
      const names = editableFields(meta).map((f) => f.name).join(', ')
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
    if (NEVER_IN_JSON.has(key)) throw new CliError(`Field "${key}" is managed by Payload and cannot be set here.`)
    if (!known.has(key)) {
      const names = editableFields(meta).map((f) => f.name).join(', ')
      throw new CliError(`Unknown field "${key}" in "${meta.slug}". Fields: ${names}.`)
    }
  }
}
