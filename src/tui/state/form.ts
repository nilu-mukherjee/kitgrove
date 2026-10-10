import { CliError } from '../../core/errors.js'
import {
  FIELD_TYPES,
  type FieldSpec,
  type FieldType,
  type OptionKey,
  supportsOption,
  supportsRequired,
  validateSpecs,
} from '../../core/fields.js'

export type RowKey =
  | 'name'
  | 'type'
  | 'options'
  | 'relationTo'
  | 'join'
  | 'blocks'
  | 'required'
  | 'unique'
  | 'defaultValue'
  | 'label'
  | 'description'
  | 'position'
  | 'readOnly'
  | 'index'
  | 'hasMany'
  | 'min'
  | 'max'
  | 'minLength'
  | 'maxLength'

export type RowValue = string | boolean | string[] | undefined

export interface FormRow {
  key: RowKey
  label: string
  kind: 'text' | 'select' | 'bool' | 'multi'
  value: RowValue
  choices?: string[]
}

const NUMERIC: RowKey[] = ['min', 'max', 'minLength', 'maxLength']

/** The editable rows for one field: only what its type supports, in a stable order. */
export function fieldForm(spec: FieldSpec): FormRow[] {
  const rows: FormRow[] = [
    { key: 'name', label: 'Name', kind: 'text', value: spec.name },
    { key: 'type', label: 'Type', kind: 'select', value: spec.type, choices: [...FIELD_TYPES] },
  ]
  const t = spec.type
  if (t === 'select' || t === 'radio') {
    rows.push({ key: 'options', label: 'Options (a|b|c)', kind: 'text', value: spec.options?.join('|') ?? '' })
  }
  if (t === 'upload' || t === 'relationship') {
    rows.push({ key: 'relationTo', label: 'Target collection', kind: 'text', value: spec.relationTo ?? '' })
  }
  if (t === 'join') {
    rows.push({
      key: 'join',
      label: 'Join (collection.field)',
      kind: 'text',
      value: spec.join ? `${spec.join.collection}.${spec.join.on}` : '',
    })
  }
  if (t === 'blocks') rows.push({ key: 'blocks', label: 'Allowed blocks', kind: 'multi', value: spec.blocks ?? [] })

  if (supportsRequired(t)) rows.push({ key: 'required', label: 'Required', kind: 'bool', value: spec.required })
  if (supportsOption(t, 'unique')) rows.push({ key: 'unique', label: 'Unique', kind: 'bool', value: Boolean(spec.unique) })

  if (supportsOption(t, 'defaultValue')) {
    if (t === 'checkbox') {
      rows.push({ key: 'defaultValue', label: 'Checked by default', kind: 'bool', value: spec.defaultValue === true })
    } else if (t === 'date') {
      rows.push({ key: 'defaultValue', label: 'Default to now', kind: 'bool', value: spec.defaultValue === 'now' })
    } else if (t === 'select' || t === 'radio') {
      rows.push({
        key: 'defaultValue',
        label: 'Default value',
        kind: 'select',
        value: spec.defaultValue === undefined ? '' : String(spec.defaultValue),
        choices: ['', ...(spec.options ?? [])],
      })
    } else {
      rows.push({
        key: 'defaultValue',
        label: 'Default value',
        kind: 'text',
        value: spec.defaultValue === undefined ? '' : String(spec.defaultValue),
      })
    }
  }

  const optional: [OptionKey & RowKey, string, FormRow['kind']][] = [
    ['label', 'Label', 'text'],
    ['description', 'Description', 'text'],
    ['position', 'Admin position', 'select'],
    ['readOnly', 'Read-only', 'bool'],
    ['index', 'Index', 'bool'],
    ['hasMany', 'Allow multiple (hasMany)', 'bool'],
    ['min', 'Minimum', 'text'],
    ['max', 'Maximum', 'text'],
    ['minLength', 'Minimum length', 'text'],
    ['maxLength', 'Maximum length', 'text'],
  ]
  for (const [key, label, kind] of optional) {
    if (!supportsOption(t, key)) continue
    const raw = (spec as unknown as Record<string, unknown>)[key]
    rows.push({
      key,
      label,
      kind,
      value: kind === 'bool' ? Boolean(raw) : key === 'position' ? ((raw as string) ?? 'main') : raw === undefined ? '' : String(raw),
      ...(key === 'position' ? { choices: ['main', 'sidebar'] } : {}),
    })
  }
  return rows
}

function retype(spec: FieldSpec, type: FieldType): FieldSpec {
  const next: FieldSpec = { name: spec.name, type, required: supportsRequired(type) && spec.required }
  const copy = ['label', 'description', 'position', 'readOnly', 'index', 'hasMany', 'unique', 'min', 'max', 'minLength', 'maxLength'] as const
  for (const key of copy) {
    if (spec[key] !== undefined && supportsOption(type, key)) (next as unknown as Record<string, unknown>)[key] = spec[key]
  }
  if (spec.relationTo && (type === 'upload' || type === 'relationship')) next.relationTo = spec.relationTo
  if (spec.options && (type === 'select' || type === 'radio')) next.options = spec.options
  if (spec.join && type === 'join') next.join = spec.join
  if (spec.blocks && type === 'blocks') next.blocks = spec.blocks
  if (spec.fields && ['array', 'group', 'row', 'collapsible'].includes(type)) next.fields = spec.fields
  if (spec.tabs && type === 'tabs') next.tabs = spec.tabs
  return next
}

const number = (key: string, v: string): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new CliError(`${key} must be a number.`)
  return n
}

/** Applies one edited row to a draft field. Parse-level errors only; use `validateDraft` to check the whole field. */
export function applyRow(spec: FieldSpec, key: RowKey, value: RowValue): { spec: FieldSpec } | { error: string } {
  try {
    const next: FieldSpec = { ...spec }
    const text = typeof value === 'string' ? value.trim() : ''
    const set = (k: keyof FieldSpec, v: unknown) => {
      ;(next as unknown as Record<string, unknown>)[k] = v === '' || v === false ? undefined : v
    }

    switch (key) {
      case 'name':
        next.name = text
        break
      case 'type':
        return { spec: retype(spec, value as FieldType) }
      case 'options':
        next.options = text ? text.split('|').map((o) => o.trim()).filter(Boolean) : undefined
        break
      case 'relationTo':
        next.relationTo = text || undefined
        break
      case 'join': {
        const dot = text.lastIndexOf('.')
        if (!text) next.join = undefined
        else if (dot > 0 && dot < text.length - 1) next.join = { collection: text.slice(0, dot), on: text.slice(dot + 1) }
        else throw new CliError('A join is written collection.field, e.g. posts.category.')
        break
      }
      case 'blocks':
        next.blocks = Array.isArray(value) && value.length ? value : undefined
        break
      case 'required':
        next.required = Boolean(value)
        break
      case 'defaultValue':
        if (spec.type === 'number') next.defaultValue = text === '' ? undefined : number('Default (a number)', text)
        else if (spec.type === 'checkbox') next.defaultValue = value === true ? true : undefined
        else if (spec.type === 'date') next.defaultValue = value === true ? 'now' : undefined
        else next.defaultValue = text === '' ? undefined : text
        break
      case 'position':
        next.position = value === 'sidebar' ? 'sidebar' : undefined
        break
      case 'min':
      case 'max':
      case 'minLength':
      case 'maxLength':
        set(key, text === '' ? undefined : number(key, text))
        break
      default:
        set(key, typeof value === 'string' ? text : value)
    }
    return { spec: next }
  } catch (err) {
    return { error: err instanceof CliError ? err.message : String(err) }
  }
}

/** The first reason `spec` is not valid next to its `siblings`, or null. */
export function validateDraft(spec: FieldSpec, siblings: FieldSpec[]): string | null {
  try {
    validateSpecs([...siblings, spec])
    return null
  } catch (err) {
    return err instanceof CliError ? err.message : String(err)
  }
}

export const NUMERIC_ROWS = NUMERIC
