import { CliError } from './errors.js'

export const FIELD_TYPES = [
  'text',
  'textarea',
  'richText',
  'number',
  'checkbox',
  'date',
  'email',
  'select',
  'upload',
  'relationship',
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

export interface FieldSpec {
  name: string
  type: FieldType
  required: boolean
  /** Target collection slug for `upload` / `relationship`. */
  relationTo?: string
  /** Option values for `select`. */
  options?: string[]
}

const RESERVED_NAMES = new Set(['id', 'createdAt', 'updatedAt', 'tenant'])
const SYNTAX = 'name:type[:arg][!]'

/**
 * Parses `"title:text!,image:upload:media,status:select:draft|live"`.
 * `!` marks a field required; the argument is the target slug (upload/relationship) or `a|b` options (select).
 */
export function parseFieldSpecs(input: string): FieldSpec[] {
  const specs: FieldSpec[] = []
  const seen = new Set<string>()

  for (const raw of input.split(',').map((s) => s.trim()).filter(Boolean)) {
    const required = raw.endsWith('!')
    const [name, rawType, arg] = (required ? raw.slice(0, -1) : raw).split(':').map((s) => s.trim())
    if (!name || !rawType) throw new CliError(`Field "${raw}" must be written ${SYNTAX}.`)
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new CliError(`"${name}" is not a valid field name.`)
    if (RESERVED_NAMES.has(name)) throw new CliError(`"${name}" is reserved and cannot be used as a field name.`)
    if (seen.has(name)) throw new CliError(`Duplicate field "${name}".`)
    seen.add(name)

    const type = FIELD_TYPES.find((t) => t.toLowerCase() === rawType.toLowerCase())
    if (!type) throw new CliError(`Unknown field type "${rawType}". Choose one of: ${FIELD_TYPES.join(', ')}.`)

    const spec: FieldSpec = { name, type, required }
    if (type === 'upload' || type === 'relationship') {
      if (!arg) throw new CliError(`Field "${name}" (${type}) needs a target collection, e.g. ${name}:${type}:media.`)
      if (!/^[A-Za-z][\w-]*$/.test(arg)) throw new CliError(`"${arg}" is not a valid collection slug.`)
      spec.relationTo = arg
    } else if (type === 'select') {
      if (!arg) throw new CliError(`Field "${name}" (select) needs options, e.g. ${name}:select:draft|published.`)
      const options = arg.split('|').map((o) => o.trim()).filter(Boolean)
      if (options.length < 2) throw new CliError(`Field "${name}" needs at least two options separated by |.`)
      spec.options = options
    }
    specs.push(spec)
  }
  return specs
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** Field object literals, indented for placement inside `fields: [ ... ]` at two spaces. */
export function renderFields(specs: FieldSpec[]): string {
  return specs
    .map((f) => {
      const lines = [`name: ${quote(f.name)},`, `type: ${quote(f.type)},`]
      if (f.required) lines.push('required: true,')
      if (f.relationTo) lines.push(`relationTo: ${quote(f.relationTo)},`)
      if (f.options) lines.push(`options: [${f.options.map(quote).join(', ')}],`)
      return ['    {', ...lines.map((l) => `      ${l}`), '    },'].join('\n')
    })
    .join('\n')
}

/** The field to use as the admin title: `title`, else the first text/email field, else `id`. */
export function pickTitleField(specs: FieldSpec[]): string {
  if (specs.length === 0) return 'title'
  if (specs.some((f) => f.name === 'title')) return 'title'
  return specs.find((f) => f.type === 'text' || f.type === 'email')?.name ?? 'id'
}
