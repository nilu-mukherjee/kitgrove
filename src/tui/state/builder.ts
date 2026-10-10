import type { AccessOp, AccessRule, AccessRules } from '../../core/access.js'
import { CliError } from '../../core/errors.js'
import { type FieldSpec, validateSpecs } from '../../core/fields.js'
import { toSlug } from '../../core/template.js'
import { type GenerateKind, renderGenerated } from '../../commands/generate.js'

/** One step into a container: the field index, and which tab for `tabs` fields. */
export interface PathStep {
  field: number
  tab?: number
}

export interface BuilderState {
  kind: GenerateKind
  name: string
  useAsTitle?: string
  globalShared: boolean
  fields: FieldSpec[]
  path: PathStep[]
  selected: number
  access: AccessRules
  error?: string
}

export type BuilderAction =
  | { type: 'setName'; name: string }
  | { type: 'setUseAsTitle'; field: string | undefined }
  | { type: 'setGlobalShared'; value: boolean }
  | { type: 'setAccess'; op: AccessOp; rule: AccessRule | undefined }
  | { type: 'add'; spec: FieldSpec }
  | { type: 'replace'; index: number; spec: FieldSpec }
  | { type: 'remove'; index: number }
  | { type: 'move'; index: number; direction: 'up' | 'down' }
  | { type: 'select'; index: number }
  | { type: 'selectBy'; delta: number }
  | { type: 'enter'; tab?: number }
  | { type: 'leave' }
  | { type: 'clearError' }

export function initialBuilder(kind: GenerateKind): BuilderState {
  return { kind, name: '', globalShared: false, fields: [], path: [], selected: 0, access: {} }
}

function listAt(root: FieldSpec[], path: PathStep[]): FieldSpec[] {
  let list = root
  for (const step of path) {
    const f = list[step.field]
    if (!f) return []
    list = f.tabs ? (f.tabs[step.tab ?? 0]?.fields ?? []) : (f.fields ?? [])
  }
  return list
}

function withListAt(root: FieldSpec[], path: PathStep[], fn: (list: FieldSpec[]) => FieldSpec[]): FieldSpec[] {
  if (path.length === 0) return fn(root)
  const [step, ...rest] = path
  return root.map((f, i) => {
    if (i !== step!.field) return f
    if (f.tabs) {
      const tab = step!.tab ?? 0
      return { ...f, tabs: f.tabs.map((t, ti) => (ti === tab ? { ...t, fields: withListAt(t.fields, rest, fn) } : t)) }
    }
    return { ...f, fields: withListAt(f.fields ?? [], rest, fn) }
  })
}

/** The fields shown in the table: the root list, or the container the user has drilled into. */
export function currentFields(s: BuilderState): FieldSpec[] {
  return listAt(s.fields, s.path)
}

function message(err: unknown): string {
  return err instanceof CliError ? err.message : String(err)
}

function tryUpdate(s: BuilderState, next: FieldSpec[], selected: number): BuilderState {
  try {
    validateSpecs(next)
  } catch (err) {
    return { ...s, error: message(err) }
  }
  return {
    ...s,
    fields: withListAt(s.fields, s.path, () => next),
    selected,
    error: undefined,
  }
}

export function builderReducer(s: BuilderState, a: BuilderAction): BuilderState {
  const list = currentFields(s)
  switch (a.type) {
    case 'setName':
      return { ...s, name: a.name }
    case 'setUseAsTitle':
      return { ...s, useAsTitle: a.field || undefined }
    case 'setGlobalShared':
      return { ...s, globalShared: a.value }
    case 'setAccess': {
      const access = { ...s.access }
      if (a.rule) access[a.op] = a.rule
      else delete access[a.op]
      return { ...s, access }
    }
    case 'add':
      return tryUpdate(s, [...list, a.spec], list.length)
    case 'replace':
      return tryUpdate(
        s,
        list.map((f, i) => (i === a.index ? a.spec : f)),
        a.index,
      )
    case 'remove': {
      const next = list.filter((_, i) => i !== a.index)
      return tryUpdate(s, next, Math.max(0, Math.min(s.selected, next.length - 1)))
    }
    case 'move': {
      const to = a.direction === 'up' ? a.index - 1 : a.index + 1
      if (a.index < 0 || a.index >= list.length || to < 0 || to >= list.length) return s
      const next = [...list]
      ;[next[a.index], next[to]] = [next[to]!, next[a.index]!]
      return tryUpdate(s, next, to)
    }
    case 'select':
      return { ...s, selected: Math.max(0, Math.min(list.length - 1, a.index)) }
    case 'selectBy':
      return { ...s, selected: Math.max(0, Math.min(list.length - 1, s.selected + a.delta)) }
    case 'enter': {
      const f = list[s.selected]
      if (!f || !(f.fields || f.tabs)) return s
      const step: PathStep = f.tabs
        ? { field: s.selected, tab: Math.max(0, Math.min(f.tabs.length - 1, a.tab ?? 0)) }
        : { field: s.selected }
      return { ...s, path: [...s.path, step], selected: 0, error: undefined }
    }
    case 'leave': {
      if (s.path.length === 0) return s
      const popped = s.path[s.path.length - 1]!
      return { ...s, path: s.path.slice(0, -1), selected: popped.field, error: undefined }
    }
    case 'clearError':
      return { ...s, error: undefined }
  }
}

/** The reason this builder cannot be written yet, or null. */
export function validateBuilder(s: BuilderState): string | null {
  if (!s.name.trim()) return `Enter a name for the ${s.kind}.`
  try {
    toSlug(s.name)
    validateSpecs(s.fields)
  } catch (err) {
    return message(err)
  }
  const hasTitle = s.kind === 'collection' || (s.kind === 'global' && !s.globalShared)
  if (hasTitle && s.useAsTitle && s.useAsTitle !== 'id') {
    const names = s.fields.length ? s.fields.map((f) => f.name) : ['title']
    if (!names.includes(s.useAsTitle)) {
      return `useAsTitle "${s.useAsTitle}" is not one of the fields (${names.join(', ')}).`
    }
  }
  return null
}

/** The TypeScript that `generate` would write for this state (same renderer as the command). */
export function previewSource(s: BuilderState): string {
  if (!s.name.trim()) return `// Enter a name to preview the generated ${s.kind}.`
  try {
    return renderGenerated({
      kind: s.kind,
      name: s.name,
      fields: s.fields,
      useAsTitle: s.useAsTitle,
      access: s.access,
      globalShared: s.globalShared,
    }).content
  } catch (err) {
    return `// ${message(err)}`
  }
}
