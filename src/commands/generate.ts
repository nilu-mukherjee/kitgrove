import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { Command } from 'commander'
import { registerInConfig } from '../core/codemod.js'
import { CliError } from '../core/errors.js'
import { templatesDir } from '../core/paths.js'
import { requireProject } from '../core/project.js'
import { renderString, toSlug } from '../core/template.js'

export const KINDS = ['collection', 'global', 'block', 'field', 'hook', 'access'] as const
export type GenerateKind = (typeof KINDS)[number]

export interface GenerateOptions {
  cwd: string
  globalShared?: boolean
  force?: boolean
  dryRun?: boolean
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

const pascal = (slug: string) =>
  slug
    .split('-')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('')

const camel = (slug: string) => {
  const p = pascal(slug)
  return p[0]!.toLowerCase() + p.slice(1)
}

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
  const Name = pascal(slug)
  const lower = camel(slug)

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
    .action(
      async (
        kind: string,
        name: string,
        o: { globalShared?: boolean; force?: boolean; dryRun?: boolean },
      ) => {
        if (!(KINDS as readonly string[]).includes(kind)) {
          throw new CliError(`Unknown kind "${kind}". Choose one of: ${KINDS.join(', ')}.`)
        }
        const result = await runGenerate(kind as GenerateKind, name, { ...o, cwd: process.cwd() })
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
