import { dirname, relative } from 'node:path'
import type { Command } from 'commander'
import {
  ACCESS_OPS,
  type AccessOp,
  type AccessRules,
  ensureAccessHelpers,
  readAccess,
  setAccess,
  validateRule,
} from '../core/access.js'
import { CliError } from '../core/errors.js'
import { findCollectionFile, listCollectionFiles } from '../core/project-scan.js'
import { requireProject } from '../core/project.js'

export interface AccessSetResult {
  /** Path of the edited file, relative to the project root. */
  file: string
  /** Helper files created because the project lacked them (relative to the project root). */
  created: string[]
  manualInstructions?: string
}

export async function runAccessSet(opts: {
  cwd: string
  collection: string
  rules: AccessRules
}): Promise<AccessSetResult> {
  const project = requireProject(opts.cwd)
  const srcDir = dirname(project.configPath)
  if (!ACCESS_OPS.some((op) => opts.rules[op])) {
    throw new CliError('Give at least one of --read, --create, --update, --delete.')
  }
  const found = findCollectionFile(srcDir, opts.collection)
  if (!found) {
    const existing = listCollectionFiles(srcDir).map((c) => c.slug)
    throw new CliError(`No collection "${opts.collection}" in this project. Existing: ${existing.join(', ') || '(none)'}.`)
  }
  const file = relative(project.root, found.file)
  const result = setAccess(found.file, opts.rules)
  if (!result.ok) return { file, created: [], manualInstructions: result.manualInstructions }
  const created = ensureAccessHelpers(srcDir, opts.rules).map((f) => relative(project.root, `${srcDir}/${f}`))
  return { file, created }
}

export interface AccessShowRow {
  collection: string
  file: string
  rules: AccessRules
  custom: Partial<Record<AccessOp, string>>
}

export async function runAccessShow(opts: { cwd: string; collection?: string }): Promise<AccessShowRow[]> {
  const project = requireProject(opts.cwd)
  const srcDir = dirname(project.configPath)
  const files = opts.collection
    ? [findCollectionFile(srcDir, opts.collection)].filter((c): c is NonNullable<typeof c> => Boolean(c))
    : listCollectionFiles(srcDir)
  if (opts.collection && files.length === 0) {
    const existing = listCollectionFiles(srcDir).map((c) => c.slug)
    throw new CliError(`No collection "${opts.collection}" in this project. Existing: ${existing.join(', ') || '(none)'}.`)
  }
  return files.flatMap((c) => {
    const read = readAccess(c.file)
    return read ? [{ collection: c.slug, file: relative(project.root, c.file), ...read }] : []
  })
}

export function registerAccess(program: Command): void {
  const access = program.command('access').description('Show or change who can read/create/update/delete a collection')

  access
    .command('set <collection>')
    .description('Set access rules (public, authenticated, tenant-scoped, tenant-editor, tenant-admin, super-admin)')
    .option('--read <rule>')
    .option('--create <rule>')
    .option('--update <rule>')
    .option('--delete <rule>')
    .action(async (collection: string, o: Record<AccessOp, string | undefined>) => {
      const rules: AccessRules = {}
      for (const op of ACCESS_OPS) if (o[op]) rules[op] = validateRule(o[op]!)
      const r = await runAccessSet({ cwd: process.cwd(), collection, rules })
      if (r.manualInstructions) {
        console.error(r.manualInstructions)
        process.exitCode = 1
        return
      }
      console.log(`Updated ${r.file}`)
      for (const c of r.created) console.log(`Created ${c}`)
    })

  access
    .command('show [collection]')
    .description('Show the access rules of one or all collections')
    .action(async (collection?: string) => {
      const rows = await runAccessShow({ cwd: process.cwd(), collection })
      for (const row of rows) {
        console.log(`${row.collection}  (${row.file})`)
        for (const op of ACCESS_OPS) {
          const value = row.rules[op] ?? (row.custom[op] ? `custom: ${row.custom[op]}` : '-')
          console.log(`  ${op.padEnd(7)}${value}`)
        }
      }
      console.log('\n"-" = not set: Payload\'s default applies (any signed-in user).')
    })
}
