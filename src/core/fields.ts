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

export interface FieldSpec {
  /** Field name. For `collapsible` it is the label; for `row`/`tabs` it is only an identifier. */
  name: string
  type: FieldType
  required: boolean
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
const SYNTAX = 'name:type[:arg][(fields)][!]'

const HAS_FIELDS: ReadonlySet<FieldType> = new Set(['array', 'group', 'row', 'collapsible'])
const NO_REQUIRED: ReadonlySet<FieldType> = new Set(['collapsible', 'group', 'join', 'row', 'tabs', 'ui'])
const TAKES_OPTIONS: ReadonlySet<FieldType> = new Set(['select', 'radio'])
const TAKES_RELATION: ReadonlySet<FieldType> = new Set(['upload', 'relationship'])

/** Types for which the `Required?` question makes sense. */
export const supportsRequired = (type: FieldType): boolean => !NO_REQUIRED.has(type)

/** Splits on `sep` outside parentheses; throws on unbalanced parentheses. */
function splitTop(input: string, sep = ','): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of input) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (depth < 0) throw new CliError(`Unbalanced parentheses in "${input}".`)
    if (ch === sep && depth === 0) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  if (depth !== 0) throw new CliError(`Unbalanced parentheses in "${input}".`)
  parts.push(current)
  return parts.map((s) => s.trim()).filter(Boolean)
}

function parseEntry(raw: string): FieldSpec {
  const required = raw.endsWith('!')
  const body = required ? raw.slice(0, -1).trim() : raw
  const open = body.indexOf('(')
  if (open !== -1 && !body.endsWith(')')) throw new CliError(`Field "${raw}" has unbalanced parentheses.`)
  const head = open === -1 ? body : body.slice(0, open)
  const children = open === -1 ? undefined : body.slice(open + 1, -1)

  const [name, rawType, ...rest] = head.split(':').map((s) => s.trim())
  const arg = rest.join(':')
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
  return spec
}

/** Checks names, duplicates, required support and per-type arguments; throws CliError. Recursive. */
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
 * Parses `"title:text!,links:array(label:text!,url:text!),status:select:draft|live"`.
 * `!` marks required; `:arg` is a target slug, `a|b` options or `collection.field` (join);
 * `(…)` holds nested fields, `Label(…)` tabs, or block names for `blocks`.
 */
export function parseFieldSpecs(input: string): FieldSpec[] {
  const specs = splitTop(input).map(parseEntry)
  validateSpecs(specs)
  return specs
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

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
    if (f.required) lines.push(`${inner}required: true,`)
    if (f.relationTo) lines.push(`${inner}relationTo: ${quote(f.relationTo)},`)
    if (f.options) lines.push(`${inner}options: [${f.options.map(quote).join(', ')}],`)
    if (f.join) lines.push(`${inner}collection: ${quote(f.join.collection)},`, `${inner}on: ${quote(f.join.on)},`)
    if (f.blocks) lines.push(`${inner}blocks: [${f.blocks.map((b) => toPascal(toSlug(b))).join(', ')}],`)
    if (f.fields) lines.push(...nested(f.fields, indent + 2))
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
