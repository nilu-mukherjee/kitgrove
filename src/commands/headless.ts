import { existsSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import * as p from '@clack/prompts'
import type { Command } from 'commander'
import { IndentationText, Node, Project, QuoteKind } from 'ts-morph'
import { findConfigObject } from '../core/access.js'
import { CliError } from '../core/errors.js'
import { templatesDir } from '../core/paths.js'
import { listCollectionFiles } from '../core/project-scan.js'
import { requireProject } from '../core/project.js'
import { renderString } from '../core/template.js'
import { PAYLOAD_VERSION } from './create.js'

export interface HeadlessResult {
  /** Frontend files deleted (or that would be, with dryRun), relative to the project root. */
  removed: string[]
  /** Frontend files left in place because they were changed or are not part of the template. */
  kept: string[]
  /** Files edited (Users collection, payload.config.ts, .env.example). */
  edited: string[]
  /** Edits that could not be made safely, with the exact change to make by hand. */
  manual: string[]
  /** Nothing to do: already a headless project. */
  alreadyHeadless: boolean
}

const CORS_EXPR =
  "process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()) : []"
const ENV_LINE = 'CORS_ORIGINS=https://site-a.example,https://site-b.example\n'

const FRONTEND_ROOTS = ['app/(frontend)', 'lib/tenant.ts', 'lib/currentTenant.ts', 'components']

/** Files under `dir`; a path that is itself a file yields just that file. */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  if (!statSync(dir).isDirectory()) return [dir]
  return readdirSync(dir).flatMap((n) => {
    const full = join(dir, n)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const slash = (p: string) => p.split(sep).join('/')

/** Every version of each frontend file the templates can generate, keyed by path relative to src/. */
function knownFrontendContents(): Map<string, Set<string>> {
  const known = new Map<string, Set<string>>()
  for (const layer of ['blank', 'blog', 'corporate']) {
    const root = join(templatesDir(), 'projects', layer)
    for (const file of walk(root)) {
      const rel = slash(relative(root, file))
      if (!rel.startsWith('src/')) continue
      const inSrc = rel.slice(4)
      if (!FRONTEND_ROOTS.some((r) => inSrc === r || inSrc.startsWith(`${r}/`))) continue
      const raw = readFileSync(file, 'utf8')
      const target = inSrc.replace(/\.tpl$/, '')
      const versions = known.get(target) ?? new Set<string>()
      if (file.endsWith('.tpl')) {
        for (const blog of [false, true]) {
          for (const corporate of [false, true]) {
            versions.add(
              renderString(raw, {
                name: 'x',
                payloadVersion: PAYLOAD_VERSION,
                blog,
                corporate,
                headless: false,
                frontend: true,
                postgres: true,
                mongodb: false,
                dbAdapterPackage: '',
                databaseUriExample: '',
              }),
            )
          }
        }
      } else versions.add(raw)
      known.set(target, versions)
    }
  }
  return known
}

function pruneEmptyDirs(start: string, stopAt: string): void {
  let dir = start
  while (dir.startsWith(stopAt) && dir !== stopAt && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir)
    dir = dirname(dir)
  }
}

function tsProject(file: string) {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    // Generated projects use two spaces and single quotes; match them so edits blend in.
    manipulationSettings: { indentationText: IndentationText.TwoSpaces, quoteKind: QuoteKind.Single },
  }).addSourceFileAtPath(file)
}

/** Sets `auth: { useAPIKey: true }`. Returns 'edited', 'unchanged' or a reason it cannot be done safely. */
function enableApiKeys(file: string, write: boolean): 'edited' | 'unchanged' | string {
  const sf = tsProject(file)
  const config = findConfigObject(sf)
  const auth = config?.getProperty('auth')
  if (!config || !auth || !Node.isPropertyAssignment(auth)) return '`auth` is not a plain property'
  const init = auth.getInitializer()
  if (!init) return '`auth` has no value'

  if (init.getText() === 'true') {
    init.replaceWithText('{ useAPIKey: true }')
  } else if (Node.isObjectLiteralExpression(init)) {
    const key = init.getProperty('useAPIKey')
    if (!key) init.addPropertyAssignment({ name: 'useAPIKey', initializer: 'true' })
    else if (Node.isPropertyAssignment(key)) {
      if (key.getInitializer()?.getText() === 'true') return 'unchanged'
      key.setInitializer('true')
    } else return '`useAPIKey` is not a plain property'
  } else return '`auth` is not `true` or an object literal'

  if (write) sf.saveSync()
  return 'edited'
}

/** Adds the `cors` option to buildConfig({...}). */
function addCors(file: string, write: boolean): 'edited' | 'unchanged' | string {
  const sf = tsProject(file)
  const call = sf
    .getDescendants()
    .find((n) => Node.isCallExpression(n) && n.getExpression().getText() === 'buildConfig')
  const arg = call && Node.isCallExpression(call) ? call.getArguments()[0] : undefined
  if (!arg || !Node.isObjectLiteralExpression(arg)) return 'no buildConfig({ ... }) call with an object literal'
  if (arg.getProperty('cors')) return 'unchanged'

  const props = arg.getProperties()
  const secret = props.findIndex((x) => Node.isPropertyAssignment(x) && x.getName() === 'secret')
  arg.insertPropertyAssignment(secret === -1 ? 0 : secret + 1, { name: 'cors', initializer: CORS_EXPR })
  if (write) sf.saveSync()
  return 'edited'
}

/** Turns an existing project into a headless one: no demo frontend, API keys on, CORS from the env. */
export async function runHeadless(opts: { cwd: string; dryRun?: boolean; force?: boolean }): Promise<HeadlessResult> {
  const project = requireProject(opts.cwd)
  const srcDir = dirname(project.configPath)
  const write = !opts.dryRun
  const rel = (abs: string) => slash(relative(project.root, abs))
  const result: HeadlessResult = { removed: [], kept: [], edited: [], manual: [], alreadyHeadless: false }

  // 1. Frontend files: delete only what the templates generated and nobody changed.
  const known = knownFrontendContents()
  const candidates = FRONTEND_ROOTS.flatMap((r) => walk(join(srcDir, r)))
  for (const file of candidates) {
    const inSrc = slash(relative(srcDir, file))
    const versions = known.get(inSrc)
    const untouched = versions?.has(readFileSync(file, 'utf8')) ?? false
    if (untouched || opts.force) {
      result.removed.push(rel(file))
      if (write) unlinkSync(file)
    } else {
      result.kept.push(rel(file))
    }
  }
  if (write) {
    for (const file of candidates) pruneEmptyDirs(dirname(file), srcDir)
  }

  // 2. API keys on the users collection.
  const users = listCollectionFiles(srcDir).find((c) => c.slug === 'users')
  if (!users) {
    result.manual.push('No `users` collection found: set `auth: { useAPIKey: true }` on your auth collection.')
  } else {
    const r = enableApiKeys(users.file, write)
    if (r === 'edited') result.edited.push(rel(users.file))
    else if (r !== 'unchanged') {
      result.manual.push(`${rel(users.file)}: set \`auth: { useAPIKey: true }\` yourself (${r}).`)
    }
  }

  // 3. CORS from the environment.
  const cors = addCors(project.configPath, write)
  if (cors === 'edited') result.edited.push(rel(project.configPath))
  else if (cors !== 'unchanged') {
    result.manual.push(`${rel(project.configPath)}: add \`cors: ${CORS_EXPR}\` to buildConfig (${cors}).`)
  }

  // 4. Document the variable in .env.example (never touches .env).
  const envExample = join(project.root, '.env.example')
  if (existsSync(envExample) && !/^CORS_ORIGINS=/m.test(readFileSync(envExample, 'utf8'))) {
    result.edited.push(rel(envExample))
    if (write) {
      const text = readFileSync(envExample, 'utf8')
      writeFileSync(envExample, `${text}${text.endsWith('\n') || text === '' ? '' : '\n'}${ENV_LINE}`)
    }
  }

  result.alreadyHeadless =
    result.removed.length === 0 && result.kept.length === 0 && result.edited.length === 0 && result.manual.length === 0
  return result
}

function print(r: HeadlessResult, dryRun: boolean): void {
  if (r.alreadyHeadless) return console.log('This project is already headless; nothing to change.')
  const verb = dryRun ? 'Would remove' : 'Removed'
  for (const f of r.removed) console.log(`${verb}  ${f}`)
  for (const f of r.edited) console.log(`${dryRun ? 'Would edit  ' : 'Edited      '}${f}`)
  for (const f of r.kept) console.log(`Kept     ${f}  (changed, or not from the template; use --force to remove)`)
  for (const m of r.manual) console.error(`Manual   ${m}`)
  if (!dryRun && r.edited.some((f) => f.endsWith('payload.config.ts'))) {
    console.log('\nSet CORS_ORIGINS in your .env (comma separated) for sites that call the API from a browser.')
  }
}

export function registerHeadless(program: Command): void {
  program
    .command('headless')
    .description('Convert this project to backend only: remove the demo frontend, enable API keys and CORS')
    .option('--dry-run', 'show what would change without changing anything')
    .option('--force', 'also remove frontend files you have changed')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (o: { dryRun?: boolean; force?: boolean; yes?: boolean }) => {
      const cwd = process.cwd()
      const plan = await runHeadless({ cwd, dryRun: true, force: o.force })
      if (o.dryRun || plan.alreadyHeadless) return print(plan, true)

      print(plan, true)
      if (!o.yes) {
        if (!process.stdin.isTTY) throw new CliError('Refusing to change files without confirmation: pass --yes.')
        const ok = await p.confirm({ message: 'Apply these changes?' })
        if (p.isCancel(ok) || !ok) return
      }
      const done = await runHeadless({ cwd, force: o.force })
      console.log('')
      print(done, false)
      if (done.manual.length) process.exitCode = 1
    })
}
