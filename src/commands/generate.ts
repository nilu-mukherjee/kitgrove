import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { Command } from 'commander'
import {
  type AccessRules,
  ACCESS_OPS,
  ACCESS_RULES,
  ensureAccessHelpers,
  parseAccessFlag,
  renderAccessBlock,
} from '../core/access.js'
import { registerInConfig } from '../core/codemod.js'
import { CliError } from '../core/errors.js'
import * as p from '@clack/prompts'
import {
  FIELD_TYPES,
  type FieldSpec,
  type FieldType,
  collectBlocks,
  collectRelations,
  parseFieldSpecs,
  pickTitleField,
  renderFields,
  supportsOption,
  supportsRequired,
  validateSpecs,
} from '../core/fields.js'
import { templatesDir } from '../core/paths.js'
import { requireProject } from '../core/project.js'
import { renderString, toCamel, toPascal, toSlug } from '../core/template.js'

export const KINDS = ['collection', 'global', 'block', 'field', 'hook', 'access'] as const
export type GenerateKind = (typeof KINDS)[number]

export interface GenerateOptions {
  cwd: string
  globalShared?: boolean
  force?: boolean
  dryRun?: boolean
  /** Fields for collection/global/block; empty or omitted gives a single `title` field. */
  fields?: FieldSpec[]
  /** Field shown as the document title in the admin. Must be a top-level field, `id`, or the default `title`. */
  useAsTitle?: string
  /** Access rules for collections and per-tenant globals; omit for the default (`read: tenantScoped`). */
  access?: AccessRules
}

export interface GenerateResult {
  /** Paths written (or planned, with dryRun), relative to the project root. */
  files: string[]
  /** True when the config was edited to register the new collection/global. */
  registered: boolean
  manualInstructions?: string
}

const BUILT_IN_SLUGS = new Set([
  'users',
  'tenants',
  'media',
  'forms',
  'form-submissions',
  'payload-preferences',
  'payload-migrations',
  'payload-locked-documents',
])

const RESERVED_WORDS = new Set(
  'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof var void while with yield'.split(
    ' ',
  ),
)

const OUT_DIR: Record<GenerateKind, string> = {
  collection: 'collections',
  global: 'globals',
  block: 'blocks',
  field: 'fields',
  hook: 'hooks',
  access: 'access',
}

function slugExists(srcDir: string, slug: string, ignore: string): boolean {
  const pattern = new RegExp(`\\bslug:\\s*['"]${slug}['"]`)
  return ['collections', 'globals'].some((dir) => {
    const full = join(srcDir, dir)
    if (!existsSync(full)) return false
    return readdirSync(full)
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => join(full, f))
      .filter((f) => f !== ignore)
      .some((f) => pattern.test(readFileSync(f, 'utf8')))
  })
}

export async function runGenerate(
  kind: GenerateKind,
  name: string,
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const project = requireProject(opts.cwd)
  const srcDir = dirname(project.configPath)
  const slug = toSlug(name)
  const Name = toPascal(slug)
  const lower = toCamel(slug)

  const identifiable = kind === 'field' || kind === 'hook' || kind === 'access'
  if (identifiable && RESERVED_WORDS.has(lower)) {
    throw new CliError(`"${lower}" is a reserved word and cannot be used as an identifier.`)
  }

  // A shared global is a real Payload global; everything else generated as a collection.
  const isSharedGlobal = kind === 'global' && Boolean(opts.globalShared)
  const isCollectionLike = kind === 'collection' || (kind === 'global' && !isSharedGlobal)
  const tenantScoped = isCollectionLike && !opts.globalShared
  const isGlobal = kind === 'global' && !isSharedGlobal

  const outDir = join(srcDir, isCollectionLike ? 'collections' : OUT_DIR[kind])
  const fileName = `${identifiable ? lower : Name}.ts`
  const target = join(outDir, fileName)
  const rel = relative(project.root, target)

  if (kind === 'collection' || kind === 'global') {
    if (BUILT_IN_SLUGS.has(slug) || slugExists(srcDir, slug, opts.force ? target : '')) {
      throw new CliError(`A collection or global with slug "${slug}" already exists.`)
    }
  }
  const rules = opts.access ?? {}
  const hasRules = ACCESS_OPS.some((op) => rules[op])
  if (hasRules && !isCollectionLike) {
    throw new CliError(`--access only applies to collections and per-tenant globals, not ${isSharedGlobal ? 'shared globals' : `${kind}s`}.`)
  }
  const effectiveRules: AccessRules = hasRules ? rules : tenantScoped ? { read: 'tenant-scoped' } : {}
  const { block: accessBlock, imports: accessImports } = renderAccessBlock(effectiveRules)

  const hasFields = kind === 'collection' || kind === 'global' || kind === 'block'
  const fields = opts.fields ?? []
  if (fields.length > 0 && !hasFields) {
    throw new CliError(`--fields only applies to collection, global and block, not ${kind}.`)
  }
  if (opts.useAsTitle !== undefined) {
    const known = fields.length ? fields.map((f) => f.name) : ['title']
    if (opts.useAsTitle !== 'id' && !known.includes(opts.useAsTitle)) {
      throw new CliError(
        `useAsTitle "${opts.useAsTitle}" is not one of the fields (${known.join(', ')}); add that field or pick one of these.`,
      )
    }
  }
  for (const { field, collection } of collectRelations(fields)) {
    if (collection !== slug && !BUILT_IN_SLUGS.has(collection) && !slugExists(srcDir, collection, '')) {
      throw new CliError(
        `Field "${field}" points to "${collection}", which does not exist in this project — generate it first (paycms generate collection ${collection}).`,
      )
    }
  }
  const blockSlugs = collectBlocks(fields)
  for (const b of blockSlugs) {
    if (!existsSync(join(srcDir, 'blocks', `${toPascal(b)}.ts`))) {
      throw new CliError(
        `Field uses block "${b}", which does not exist in this project — generate it first (paycms generate block ${b}).`,
      )
    }
  }
  // Blocks generated into src/blocks sit next to each other; everything else is one level deeper.
  const blockBase = kind === 'block' ? '.' : '../blocks'
  const imports = blockSlugs
    .map((b) => `import { ${toPascal(b)} } from '${blockBase}/${toPascal(b)}'\n`)
    .join('')
  if (existsSync(target) && !opts.force) {
    throw new CliError(`Refusing to overwrite ${rel} (use --force).`)
  }

  const snippet = isSharedGlobal ? 'global' : isCollectionLike ? 'collection' : kind
  const source = readFileSync(join(templatesDir(), 'snippets', `${snippet}.ts.tpl`), 'utf8')
  const content = renderString(source, {
    Name,
    camel: lower,
    slug,
    tenantScoped,
    isGlobal,
    accessBlock,
    accessImports,
    hasAccessImports: accessImports !== '',
    imports,
    titleField: opts.useAsTitle ?? pickTitleField(fields),
    fields: renderFields(
      fields.length > 0 ? fields : parseFieldSpecs(kind === 'collection' || isGlobal ? 'title:text!' : 'title:text'),
    ),
  })

  if (opts.dryRun) return { files: [rel], registered: false }

  mkdirSync(outDir, { recursive: true })
  writeFileSync(target, content)
  const helpers = hasRules ? ensureAccessHelpers(srcDir, rules).map((f) => relative(project.root, join(srcDir, f))) : []

  if (kind !== 'collection' && kind !== 'global') return { files: [rel], registered: false }
  const files = [rel, ...helpers]

  const result = registerInConfig(project.configPath, {
    kind: isSharedGlobal ? 'global' : 'collection',
    slug,
    importName: Name,
    importPath: `./${OUT_DIR[isCollectionLike ? 'collection' : 'global']}/${Name}`,
    tenantScoped,
    isGlobal,
  })
  return result.ok
    ? { files, registered: true }
    : { files, registered: false, manualInstructions: result.manualInstructions }
}

export interface GenerateFlags {
  globalShared?: boolean
  force?: boolean
  dryRun?: boolean
  fields?: string
  useAsTitle?: boolean | string
  access?: string
  yes?: boolean
}

/** Shared by `paycms generate <kind> [name]` and `paycms create <kind> [name]`. */
export async function handleGenerate(kind: string, nameArg: string | undefined, o: GenerateFlags): Promise<void> {
  if (!(KINDS as readonly string[]).includes(kind)) {
    throw new CliError(`Unknown kind "${kind}". Choose one of: ${KINDS.join(', ')}.`)
  }
  const project = requireProject(process.cwd())
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !o.yes && !o.dryRun)

  let name = nameArg
  if (!name) {
    if (!interactive) {
      throw new CliError(`A ${kind} name is required: paycms generate ${kind} <name>.`)
    }
    const answer = await p.text({ message: `${kind[0]!.toUpperCase()}${kind.slice(1)} name`, placeholder: 'e.g. Case Studies' })
    bail(answer)
    name = String(answer ?? '').trim()
    if (!name) throw new CliError(`A ${kind} name is required.`)
  }

  const takesFields = ['collection', 'global', 'block'].includes(kind)
  const hasTitle = kind === 'collection' || (kind === 'global' && !o.globalShared)
  let fields = o.fields ? parseFieldSpecs(o.fields) : []
  let access: AccessRules | undefined = o.access ? parseAccessFlag(o.access) : undefined
  let useAsTitle = typeof o.useAsTitle === 'string' ? o.useAsTitle : undefined

  if (takesFields && !o.fields && interactive) {
    const ctx = discover(dirname(project.configPath))
    const seed: FieldSpec[] = []
    if (hasTitle) {
      const title = await p.text({
        message: 'useAsTitle: which field names a document in the admin?',
        initialValue: 'title',
        validate: (v) => (/^[A-Za-z_$][\w$]*$/.test(v ?? '') ? undefined : 'Use a valid field name, e.g. title'),
      })
      bail(title)
      useAsTitle = String(title)
      p.log.info(`Now define "${useAsTitle}", then any other fields.`)
      for (;;) {
        const first = await promptField(ctx, useAsTitle, ['text', 'email', 'textarea', 'number'])
        if (first) {
          seed.push(first)
          break
        }
      }
    }
    fields = await promptFields(ctx, null, 0, seed)
    if (hasTitle && !o.access) access = await promptAccess()
  }

  const result = await runGenerate(kind as GenerateKind, name, {
    globalShared: o.globalShared,
    force: o.force,
    dryRun: o.dryRun,
    fields,
    useAsTitle,
    access,
    cwd: process.cwd(),
  })
  for (const f of result.files) console.log(`${o.dryRun ? 'Would create' : 'Created'} ${f}`)
  if (result.registered) console.log('Registered in payload.config.ts')
  if (result.manualInstructions) {
    console.error(`\n${result.manualInstructions}`)
    process.exitCode = 1
  } else if (!result.registered && !o.dryRun && ['block', 'field', 'hook', 'access'].includes(kind)) {
    console.log(`Import it where you need it, e.g. in a collection's \`fields\`, \`hooks\` or \`access\`.`)
  }
}

export function registerGenerate(program: Command): void {
  program
    .command('generate <kind> [name]')
    .alias('g')
    .description(`Generate code into a project (${KINDS.join(', ')})`)
    .option('--global-shared', 'collection: not tenant-scoped; global: a real Payload global shared by all tenants')
    .option('-f, --force', 'overwrite an existing file')
    .option('--dry-run', 'show what would be created')
    .option('--fields <spec>', 'fields for collection/global/block, e.g. "title:text![unique],status:select:draft|live[default=draft]"')
    .option('--use-as-title <field>', 'field that names a document in the admin (default: title)')
    .option('--access <rules>', 'access rules, e.g. read=public,update=tenant-editor')
    .option('-y, --yes', 'do not prompt')
    .action((kind: string, name: string | undefined, o: GenerateFlags) => handleGenerate(kind, name, o))
}

interface PromptContext {
  /** Collection slugs a relationship, upload or join can point at. */
  collections: string[]
  /** Slugs of blocks that exist in src/blocks. */
  blocks: string[]
}

function discover(srcDir: string): PromptContext {
  const collections = new Set(['users', 'media'])
  const collectionsDir = join(srcDir, 'collections')
  if (existsSync(collectionsDir)) {
    for (const f of readdirSync(collectionsDir).filter((n) => /\.tsx?$/.test(n))) {
      const m = /\bslug:\s*['"]([^'"]+)['"]/.exec(readFileSync(join(collectionsDir, f), 'utf8'))
      if (m) collections.add(m[1]!)
    }
  }
  const blocksDir = join(srcDir, 'blocks')
  const blocks = existsSync(blocksDir)
    ? readdirSync(blocksDir)
        .filter((n) => /\.tsx?$/.test(n))
        .map((n) => toSlug(n.replace(/\.tsx?$/, '')))
    : []
  return { collections: [...collections].sort(), blocks }
}

const TYPE_HINTS: Partial<Record<FieldType, string>> = {
  array: 'repeatable rows of fields',
  blocks: 'pick from your block types',
  collapsible: 'collapsible section (layout only)',
  group: 'named group of fields',
  join: 'reverse relationship, read-only',
  point: 'geographic coordinates',
  radio: 'choose one option',
  row: 'fields side by side (layout only)',
  tabs: 'tabs (layout only)',
  ui: 'custom component, stores no data',
}

function bail(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel('Cancelled.')
    process.exit(1)
  }
}

async function askText(message: string, validate?: (v: string) => string | undefined): Promise<string | undefined> {
  const v = await p.text({ message, validate: (x) => (x ? validate?.(x) : undefined) })
  bail(v)
  const t = String(v ?? '').trim()
  return t || undefined
}

async function askConfirm(message: string): Promise<boolean> {
  const v = await p.confirm({ message, initialValue: false })
  bail(v)
  return Boolean(v)
}

const numeric = (v: string) => (Number.isFinite(Number(v)) ? undefined : 'Enter a number')

/**
 * One field: type (unless fixed), whatever the type needs, then required, unique and default value,
 * and finally the optional extras behind a single confirm. Returns null if the field was dropped.
 */
async function promptField(
  ctx: PromptContext,
  name: string,
  typeChoices?: FieldType[],
): Promise<FieldSpec | null> {
  const type = (await p.select({
    message: `Type of "${name}"`,
    options: (typeChoices ?? FIELD_TYPES).map((t) => ({ value: t, label: t, hint: TYPE_HINTS[t] })),
  })) as FieldType
  bail(type)

  const spec: FieldSpec = { name, type, required: false }

  if (type === 'select' || type === 'radio') {
    const options = await p.text({ message: 'Options, separated by |', placeholder: 'draft|published' })
    bail(options)
    spec.options = String(options).split('|').map((o) => o.trim()).filter(Boolean)
  } else if (type === 'upload' || type === 'relationship') {
    if (!ctx.collections.length) {
      p.log.error('No collections to point at yet.')
      return null
    }
    const target = await p.select({
      message: 'Target collection',
      options: ctx.collections.map((c) => ({ value: c, label: c })),
      initialValue: type === 'upload' && ctx.collections.includes('media') ? 'media' : undefined,
    })
    bail(target)
    spec.relationTo = String(target)
  } else if (type === 'join') {
    const collection = await p.select({
      message: 'Collection that holds the relationship',
      options: ctx.collections.map((c) => ({ value: c, label: c })),
    })
    bail(collection)
    const on = await askText(`Field in "${String(collection)}" that points back here`)
    if (!on) return null
    spec.join = { collection: String(collection), on }
  } else if (type === 'blocks') {
    if (!ctx.blocks.length) {
      p.log.error('No blocks yet. Run `paycms generate block <name>` first.')
      return null
    }
    const picked = await p.multiselect({
      message: 'Allowed blocks',
      options: ctx.blocks.map((b) => ({ value: b, label: b })),
      required: true,
    })
    bail(picked)
    spec.blocks = picked as string[]
  } else if (type === 'array' || type === 'group' || type === 'row' || type === 'collapsible') {
    spec.fields = await promptFields(ctx, name, 1)
  } else if (type === 'tabs') {
    spec.tabs = []
    for (;;) {
      const label = await askText(`Tab label in "${name}" (leave empty when done)`)
      if (!label) {
        if (spec.tabs.length) break
        p.log.error('Add at least one tab.')
        continue
      }
      spec.tabs.push({ label, fields: await promptFields(ctx, label, 1) })
    }
  }

  if (supportsRequired(type)) spec.required = await askConfirm('Required?')
  if (supportsOption(type, 'unique')) spec.unique = (await askConfirm('Unique?')) || undefined

  if (supportsOption(type, 'defaultValue')) {
    if (type === 'checkbox') {
      if (await askConfirm('Checked by default?')) spec.defaultValue = true
    } else if (type === 'date') {
      if (await askConfirm('Default to the current date/time?')) spec.defaultValue = 'now'
    } else if (type === 'select' || type === 'radio') {
      const d = await p.select({
        message: 'Default value',
        options: [{ value: '', label: '(none)' }, ...spec.options!.map((o) => ({ value: o, label: o }))],
      })
      bail(d)
      if (d) spec.defaultValue = String(d)
    } else if (type === 'number') {
      const d = await askText('Default value (leave empty for none)', numeric)
      if (d !== undefined) spec.defaultValue = Number(d)
    } else {
      const d = await askText('Default value (leave empty for none)')
      if (d !== undefined) spec.defaultValue = d
    }
  }

  const more = [
    'label', 'description', 'position', 'readOnly', 'index', 'hasMany', 'min', 'max', 'minLength', 'maxLength',
  ] as const
  if (more.some((o) => supportsOption(type, o)) && (await askConfirm('Configure more options (label, description, index, limits…)?'))) {
    if (supportsOption(type, 'label')) spec.label = await askText('Label (leave empty for the default)')
    if (supportsOption(type, 'description')) spec.description = await askText('Description shown under the field')
    if (supportsOption(type, 'position')) {
      const pos = await p.select({
        message: 'Admin position',
        options: [
          { value: 'main', label: 'main' },
          { value: 'sidebar', label: 'sidebar' },
        ],
      })
      bail(pos)
      if (pos === 'sidebar') spec.position = 'sidebar'
    }
    if (supportsOption(type, 'readOnly') && (await askConfirm('Read-only in the admin?'))) spec.readOnly = true
    if (supportsOption(type, 'index') && (await askConfirm('Index in the database?'))) spec.index = true
    if (supportsOption(type, 'hasMany') && (await askConfirm('Allow multiple values (hasMany)?'))) {
      spec.hasMany = true
      if (spec.unique || spec.defaultValue !== undefined) {
        p.log.warn('hasMany cannot be combined with unique or a default value; those were dropped.')
        spec.unique = undefined
        spec.defaultValue = undefined
      }
    }
    if (supportsOption(type, 'min')) {
      const v = await askText('Minimum value', numeric)
      if (v !== undefined) spec.min = Number(v)
    }
    if (supportsOption(type, 'max')) {
      const v = await askText('Maximum value', numeric)
      if (v !== undefined) spec.max = Number(v)
    }
    if (supportsOption(type, 'minLength')) {
      const v = await askText('Minimum length', numeric)
      if (v !== undefined) spec.minLength = Number(v)
    }
    if (supportsOption(type, 'maxLength')) {
      const v = await askText('Maximum length', numeric)
      if (v !== undefined) spec.maxLength = Number(v)
    }
  }
  return spec
}

/**
 * Asks for fields one at a time; an empty name finishes. Container types recurse.
 * `seed` fields (already defined) are kept and included in the result.
 */
async function promptFields(
  ctx: PromptContext,
  scope: string | null,
  minimum: number,
  seed: FieldSpec[] = [],
): Promise<FieldSpec[]> {
  const specs: FieldSpec[] = [...seed]

  for (;;) {
    const message = scope
      ? `Field name inside "${scope}" (leave empty when done)`
      : specs.length
        ? 'Next field name (leave empty to finish)'
        : 'Field name (leave empty for just a `title` field)'
    const name = await askText(message)
    if (!name) {
      if (specs.length >= minimum) break
      p.log.error(`Add at least ${minimum} field${minimum > 1 ? 's' : ''}.`)
      continue
    }
    const spec = await promptField(ctx, name)
    if (!spec) continue
    try {
      validateSpecs([...specs, spec])
      specs.push(spec)
    } catch (err) {
      p.log.error(err instanceof CliError ? err.message : String(err))
    }
  }
  return specs
}

/** Optional per-operation rules for a new collection; returns undefined to keep the default. */
async function promptAccess(): Promise<AccessRules | undefined> {
  if (!(await askConfirm('Configure access rules? (default: signed-in users filtered by tenant, public read for open tenants)'))) {
    return undefined
  }
  const rules: AccessRules = {}
  for (const op of ACCESS_OPS) {
    const rule = await p.select({
      message: `Who can ${op}?`,
      options: [
        { value: '', label: '(default)' },
        ...ACCESS_RULES.map((r) => ({ value: r, label: r })),
      ],
    })
    bail(rule)
    if (rule) rules[op] = String(rule) as AccessRules[typeof op]
  }
  return ACCESS_OPS.some((op) => rules[op]) ? rules : undefined
}
