import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ts } from 'ts-morph'
import { beforeAll, describe, expect, it } from 'vitest'

const repo = join(import.meta.dirname, '..', '..')
const bin = join(repo, 'dist', 'cli.js')

function paycms(cwd: string, ...args: string[]) {
  const r = spawnSync('node', [bin, ...args], { cwd, encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

beforeAll(() => {
  execFileSync('npm', ['run', 'build', '--silent'], { cwd: repo, stdio: 'pipe' })
}, 120_000)

const combos = (['blank', 'blog', 'corporate'] as const).flatMap((t) =>
  (['postgres', 'mongodb'] as const).map((d) => [t, d] as const),
)

describe.each(combos)('built CLI: %s / %s', (template, db) => {
  it('creates a project and generates into it', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'paycms-int-'))
    const created = paycms(cwd, 'create', 'site', '--template', template, '--db', db, '--yes', '--no-install')
    expect(created.code, created.err).toBe(0)

    const root = join(cwd, 'site')
    const gen = paycms(root, 'generate', 'collection', 'Notes')
    expect(gen.code, gen.err).toBe(0)
    expect(paycms(root, 'generate', 'global', 'Site Settings').code).toBe(0)
    expect(paycms(root, 'generate', 'block', 'Callout').code).toBe(0)

    const config = readFileSync(join(root, 'src/payload.config.ts'), 'utf8')
    expect(ts.transpileModule(config, { reportDiagnostics: true }).diagnostics).toEqual([])
    expect(config).toMatch(/\bNotes\b/)
    expect(config).toMatch(/'site-settings': \{\s*isGlobal: true\s*\}/)
  })

  it('refuses a duplicate collection with a readable error', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'paycms-int-'))
    paycms(cwd, 'create', 'site', '--template', template, '--db', db, '--yes', '--no-install')
    const root = join(cwd, 'site')
    paycms(root, 'generate', 'collection', 'Notes')
    const again = paycms(root, 'generate', 'collection', 'Notes')
    expect(again.code).toBe(1)
    expect(again.err).toMatch(/^Error: .*already exists/m)
    expect(again.err).not.toMatch(/at .*\.js:\d+/)
  })
})

describe('built CLI: --fields', () => {
  const scaffold = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'paycms-int-'))
    paycms(cwd, 'create', 'site', '-t', 'blank', '-d', 'postgres', '--yes', '--no-install')
    return join(cwd, 'site')
  }

  it('creates a collection with the requested fields', () => {
    const root = scaffold()
    const r = paycms(root, 'generate', 'collection', 'Case Studies', '--fields', 'client:text!,image:upload:media')
    expect(r.code, r.err).toBe(0)
    const file = readFileSync(join(root, 'src/collections/CaseStudies.ts'), 'utf8')
    expect(file).toContain(`name: 'client'`)
    expect(file).toContain(`relationTo: 'media'`)
  })

  it('reports a bad field spec without creating anything', () => {
    const root = scaffold()
    const r = paycms(root, 'generate', 'collection', 'Notes', '--fields', 'a:wat')
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/Unknown field type "wat"/)
    expect(paycms(root, 'generate', 'collection', 'Notes').code).toBe(0)
  })

  it('does not prompt when stdin is not a TTY', () => {
    const root = scaffold()
    const r = paycms(root, 'generate', 'collection', 'Plain')
    expect(r.code, r.err).toBe(0)
    expect(readFileSync(join(root, 'src/collections/Plain.ts'), 'utf8')).toContain(`name: 'title'`)
  })
})

describe('built CLI: create collection', () => {
  const scaffold = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'paycms-int-'))
    paycms(cwd, 'create', 'site', '-t', 'blank', '-d', 'postgres', '--yes', '--no-install')
    return join(cwd, 'site')
  }

  it('`create collection <name>` works like generate, including field options', () => {
    const root = scaffold()
    const r = paycms(
      root, 'create', 'collection', 'Case Studies',
      '--fields', 'client:text![unique],summary:textarea', '--use-as-title', 'client',
    )
    expect(r.code, r.err).toBe(0)
    const file = readFileSync(join(root, 'src/collections/CaseStudies.ts'), 'utf8')
    expect(file).toContain(`useAsTitle: 'client'`)
    expect(file).toContain('unique: true')
  })

  it('without a name and without a TTY it explains what is missing', () => {
    const r = paycms(scaffold(), 'create', 'collection')
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/collection name is required/i)
  })

  it('`create <name>` still scaffolds a project', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'paycms-int-'))
    const r = paycms(cwd, 'create', 'my-app', '--yes', '--no-install')
    expect(r.code, r.err).toBe(0)
    expect(readFileSync(join(cwd, 'my-app/package.json'), 'utf8')).toContain('"name": "my-app"')
  })
})

describe('built CLI: access', () => {
  it('sets and shows rules, and generate --access writes them', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'paycms-int-'))
    paycms(cwd, 'create', 'site', '-t', 'blank', '-d', 'postgres', '--yes', '--no-install')
    const root = join(cwd, 'site')
    expect(paycms(root, 'generate', 'collection', 'Notes', '--access', 'read=public,delete=tenant-admin').code).toBe(0)
    expect(paycms(root, 'access', 'set', 'notes', '--update', 'tenant-editor').code).toBe(0)
    const shown = paycms(root, 'access', 'show', 'notes')
    expect(shown.code, shown.err).toBe(0)
    expect(shown.out).toMatch(/read\s+public/)
    expect(shown.out).toMatch(/update\s+tenant-editor/)
    expect(shown.out).toMatch(/delete\s+tenant-admin/)
    const bad = paycms(root, 'access', 'set', 'notes', '--read', 'nope')
    expect(bad.code).toBe(1)
    expect(bad.err).toMatch(/Unknown access rule "nope"/)
  })
})

describe('built CLI: outside a project', () => {
  it.each([['tenant', 'list'], ['doctor'], ['dev'], ['generate', 'collection', 'x']])('%s fails clearly', (...args) => {
    const r = paycms(mkdtempSync(join(tmpdir(), 'paycms-none-')), ...args)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/Not inside a Payload project/)
  })

  it('rejects a bad template name', () => {
    const r = paycms(mkdtempSync(join(tmpdir(), 'paycms-bad-')), 'create', 'x', '-t', 'nope', '-d', 'postgres', '-y', '--no-install')
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/Unknown template "nope"/)
  })
})
