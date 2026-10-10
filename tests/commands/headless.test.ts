import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { ts } from 'ts-morph'
import { describe, expect, it } from 'vitest'
import { runCreate, type Database, type TemplateName } from '../../src/commands/create.js'
import { runHeadless } from '../../src/commands/headless.js'
import { CliError } from '../../src/core/errors.js'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
const tree = (root: string) => walk(root).map((f) => relative(root, f)).sort()
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8')

async function scaffold(template: TemplateName, db: Database, headless: boolean) {
  const cwd = mkdtempSync(join(tmpdir(), 'paycms-hl-'))
  await runCreate({ name: 'site', template, db, pm: 'npm', yes: true, install: false, headless, cwd })
  return join(cwd, 'site')
}

const combos = [
  ['blank', 'postgres'],
  ['blog', 'mongodb'],
  ['corporate', 'postgres'],
] as const

describe.each(combos)('converting a %s / %s project', (template, db) => {
  it('ends up with the same files as a freshly generated headless project', async () => {
    const existing = await scaffold(template, db, false)
    const fresh = await scaffold(template, db, true)
    const result = await runHeadless({ cwd: existing })

    expect(result.removed.length).toBeGreaterThan(0)
    expect(result.kept).toEqual([])
    // README differs on purpose (the headless one documents the API); everything else must match.
    const strip = (t: string[]) => t.filter((f) => f !== 'README.md')
    expect(strip(tree(existing))).toEqual(strip(tree(fresh)))
    expect(existsSync(join(existing, 'src/app/(frontend)'))).toBe(false)
  })

  it('indents the inserted cors option like the rest of the file', async () => {
    const root = await scaffold(template, db, false)
    await runHeadless({ cwd: root })
    const line = read(root, 'src/payload.config.ts').split('\n').find((l) => l.includes('cors:'))!
    expect(line).toMatch(/^ {2}cors:/)
  })

  it('enables API keys and CORS, and the edited files still parse', async () => {
    const root = await scaffold(template, db, false)
    await runHeadless({ cwd: root })
    expect(read(root, 'src/collections/Users.ts')).toContain('useAPIKey: true')
    expect(read(root, 'src/payload.config.ts')).toContain('process.env.CORS_ORIGINS')
    expect(read(root, '.env.example')).toMatch(/^CORS_ORIGINS=/m)
    for (const f of ['src/collections/Users.ts', 'src/payload.config.ts']) {
      expect(ts.transpileModule(read(root, f), { reportDiagnostics: true }).diagnostics, f).toEqual([])
    }
  })
})

describe('runHeadless behaviour', () => {
  it('--dry-run lists what would change and changes nothing', async () => {
    const root = await scaffold('corporate', 'postgres', false)
    const before = tree(root)
    const usersBefore = read(root, 'src/collections/Users.ts')
    const result = await runHeadless({ cwd: root, dryRun: true })
    expect(result.removed).toContain('src/lib/tenant.ts')
    expect(result.edited).toEqual(expect.arrayContaining(['src/collections/Users.ts', 'src/payload.config.ts']))
    expect(tree(root)).toEqual(before)
    expect(read(root, 'src/collections/Users.ts')).toBe(usersBefore)
  })

  it('is idempotent', async () => {
    const root = await scaffold('blog', 'postgres', false)
    await runHeadless({ cwd: root })
    const snapshot = Object.fromEntries(tree(root).map((f) => [f, read(root, f)]))
    const again = await runHeadless({ cwd: root })
    expect(again).toMatchObject({ alreadyHeadless: true, removed: [], edited: [] })
    expect(Object.fromEntries(tree(root).map((f) => [f, read(root, f)]))).toEqual(snapshot)
  })

  it('keeps frontend files you changed, and files that are not part of the template', async () => {
    const root = await scaffold('blank', 'postgres', false)
    writeFileSync(join(root, 'src/app/(frontend)/layout.tsx'), '// my own layout\nexport default () => null\n')
    mkdirSync(join(root, 'src/app/(frontend)/about'), { recursive: true })
    writeFileSync(join(root, 'src/app/(frontend)/about/page.tsx'), 'export default () => null\n')

    const result = await runHeadless({ cwd: root })
    expect(result.kept).toEqual(
      expect.arrayContaining(['src/app/(frontend)/layout.tsx', 'src/app/(frontend)/about/page.tsx']),
    )
    expect(read(root, 'src/app/(frontend)/layout.tsx')).toContain('my own layout')
    expect(existsSync(join(root, 'src/lib/tenant.ts'))).toBe(false) // the untouched ones still go
  })

  it('--force also removes the changed files', async () => {
    const root = await scaffold('blank', 'postgres', false)
    writeFileSync(join(root, 'src/app/(frontend)/layout.tsx'), '// my own layout\n')
    const result = await runHeadless({ cwd: root, force: true })
    expect(result.kept).toEqual([])
    expect(existsSync(join(root, 'src/app/(frontend)/layout.tsx'))).toBe(false)
  })

  it('adds useAPIKey to an existing auth object without losing its settings', async () => {
    const root = await scaffold('blank', 'postgres', false)
    const file = join(root, 'src/collections/Users.ts')
    writeFileSync(file, readFileSync(file, 'utf8').replace('auth: true,', 'auth: { tokenExpiration: 3600 },'))
    await runHeadless({ cwd: root })
    const out = readFileSync(file, 'utf8')
    expect(out).toContain('tokenExpiration: 3600')
    expect(out).toContain('useAPIKey: true')
  })

  it('turns useAPIKey: false on', async () => {
    const root = await scaffold('blank', 'postgres', false)
    const file = join(root, 'src/collections/Users.ts')
    writeFileSync(file, readFileSync(file, 'utf8').replace('auth: true,', 'auth: { useAPIKey: false },'))
    await runHeadless({ cwd: root })
    expect(readFileSync(file, 'utf8')).toContain('useAPIKey: true')
  })

  it('leaves an existing cors setting alone', async () => {
    const root = await scaffold('blank', 'postgres', false)
    const file = join(root, 'src/payload.config.ts')
    writeFileSync(file, readFileSync(file, 'utf8').replace("  secret:", "  cors: ['https://mine.example'],\n  secret:"))
    await runHeadless({ cwd: root })
    const out = readFileSync(file, 'utf8')
    expect(out).toContain("cors: ['https://mine.example']")
    expect(out).not.toContain('process.env.CORS_ORIGINS')
  })

  it('reports what it cannot edit instead of guessing', async () => {
    const root = await scaffold('blank', 'postgres', false)
    const file = join(root, 'src/collections/Users.ts')
    writeFileSync(file, readFileSync(file, 'utf8').replace('auth: true,', 'auth: buildAuth(),'))
    const before = readFileSync(file, 'utf8')
    const result = await runHeadless({ cwd: root })
    expect(result.manual.join('\n')).toMatch(/Users\.ts.*useAPIKey: true/s)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('refuses outside a Payload project', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paycms-hl-none-'))
    await expect(runHeadless({ cwd: dir })).rejects.toThrow(CliError)
  })
})
