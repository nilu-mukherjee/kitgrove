import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { Command } from 'commander'
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
  const hasFields = kind === 'collection' || kind === 'global' || kind === 'block'
  const fields = opts.fields ?? []
  if (fields.length > 0 && !hasFields) {
    throw new CliError(`--fields only applies to collection, global and block, not ${kind}.`)
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
    imports,
    titleField: pickTitleField(fields),
    fields: renderFields(
      fields.length > 0 ? fields : parseFieldSpecs(kind === 'collection' || isGlobal ? 'title:text!' : 'title:text'),
    ),
  })

  if (opts.dryRun) return { files: [rel], registered: false }

  mkdirSync(outDir, { recursive: true })
  writeFileSync(target, content)

  if (kind !== 'collection' && kind !== 'global') return { files: [rel], registered: false }

  const result = registerInConfig(project.configPath, {
    kind: isSharedGlobal ? 'global' : 'collection',
    slug,
    importName: Name,
    importPath: `./${OUT_DIR[isCollectionLike ? 'collection' : 'global']}/${Name}`,
    tenantScoped,
    isGlobal,
  })
  return result.ok
    ? { files: [rel], registered: true }
    : { files: [rel], registered: false, manualInstructions: result.manualInstructions }
}

export function registerGenerate(program: Command): void {
  program
    .command('generate <kind> <name>')
    .alias('g')
    .description(`Generate code into a project (${KINDS.join(', ')})`)
    .option('--global-shared', 'collection: not tenant-scoped; global: a real Payload global shared by all tenants')
    .option('-f, --force', 'overwrite an existing file')
    .option('--dry-run', 'show what would be created')
    .option('--fields <spec>', 'fields for collection/global/block, e.g. "title:text!,image:upload:media,status:select:draft|live"')
    .option('-y, --yes', 'do not prompt for fields')
    .action(
      async (
        kind: string,
        name: string,
        o: { globalShared?: boolean; force?: boolean; dryRun?: boolean; fields?: string; yes?: boolean },
      ) => {
        if (!(KINDS as readonly string[]).includes(kind)) {
          throw new CliError(`Unknown kind "${kind}". Choose one of: ${KINDS.join(', ')}.`)
        }
        const takesFields = ['collection', 'global', 'block'].includes(kind)
        let fields = o.fields ? parseFieldSpecs(o.fields) : []
        const interactive = process.stdin.isTTY && process.stdout.isTTY && !o.yes && !o.dryRun
        if (takesFields && !o.fields && interactive) {
          const project = requireProject(process.cwd())
          fields = await promptFields(discover(dirname(project.configPath)), null, 0)
        }
        const result = await runGenerate(kind as GenerateKind, name, {
          globalShared: o.globalShared,
          force: o.force,
          dryRun: o.dryRun,
          fields,
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
      },
    )
}

interface PromptContext {
  /** Collection slugs a relationship, upload or join can point at. */
  collections: string[]
  /** Slugs of blocks that exist in src/blocks. */
  blocks: string[]
}

function discover(srcDir: string): PromptContext {
  const collections = new Set(['users', 'media'])
  for (const dir of ['collections', 'globals']) {
    const full = join(srcDir, dir)
    if (!existsSync(full)) continue
    for (const f of readdirSync(full).filter((n) => /\.tsx?$/.test(n))) {
      const m = /\bslug:\s*['"]([^'"]+)['"]/.exec(readFileSync(join(full, f), 'utf8'))
      if (m && dir === 'collections') collections.add(m[1]!)
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

/**
 * Asks for fields one at a time (name, type, then whatever that type needs, then required);
 * an empty name finishes. Container types recurse. Returns [] for "just the default title field".
 */
async function promptFields(ctx: PromptContext, scope: string | null, minimum: number): Promise<FieldSpec[]> {
  const specs: FieldSpec[] = []

  for (;;) {
    const message = scope
      ? `Field name inside "${scope}" (leave empty when done)`
      : specs.length
        ? 'Next field name (leave empty to finish)'
        : 'Field name (leave empty for just a `title` field)'
    const rawName = await p.text({ message, placeholder: 'e.g. client' })
    bail(rawName)
    const name = String(rawName ?? '').trim()
    if (!name) {
      if (specs.length >= minimum) break
      p.log.error(`Add at least ${minimum} field${minimum > 1 ? 's' : ''}.`)
      continue
    }

    const type = (await p.select({
      message: `Type of "${name}"`,
      options: FIELD_TYPES.map((t) => ({ value: t, label: t, hint: TYPE_HINTS[t] })),
    })) as FieldType
    bail(type)

    const spec: FieldSpec = { name, type, required: false }
    let skip = false

    if (type === 'select' || type === 'radio') {
      const options = await p.text({ message: 'Options, separated by |', placeholder: 'draft|published' })
      bail(options)
      spec.options = String(options).split('|').map((o) => o.trim()).filter(Boolean)
    } else if (type === 'upload' || type === 'relationship') {
      if (!ctx.collections.length) {
        p.log.error('No collections to point at yet.')
        skip = true
      } else {
        const target = await p.select({
          message: 'Target collection',
          options: ctx.collections.map((c) => ({ value: c, label: c })),
          initialValue: type === 'upload' && ctx.collections.includes('media') ? 'media' : undefined,
        })
        bail(target)
        spec.relationTo = String(target)
      }
    } else if (type === 'join') {
      const collection = await p.select({
        message: 'Collection that holds the relationship',
        options: ctx.collections.map((c) => ({ value: c, label: c })),
      })
      bail(collection)
      const on = await p.text({ message: `Field in "${String(collection)}" that points back here`, placeholder: 'category' })
      bail(on)
      spec.join = { collection: String(collection), on: String(on).trim() }
    } else if (type === 'blocks') {
      if (!ctx.blocks.length) {
        p.log.error('No blocks yet. Run `paycms generate block <name>` first.')
        skip = true
      } else {
        const picked = await p.multiselect({
          message: 'Allowed blocks',
          options: ctx.blocks.map((b) => ({ value: b, label: b })),
          required: true,
        })
        bail(picked)
        spec.blocks = picked as string[]
      }
    } else if (type === 'array' || type === 'group' || type === 'row' || type === 'collapsible') {
      spec.fields = await promptFields(ctx, name, 1)
    } else if (type === 'tabs') {
      spec.tabs = []
      for (;;) {
        const label = await p.text({
          message: `Tab label in "${name}" (leave empty when done)`,
          placeholder: 'e.g. Content',
        })
        bail(label)
        const text = String(label ?? '').trim()
        if (!text) {
          if (spec.tabs.length) break
          p.log.error('Add at least one tab.')
          continue
        }
        spec.tabs.push({ label: text, fields: await promptFields(ctx, text, 1) })
      }
    }

    if (skip) continue
    if (supportsRequired(type)) {
      const required = await p.confirm({ message: 'Required?', initialValue: false })
      bail(required)
      spec.required = Boolean(required)
    }

    try {
      validateSpecs([...specs, spec])
      specs.push(spec)
    } catch (err) {
      p.log.error(err instanceof CliError ? err.message : String(err))
    }
  }
  return specs
}
