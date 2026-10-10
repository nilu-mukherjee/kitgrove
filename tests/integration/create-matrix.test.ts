import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ts } from 'ts-morph'
import { beforeAll, describe, expect, it } from 'vitest'

const repo = join(import.meta.dirname, '..', '..')
const bin = join(repo, 'dist', 'cli.js')

function kitgrove(cwd: string, ...args: string[]) {
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
    const cwd = mkdtempSync(join(tmpdir(), 'kitgrove-int-'))
    const created = kitgrove(cwd, 'create', 'site', '--template', template, '--db', db, '--yes', '--no-install')
    expect(created.code, created.err).toBe(0)

    const root = join(cwd, 'site')
    const gen = kitgrove(root, 'generate', 'collection', 'Notes')
    expect(gen.code, gen.err).toBe(0)
    expect(kitgrove(root, 'generate', 'global', 'Site Settings').code).toBe(0)
    expect(kitgrove(root, 'generate', 'block', 'Callout').code).toBe(0)

    const config = readFileSync(join(root, 'src/payload.config.ts'), 'utf8')
    expect(ts.transpileModule(config, { reportDiagnostics: true }).diagnostics).toEqual([])
    expect(config).toMatch(/\bNotes\b/)
    expect(config).toMatch(/'site-settings': \{\s*isGlobal: true\s*\}/)
  })

  it('refuses a duplicate collection with a readable error', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'kitgrove-int-'))
    kitgrove(cwd, 'create', 'site', '--template', template, '--db', db, '--yes', '--no-install')
    const root = join(cwd, 'site')
    kitgrove(root, 'generate', 'collection', 'Notes')
    const again = kitgrove(root, 'generate', 'collection', 'Notes')
    expect(again.code).toBe(1)
    expect(again.err).toMatch(/^Error: .*already exists/m)
    expect(again.err).not.toMatch(/at .*\.js:\d+/)
  })
})

describe('built CLI: --fields', () => {
  const scaffold = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'kitgrove-int-'))
    kitgrove(cwd, 'create', 'site', '-t', 'blank', '-d', 'postgres', '--yes', '--no-install')
    return join(cwd, 'site')
  }

  it('creates a collection with the requested fields', () => {
    const root = scaffold()
    const r = kitgrove(root, 'generate', 'collection', 'Case Studies', '--fields', 'client:text!,image:upload:media')
    expect(r.code, r.err).toBe(0)
    const file = readFileSync(join(root, 'src/collections/CaseStudies.ts'), 'utf8')
    expect(file).toContain(`name: 'client'`)
    expect(file).toContain(`relationTo: 'media'`)
  })

  it('reports a bad field spec without creating anything', () => {
    const root = scaffold()
    const r = kitgrove(root, 'generate', 'collection', 'Notes', '--fields', 'a:wat')
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/Unknown field type "wat"/)
    expect(kitgrove(root, 'generate', 'collection', 'Notes').code).toBe(0)
  })

  it('does not prompt when stdin is not a TTY', () => {
    const root = scaffold()
    const r = kitgrove(root, 'generate', 'collection', 'Plain')
    expect(r.code, r.err).toBe(0)
    expect(readFileSync(join(root, 'src/collections/Plain.ts'), 'utf8')).toContain(`name: 'title'`)
  })
})

describe('built CLI: create collection', () => {
  const scaffold = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'kitgrove-int-'))
    kitgrove(cwd, 'create', 'site', '-t', 'blank', '-d', 'postgres', '--yes', '--no-install')
    return join(cwd, 'site')
  }

  it('`create collection <name>` works like generate, including field options', () => {
    const root = scaffold()
    const r = kitgrove(
      root, 'create', 'collection', 'Case Studies',
      '--fields', 'client:text![unique],summary:textarea', '--use-as-title', 'client',
    )
    expect(r.code, r.err).toBe(0)
    const file = readFileSync(join(root, 'src/collections/CaseStudies.ts'), 'utf8')
    expect(file).toContain(`useAsTitle: 'client'`)
    expect(file).toContain('unique: true')
  })

  it('without a name and without a TTY it explains what is missing', () => {
    const r = kitgrove(scaffold(), 'create', 'collection')
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/collection name is required/i)
  })

  it('`create <name>` still scaffolds a project', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'kitgrove-int-'))
    const r = kitgrove(cwd, 'create', 'my-app', '--yes', '--no-install')
    expect(r.code, r.err).toBe(0)
    expect(readFileSync(join(cwd, 'my-app/package.json'), 'utf8')).toContain('"name": "my-app"')
  })
})

describe('built CLI: access', () => {
  it('sets and shows rules, and generate --access writes them', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'kitgrove-int-'))
    kitgrove(cwd, 'create', 'site', '-t', 'blank', '-d', 'postgres', '--yes', '--no-install')
    const root = join(cwd, 'site')
    expect(kitgrove(root, 'generate', 'collection', 'Notes', '--access', 'read=public,delete=tenant-admin').code).toBe(0)
    expect(kitgrove(root, 'access', 'set', 'notes', '--update', 'tenant-editor').code).toBe(0)
    const shown = kitgrove(root, 'access', 'show', 'notes')
    expect(shown.code, shown.err).toBe(0)
    expect(shown.out).toMatch(/read\s+public/)
    expect(shown.out).toMatch(/update\s+tenant-editor/)
    expect(shown.out).toMatch(/delete\s+tenant-admin/)
    const bad = kitgrove(root, 'access', 'set', 'notes', '--read', 'nope')
    expect(bad.code).toBe(1)
    expect(bad.err).toMatch(/Unknown access rule "nope"/)
  })
})

function pty(root: string, scenario: 'navigate' | 'ctrl-c') {
  const r = spawnSync('python3', ['-I', join(repo, 'tests/helpers/pty_driver.py'), bin, root, scenario], {
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (r.status !== 0) throw new Error(`pty driver failed: ${r.stderr}`)
  return JSON.parse(r.stdout.trim().split('\n').pop()!) as Record<string, boolean | number>
}

describe('built CLI: TUI in a real terminal', () => {
  const scaffold = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'kitgrove-pty-'))
    kitgrove(cwd, 'create', 'site', '-t', 'blank', '-d', 'postgres', '--yes', '--no-install')
    return join(cwd, 'site')
  }

  it('opens, navigates Collections and Doctor, and quits cleanly with q', () => {
    const r = pty(scaffold(), 'navigate')
    expect(r).toMatchObject({ enter: true, leave: true, home: true, collections: true, doctor: true, code: 0 })
  })

  it('restores the terminal and exits 0 on Ctrl+C from Home', () => {
    const r = pty(scaffold(), 'ctrl-c')
    expect(r).toMatchObject({ enter: true, leave: true, code: 0 })
  })
})

describe('built CLI: headless', () => {
  const scaffold = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'paycms-int-'))
    kitgrove(cwd, 'create', 'site', '-t', 'blog', '-d', 'postgres', '--yes', '--no-install')
    return join(cwd, 'site')
  }

  it('create --headless leaves out the frontend', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'paycms-int-'))
    const r = kitgrove(cwd, 'create', 'api', '-t', 'blog', '-d', 'postgres', '--headless', '--yes', '--no-install')
    expect(r.code, r.err).toBe(0)
    expect(existsSync(join(cwd, 'api/src/app/(frontend)'))).toBe(false)
    expect(readFileSync(join(cwd, 'api/src/collections/Users.ts'), 'utf8')).toContain('useAPIKey: true')
  })

  it('headless --dry-run changes nothing; --yes converts; a second run is a no-op', () => {
    const root = scaffold()
    const dry = kitgrove(root, 'headless', '--dry-run')
    expect(dry.code, dry.err).toBe(0)
    expect(dry.out).toMatch(/Would remove\s+src\/lib\/tenant\.ts/)
    expect(existsSync(join(root, 'src/lib/tenant.ts'))).toBe(true)

    const run = kitgrove(root, 'headless', '--yes')
    expect(run.code, run.err).toBe(0)
    expect(existsSync(join(root, 'src/lib/tenant.ts'))).toBe(false)
    expect(readFileSync(join(root, 'src/payload.config.ts'), 'utf8')).toContain('CORS_ORIGINS')

    expect(kitgrove(root, 'headless', '--yes').out).toMatch(/already headless/)
  })

  it('refuses to change files without --yes when there is no terminal', () => {
    const root = scaffold()
    const r = kitgrove(root, 'headless')
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/pass --yes/)
    expect(existsSync(join(root, 'src/lib/tenant.ts'))).toBe(true)
  })
})

describe('built CLI: outside a project', () => {
  it.each([['tenant', 'list'], ['doctor'], ['dev'], ['generate', 'collection', 'x']])('%s fails clearly', (...args) => {
    const r = kitgrove(mkdtempSync(join(tmpdir(), 'kitgrove-none-')), ...args)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/Not inside a Payload project/)
  })

  it('rejects a bad template name', () => {
    const r = kitgrove(mkdtempSync(join(tmpdir(), 'kitgrove-bad-')), 'create', 'x', '-t', 'nope', '-d', 'postgres', '-y', '--no-install')
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/Unknown template "nope"/)
  })
})
