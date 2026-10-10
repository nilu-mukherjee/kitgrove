import { CliError } from './errors.js'
import { toPascal, toSlug } from './template.js'

/** Payload's field types (alphabetical, as in the admin's field picker). */
export const FIELD_TYPES = [
  'array',
  'blocks',
  'checkbox',
  'code',
  'collapsible',
  'date',
  'email',
  'group',
  'join',
  'json',
  'number',
  'point',
  'radio',
  'relationship',
  'richText',
  'row',
  'select',
  'tabs',
  'text',
  'textarea',
  'ui',
  'upload',
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

export type DefaultValue = string | number | boolean

export interface FieldSpec {
  /** Field name. For `collapsible` it is the label; for `row`/`tabs` it is only an identifier. */
  name: string
  type: FieldType
  required: boolean
  unique?: boolean
  index?: boolean
  /** Static default. For `date`, the string `now` means "the current time". */
  defaultValue?: DefaultValue
  label?: string
  description?: string
  position?: 'sidebar' | 'main'
  readOnly?: boolean
  hasMany?: boolean
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  /** Target collection slug for `upload` / `relationship`. */
  relationTo?: string
  /** Option values for `select` / `radio`. */
  options?: string[]
  /** Nested fields of `array` / `group` / `row` / `collapsible`. */
  fields?: FieldSpec[]
  tabs?: { label: string; fields: FieldSpec[] }[]
  /** Slugs of existing blocks for `blocks`. */
  blocks?: string[]
  join?: { collection: string; on: string }
}

const RESERVED_NAMES = new Set(['id', 'createdAt', 'updatedAt', 'tenant'])
const SYNTAX = 'name:type[:arg][(fields)][!][[option,key=value]]'

const set = (...t: FieldType[]): ReadonlySet<FieldType> => new Set(t)
const HAS_FIELDS = set('array', 'group', 'row', 'collapsible')
const NO_REQUIRED = set('collapsible', 'group', 'join', 'row', 'tabs', 'ui')
const TAKES_OPTIONS = set('select', 'radio')
const TAKES_RELATION = set('upload', 'relationship')
const NO_ADMIN = set('row', 'tabs', 'ui')

const SCALAR = set('text', 'textarea', 'email', 'number', 'date', 'select', 'radio', 'relationship', 'code')

/** Which field types accept which option (taken from Payload 3.90's field config types). */
export const OPTION_SUPPORT = {
  unique: SCALAR,
  index: set(...SCALAR, 'checkbox', 'upload'),
  defaultValue: set('text', 'textarea', 'email', 'code', 'number', 'checkbox', 'date', 'select', 'radio'),
  label: set(...FIELD_TYPES.filter((t) => !['row', 'tabs', 'collapsible', 'ui'].includes(t))),
  description: set(...FIELD_TYPES.filter((t) => !NO_ADMIN.has(t))),
  position: set(...FIELD_TYPES.filter((t) => !NO_ADMIN.has(t))),
  readOnly: set(...FIELD_TYPES.filter((t) => !NO_ADMIN.has(t))),
  hasMany: set('text', 'number', 'select', 'relationship', 'upload'),
  min: set('number'),
  max: set('number'),
  minLength: set('text', 'textarea', 'code'),
  maxLength: set('text', 'textarea', 'code'),
} as const

export type OptionKey = keyof typeof OPTION_SUPPORT

export const supportsOption = (type: FieldType, option: OptionKey): boolean => OPTION_SUPPORT[option].has(type)

/** Types for which the `Required?` question makes sense. */
export const supportsRequired = (type: FieldType): boolean => !NO_REQUIRED.has(type)

/** Splits on `,` outside parentheses and brackets; throws on unbalanced ones. */
function splitTop(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of input) {
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth--
    if (depth < 0) throw new CliError(`Unbalanced parentheses or brackets in "${input}".`)
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  if (depth !== 0) throw new CliError(`Unbalanced parentheses or brackets in "${input}".`)
  parts.push(current)
  return parts.map((s) => s.trim()).filter(Boolean)
}

const BOOLEAN_OPTIONS = ['unique', 'index', 'readOnly', 'hasMany'] as const
const NUMBER_OPTIONS = ['min', 'max', 'minLength', 'maxLength'] as const
const STRING_OPTIONS = ['label', 'description', 'position', 'default'] as const

function applyOptions(spec: FieldSpec, opts: string): void {
  for (const raw of opts.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = raw.indexOf('=')
    const key = (eq === -1 ? raw : raw.slice(0, eq)).trim()
    const value = eq === -1 ? undefined : raw.slice(eq + 1).trim()
    const at = `Field "${spec.name}"`

    if ((BOOLEAN_OPTIONS as readonly string[]).includes(key)) {
      if (value !== undefined && value !== 'true' && value !== 'false') {
        throw new CliError(`${at}: ${key} must be true or false.`)
      }
      ;(spec as unknown as Record<string, unknown>)[key] = value !== 'false'
    } else if ((NUMBER_OPTIONS as readonly string[]).includes(key)) {
      const n = Number(value)
      if (value === undefined || value === '' || !Number.isFinite(n)) throw new CliError(`${at}: ${key} must be a number.`)
      ;(spec as unknown as Record<string, unknown>)[key] = n
    } else if ((STRING_OPTIONS as readonly string[]).includes(key)) {
      if (value === undefined || value === '') throw new CliError(`${at}: ${key} needs a value, e.g. ${key}=...`)
      if (key === 'position') {
        if (value !== 'sidebar' && value !== 'main') throw new CliError(`${at}: position must be sidebar or main.`)
        spec.position = value
      } else if (key === 'default') {
        spec.defaultValue = parseDefault(spec, value)
      } else {
        ;(spec as unknown as Record<string, unknown>)[key] = value
      }
    } else {
      throw new CliError(`Unknown option "${key}" for field "${spec.name}".`)
    }
  }
}

function parseDefault(spec: FieldSpec, value: string): DefaultValue {
  const at = `Field "${spec.name}"`
  switch (spec.type) {
    case 'number': {
      const n = Number(value)
      if (!Number.isFinite(n)) throw new CliError(`${at}: default "${value}" is not a number.`)
      return n
    }
    case 'checkbox':
      if (value !== 'true' && value !== 'false') throw new CliError(`${at}: default must be true or false.`)
      return value === 'true'
    case 'date':
      if (value !== 'now' && Number.isNaN(Date.parse(value))) {
        throw new CliError(`${at}: default "${value}" is not a valid date (use now or an ISO date).`)
      }
      return value
    default:
      return value
  }
}

function parseEntry(raw: string): FieldSpec {
  let rest = raw.trim()
  let opts = ''
  if (rest.endsWith(']')) {
    const open = rest.lastIndexOf('[')
    if (open === -1) throw new CliError(`Unbalanced parentheses or brackets in "${raw}".`)
    opts = rest.slice(open + 1, -1)
    rest = rest.slice(0, open).trim()
  }
  const required = rest.endsWith('!')
  const body = required ? rest.slice(0, -1).trim() : rest
  const open = body.indexOf('(')
  if (open !== -1 && !body.endsWith(')')) throw new CliError(`Field "${raw}" has unbalanced parentheses.`)
  const head = open === -1 ? body : body.slice(0, open)
  const children = open === -1 ? undefined : body.slice(open + 1, -1)

  const [name, rawType, ...argParts] = head.split(':').map((s) => s.trim())
  const arg = argParts.join(':')
  if (!name || !rawType) throw new CliError(`Field "${raw}" must be written ${SYNTAX}.`)

  const type = FIELD_TYPES.find((t) => t.toLowerCase() === rawType.toLowerCase())
  if (!type) throw new CliError(`Unknown field type "${rawType}". Choose one of: ${FIELD_TYPES.join(', ')}.`)

  const spec: FieldSpec = { name, type, required }
  const takesArg = TAKES_OPTIONS.has(type) || TAKES_RELATION.has(type) || type === 'join'
  if (arg && !takesArg) throw new CliError(`Field "${name}" (${type}) does not take an argument.`)

  if (TAKES_RELATION.has(type) && arg) spec.relationTo = arg
  if (TAKES_OPTIONS.has(type) && arg) spec.options = arg.split('|').map((o) => o.trim()).filter(Boolean)
  if (type === 'join' && arg) {
    const dot = arg.lastIndexOf('.')
    if (dot > 0 && dot < arg.length - 1) spec.join = { collection: arg.slice(0, dot), on: arg.slice(dot + 1) }
  }

  if (children !== undefined) {
    if (HAS_FIELDS.has(type)) spec.fields = parseFieldSpecs(children)
    else if (type === 'blocks') spec.blocks = splitTop(children)
    else if (type === 'tabs') {
      spec.tabs = splitTop(children).map((t) => {
        const o = t.indexOf('(')
        if (o <= 0 || !t.endsWith(')')) {
          throw new CliError(`Tab "${t}" in "${name}" must be written Label(field:type,...).`)
        }
        return { label: t.slice(0, o).trim(), fields: parseFieldSpecs(t.slice(o + 1, -1)) }
      })
    } else spec.fields = [{ name: '_', type: 'text', required: false }] // flagged by validateSpecs
  }
  if (opts) applyOptions(spec, opts)
  return spec
}

function validateOptions(f: FieldSpec): void {
  const at = `Field "${f.name}" (${f.type})`
  const given: [OptionKey, unknown][] = [
    ['unique', f.unique],
    ['index', f.index],
    ['defaultValue', f.defaultValue],
    ['label', f.label],
    ['description', f.description],
    ['position', f.position],
    ['readOnly', f.readOnly],
    ['hasMany', f.hasMany],
    ['min', f.min],
    ['max', f.max],
    ['minLength', f.minLength],
    ['maxLength', f.maxLength],
  ]
  for (const [option, value] of given) {
    if (value === undefined || (value === false && option !== 'defaultValue')) continue
    if (!supportsOption(f.type, option)) {
      throw new CliError(`${at} does not support ${option === 'defaultValue' ? 'default' : option}.`)
    }
  }
  if (f.hasMany) {
    if (f.unique) throw new CliError(`${at}: unique cannot be combined with hasMany.`)
    if (f.defaultValue !== undefined) throw new CliError(`${at}: default cannot be combined with hasMany.`)
  }
  if (f.options && f.defaultValue !== undefined && !f.options.includes(String(f.defaultValue))) {
    throw new CliError(`${at}: default must be one of ${f.options.join(', ')}.`)
  }
}

/** Checks names, duplicates, required support, options and per-type arguments; throws CliError. Recursive. */
export function validateSpecs(specs: FieldSpec[]): void {
  const seen = new Set<string>()
  for (const f of specs) {
    if (!/^[A-Za-z_$][\w$]*$/.test(f.name)) throw new CliError(`"${f.name}" is not a valid field name.`)
    if (RESERVED_NAMES.has(f.name)) throw new CliError(`"${f.name}" is reserved and cannot be used as a field name.`)
    if (seen.has(f.name)) throw new CliError(`Duplicate field "${f.name}".`)
    seen.add(f.name)

    if (f.required && NO_REQUIRED.has(f.type)) {
      throw new CliError(`Field "${f.name}" (${f.type}) does not support required.`)
    }
    validateOptions(f)

    if (TAKES_RELATION.has(f.type)) {
      if (!f.relationTo) {
        throw new CliError(`Field "${f.name}" (${f.type}) needs a target collection, e.g. ${f.name}:${f.type}:media.`)
      }
      if (!/^[A-Za-z][\w-]*$/.test(f.relationTo)) throw new CliError(`"${f.relationTo}" is not a valid collection slug.`)
    }
    if (TAKES_OPTIONS.has(f.type)) {
      if (!f.options) {
        throw new CliError(`Field "${f.name}" (${f.type}) needs options, e.g. ${f.name}:${f.type}:draft|published.`)
      }
      if (f.options.length < 2) throw new CliError(`Field "${f.name}" needs at least two options separated by |.`)
    }
    if (f.type === 'join' && !f.join) {
      throw new CliError(`Field "${f.name}" (join) needs collection.field, e.g. ${f.name}:join:posts.category.`)
    }
    if (f.type === 'blocks') {
      if (!f.blocks?.length) throw new CliError(`Field "${f.name}" (blocks) needs at least one block, e.g. ${f.name}:blocks(hero).`)
      for (const b of f.blocks) {
        if (!/^[A-Za-z][\w-]*$/.test(b)) throw new CliError(`"${b}" is not a valid block name.`)
      }
    }
    if (f.type === 'tabs') {
      if (!f.tabs?.length) throw new CliError(`Field "${f.name}" (tabs) needs at least one tab, e.g. ${f.name}:tabs(Content(title:text)).`)
      for (const t of f.tabs) validateSpecs(t.fields)
    }
    if (HAS_FIELDS.has(f.type)) {
      if (!f.fields?.length) throw new CliError(`Field "${f.name}" (${f.type}) needs fields, e.g. ${f.name}:${f.type}(title:text).`)
      validateSpecs(f.fields)
    } else if (f.type !== 'tabs' && f.fields) {
      throw new CliError(`Field "${f.name}" (${f.type}) cannot contain fields.`)
    }
  }
}

/**
 * Parses `"title:text![unique],links:array(label:text!,url:text!),status:select:draft|live[default=draft]"`.
 * `!` marks required; `:arg` is a target slug, `a|b` options or `collection.field` (join); `(…)` holds
 * nested fields, `Label(…)` tabs, or block names; a trailing `[unique,default=x,label=Y,…]` sets options.
 */
export function parseFieldSpecs(input: string): FieldSpec[] {
  const specs = splitTop(input).map(parseEntry)
  validateSpecs(specs)
  return specs
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function renderDefault(f: FieldSpec): string {
  if (f.type === 'date' && f.defaultValue === 'now') return '() => new Date().toISOString()'
  return typeof f.defaultValue === 'string' ? quote(f.defaultValue) : String(f.defaultValue)
}

function renderField(f: FieldSpec, indent: number): string[] {
  const pad = ' '.repeat(indent)
  const inner = ' '.repeat(indent + 2)
  const nested = (fields: FieldSpec[], at: number): string[] => [
    `${' '.repeat(at)}fields: [`,
    ...fields.flatMap((c) => renderField(c, at + 2)),
    `${' '.repeat(at)}],`,
  ]

  const lines: string[] = [`${pad}{`]
  if (f.type === 'ui') {
    lines.push(
      `${inner}name: ${quote(f.name)},`,
      `${inner}type: 'ui',`,
      `${inner}admin: {`,
      `${inner}  // Add components: { Field: '<path>#<export>' } to render something in the admin.`,
      `${inner}},`,
    )
  } else if (f.type === 'row') {
    lines.push(`${inner}type: 'row',`, ...nested(f.fields!, indent + 2))
  } else if (f.type === 'collapsible') {
    lines.push(`${inner}label: ${quote(f.name)},`, `${inner}type: 'collapsible',`, ...nested(f.fields!, indent + 2))
  } else if (f.type === 'tabs') {
    lines.push(`${inner}type: 'tabs',`, `${inner}tabs: [`)
    for (const t of f.tabs!) {
      lines.push(`${inner}  {`, `${inner}    label: ${quote(t.label)},`, ...nested(t.fields, indent + 6), `${inner}  },`)
    }
    lines.push(`${inner}],`)
  } else {
    lines.push(`${inner}name: ${quote(f.name)},`, `${inner}type: ${quote(f.type)},`)
    if (f.label) lines.push(`${inner}label: ${quote(f.label)},`)
    if (f.required) lines.push(`${inner}required: true,`)
    if (f.unique) lines.push(`${inner}unique: true,`)
    if (f.index) lines.push(`${inner}index: true,`)
    if (f.defaultValue !== undefined) lines.push(`${inner}defaultValue: ${renderDefault(f)},`)
    if (f.hasMany) lines.push(`${inner}hasMany: true,`)
    if (f.min !== undefined) lines.push(`${inner}min: ${f.min},`)
    if (f.max !== undefined) lines.push(`${inner}max: ${f.max},`)
    if (f.minLength !== undefined) lines.push(`${inner}minLength: ${f.minLength},`)
    if (f.maxLength !== undefined) lines.push(`${inner}maxLength: ${f.maxLength},`)
    if (f.relationTo) lines.push(`${inner}relationTo: ${quote(f.relationTo)},`)
    if (f.options) lines.push(`${inner}options: [${f.options.map(quote).join(', ')}],`)
    if (f.join) lines.push(`${inner}collection: ${quote(f.join.collection)},`, `${inner}on: ${quote(f.join.on)},`)
    if (f.blocks) lines.push(`${inner}blocks: [${f.blocks.map((b) => toPascal(toSlug(b))).join(', ')}],`)
    if (f.fields) lines.push(...nested(f.fields, indent + 2))
    if (f.description || f.position || f.readOnly) {
      lines.push(`${inner}admin: {`)
      if (f.description) lines.push(`${inner}  description: ${quote(f.description)},`)
      if (f.position) lines.push(`${inner}  position: ${quote(f.position)},`)
      if (f.readOnly) lines.push(`${inner}  readOnly: true,`)
      lines.push(`${inner}},`)
    }
  }
  lines.push(`${pad}},`)
  return lines
}

/** Field object literals, indented for placement inside `fields: [ ... ]` at two spaces. */
export function renderFields(specs: FieldSpec[]): string {
  return specs.flatMap((f) => renderField(f, 4)).join('\n')
}

function walk(specs: FieldSpec[], visit: (f: FieldSpec) => void): void {
  for (const f of specs) {
    visit(f)
    if (f.fields) walk(f.fields, visit)
    for (const t of f.tabs ?? []) walk(t.fields, visit)
  }
}

/** Slugs of every block referenced anywhere in `specs`, de-duplicated, in order. */
export function collectBlocks(specs: FieldSpec[]): string[] {
  const out: string[] = []
  walk(specs, (f) => {
    for (const b of f.blocks ?? []) {
      const slug = toSlug(b)
      if (!out.includes(slug)) out.push(slug)
    }
  })
  return out
}

/** Every collection referenced by an upload, relationship or join. */
export function collectRelations(specs: FieldSpec[]): { field: string; collection: string }[] {
  const out: { field: string; collection: string }[] = []
  walk(specs, (f) => {
    const collection = f.relationTo ?? f.join?.collection
    if (collection) out.push({ field: f.name, collection })
  })
  return out
}

/** The field to use as the admin title: `title`, else the first text/email field, else `id`. */
export function pickTitleField(specs: FieldSpec[]): string {
  if (specs.length === 0) return 'title'
  if (specs.some((f) => f.name === 'title')) return 'title'
  return specs.find((f) => f.type === 'text' || f.type === 'email')?.name ?? 'id'
}
