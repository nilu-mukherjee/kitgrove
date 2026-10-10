import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import type { Command } from 'commander'
import { CliError } from '../core/errors.js'
import { run } from '../core/exec.js'
import { templatesDir } from '../core/paths.js'
import type { PackageManager } from '../core/project.js'
import { renderTemplateDir, toSlug } from '../core/template.js'
import { KINDS, handleGenerate, type GenerateFlags } from './generate.js'

export const TEMPLATES = ['blank', 'blog', 'corporate'] as const
export const DATABASES = ['postgres', 'mongodb'] as const
export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn'] as const

export type TemplateName = (typeof TEMPLATES)[number]
export type Database = (typeof DATABASES)[number]

/** Every @payloadcms/* package and payload itself are pinned to this one version. */
export const PAYLOAD_VERSION = '3.90.2'

/** Templates layered in order; later ones only add files (the config is shared and conditional). */
const CHAIN: Record<TemplateName, string[]> = {
  blank: ['blank'],
  blog: ['blank', 'blog'],
  corporate: ['blank', 'blog', 'corporate'],
}

/** Files that only the demo frontend uses; omitted from headless projects. */
const FRONTEND_PREFIXES = ['src/app/(frontend)/', 'src/lib/tenant.ts', 'src/lib/currentTenant.ts', 'src/components/']
const isFrontendFile = (rel: string) => FRONTEND_PREFIXES.some((p) => rel.startsWith(p))

const DB_VARS: Record<Database, Record<string, string | boolean>> = {
  postgres: {
    postgres: true,
    mongodb: false,
    dbAdapterPackage: '@payloadcms/db-postgres',
    databaseUriExample: 'postgres://postgres:postgres@127.0.0.1:5432/your-database-name',
  },
  mongodb: {
    postgres: false,
    mongodb: true,
    dbAdapterPackage: '@payloadcms/db-mongodb',
    databaseUriExample: 'mongodb://127.0.0.1/your-database-name',
  },
}

export interface CreateOptions {
  name: string
  template: TemplateName
  db: Database
  pm: PackageManager
  yes?: boolean
  dryRun?: boolean
  install?: boolean
  /** Backend only: no demo frontend; API keys and CORS are enabled for sites calling the API. */
  headless?: boolean
  cwd: string
}

/** Scaffolds a project into `<cwd>/<slug>` and returns the relative paths written. */
export async function runCreate(opts: CreateOptions): Promise<string[]> {
  if (!TEMPLATES.includes(opts.template)) {
    throw new CliError(`Unknown template "${opts.template}". Choose one of: ${TEMPLATES.join(', ')}.`)
  }
  if (!DATABASES.includes(opts.db)) {
    throw new CliError(`Unknown database "${opts.db}". Choose one of: ${DATABASES.join(', ')}.`)
  }
  const slug = toSlug(opts.name)
  const target = join(opts.cwd, slug)
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new CliError(`Target directory "${slug}" already exists and is not empty.`)
  }

  const vars = {
    name: slug,
    payloadVersion: PAYLOAD_VERSION,
    blog: opts.template !== 'blank',
    corporate: opts.template === 'corporate',
    headless: Boolean(opts.headless),
    frontend: !opts.headless,
    ...DB_VARS[opts.db],
  }

  const written = new Set<string>()
  for (const layer of CHAIN[opts.template]) {
    const src = join(templatesDir(), 'projects', layer)
    // Layers only add files; `force` lets a later layer replace a file an earlier one wrote.
    for (const f of renderTemplateDir(src, target, vars, {
        dryRun: opts.dryRun,
        force: written.size > 0,
        exclude: opts.headless ? isFrontendFile : undefined,
      })) {
      written.add(f)
    }
  }

  if (opts.install !== false && !opts.dryRun) {
    const code = await run(opts.pm, ['install'], target)
    if (code !== 0) throw new CliError(`"${opts.pm} install" failed with exit code ${code}.`)
  }
  return [...written]
}

export function detectPackageManager(): PackageManager {
  const agent = process.env.npm_config_user_agent ?? ''
  if (agent.startsWith('pnpm')) return 'pnpm'
  if (agent.startsWith('yarn')) return 'yarn'
  return 'npm'
}

function ensure<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('Cancelled.')
    process.exit(1)
  }
  return value as T
}

export function registerCreate(program: Command): void {
  program
    .command('create [what] [name]')
    .description(
      'Scaffold a multi-tenant project (create <name>) or generate code (create collection|global|block|field|hook|access [name])',
    )
    .option('-t, --template <template>', `project template (${TEMPLATES.join('|')})`)
    .option('-d, --db <db>', `project database (${DATABASES.join('|')})`)
    .option('--pm <pm>', `package manager (${PACKAGE_MANAGERS.join('|')})`)
    .option('-y, --yes', 'accept defaults, no prompts')
    .option('--no-install', 'skip installing dependencies')
    .option('--headless', 'project: backend only (no demo frontend); enables API keys and CORS')
    .option('--dry-run', 'list the files that would be created')
    .option('--fields <spec>', 'fields for collection/global/block, e.g. "title:text![unique]"')
    .option('--use-as-title <field>', 'collection: field that names a document in the admin')
    .option('--access <rules>', 'collection: access rules, e.g. read=public,update=tenant-editor')
    .option('--global-shared', 'collection/global: not tenant-scoped / a real shared global')
    .option('-f, --force', 'overwrite an existing file')
    .action(async (what: string | undefined, nameArg: string | undefined, o: Record<string, string | boolean | undefined>) => {
      const interactive = Boolean(!o.yes && process.stdin.isTTY && process.stdout.isTTY)
      let first = what
      if (!first) {
        if (!interactive) {
          throw new CliError('Usage: kitgrove create <project-name>  |  kitgrove create collection [name]')
        }
        const choice = await p.select({
          message: 'What do you want to create?',
          options: ['project', ...KINDS].map((value) => ({ value, label: value })),
        })
        ensure(choice)
        first = String(choice)
      }

      if ((KINDS as readonly string[]).includes(first)) {
        await handleGenerate(first, nameArg, o as GenerateFlags)
        return
      }

      // `kitgrove create project [name]` is accepted too; otherwise the first argument is the name.
      let name = first === 'project' ? nameArg : first
      if (!name) {
        if (!interactive) throw new CliError('A project name is required: kitgrove create <name>.')
        name = String(ensure(await p.text({ message: 'Project name', placeholder: 'my-sites' })) ?? '').trim()
        if (!name) throw new CliError('A project name is required.')
      }
      await createProject(name, o)
    })
}

async function createProject(name: string, o: Record<string, string | boolean | undefined>): Promise<void> {
  const interactive = Boolean(!o.yes && process.stdin.isTTY && process.stdout.isTTY)
  const template =
    (o.template as TemplateName) ??
    (interactive
      ? ensure(
          await p.select({
            message: 'Template',
            options: TEMPLATES.map((value) => ({ value, label: value })),
          }),
        )
      : 'blank')
  const db =
    (o.db as Database) ??
    (interactive
      ? ensure(
          await p.select({
            message: 'Database',
            options: DATABASES.map((value) => ({ value, label: value })),
          }),
        )
      : 'postgres')
  const headless =
    o.headless !== undefined
      ? Boolean(o.headless)
      : interactive
        ? (ensure(
            await p.select<boolean>({
              message: 'Frontend',
              options: [
                { value: false, label: 'Demo frontend', hint: 'a small Next.js site per tenant' },
                { value: true, label: 'Headless', hint: 'API only: sites call REST/GraphQL' },
              ],
            }),
          ) as boolean)
        : false
  const files = await runCreate({
    name,
    template,
    db,
    headless,
    pm: (o.pm as PackageManager) ?? detectPackageManager(),
    yes: Boolean(o.yes),
    dryRun: Boolean(o.dryRun),
    install: o.install !== false,
    cwd: process.cwd(),
  })
  if (o.dryRun) console.log(files.map((f) => `  ${f}`).join('\n'))
  else {
    console.log(
      `\nCreated ${toSlug(name)}/. Next: cd ${toSlug(name)} && cp .env.example .env && ${detectPackageManager()} run dev`,
    )
  }
}
