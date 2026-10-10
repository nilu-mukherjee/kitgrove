import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCreate } from '../../src/commands/create.js'
import { CliError } from '../../src/core/errors.js'
import { registerInConfig } from '../../src/core/codemod.js'

const cwd = () => mkdtempSync(join(tmpdir(), 'kitgrove-create-'))

const BLANK_FILES = [
  '.env.example',
  '.gitignore',
  'package.json',
  'tsconfig.json',
  'next.config.ts',
  'src/payload.config.ts',
  'src/collections/Tenants.ts',
  'src/collections/Users.ts',
  'src/collections/Media.ts',
  'src/collections/Pages.ts',
  'src/access/isSuperAdmin.ts',
  'src/access/tenantAdminOnly.ts',
  'src/access/tenantScoped.ts',
  'src/lib/tenant.ts',
  'src/app/(frontend)/[[...slug]]/page.tsx',
  'src/app/(payload)/layout.tsx',
]

describe('runCreate (blank)', () => {
  it.each([
    ['postgres', '@payloadcms/db-postgres', '@payloadcms/db-mongodb'],
    ['mongodb', '@payloadcms/db-mongodb', '@payloadcms/db-postgres'],
  ] as const)('scaffolds a multi-tenant project for %s', async (db, wanted, unwanted) => {
    const dir = cwd()
    await runCreate({ name: 'My Site', template: 'blank', db, pm: 'npm', yes: true, install: false, cwd: dir })
    const root = join(dir, 'my-site')
    for (const f of BLANK_FILES) expect(existsSync(join(root, f)), f).toBe(true)

    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('my-site')
    expect(pkg.dependencies[wanted]).toBeDefined()
    expect(pkg.dependencies[unwanted]).toBeUndefined()
    expect(pkg.dependencies['@payloadcms/plugin-multi-tenant']).toBe(pkg.dependencies.payload)

    const config = readFileSync(join(root, 'src/payload.config.ts'), 'utf8')
    expect(config).toContain(wanted)
    expect(config).not.toContain(unwanted)
    expect(config).toContain('multiTenantPlugin')
    expect(readFileSync(join(root, '.env.example'), 'utf8')).toMatch(/^DATABASE_URL=.+/m)
  })

  it('produces a config the codemod can register a new collection in', async () => {
    const dir = cwd()
    await runCreate({ name: 'acme', template: 'blank', db: 'postgres', pm: 'npm', yes: true, install: false, cwd: dir })
    const result = registerInConfig(join(dir, 'acme/src/payload.config.ts'), {
      kind: 'collection',
      slug: 'notes',
      importName: 'Notes',
      importPath: './collections/Notes',
      tenantScoped: true,
    })
    expect(result).toEqual({ ok: true })
  })

  it('uses field-level access helpers (not collection Access) on the users roles field', async () => {
    const dir = cwd()
    await runCreate({ name: 'acme', template: 'blank', db: 'postgres', pm: 'npm', yes: true, install: false, cwd: dir })
    const users = readFileSync(join(dir, 'acme/src/collections/Users.ts'), 'utf8')
    expect(users).toMatch(/create:\s*isSuperAdminField/)
    expect(users).toMatch(/update:\s*isSuperAdminField/)
  })

  it('refuses a non-empty target directory and leaves it untouched', async () => {
    const dir = cwd()
    mkdirSync(join(dir, 'acme'))
    writeFileSync(join(dir, 'acme', 'keep.txt'), 'x')
    await expect(
      runCreate({ name: 'acme', template: 'blank', db: 'postgres', pm: 'npm', yes: true, install: false, cwd: dir }),
    ).rejects.toThrow(CliError)
    expect(existsSync(join(dir, 'acme', 'package.json'))).toBe(false)
  })

  it('dryRun writes nothing but returns the file list', async () => {
    const dir = cwd()
    const files = await runCreate({
      name: 'acme', template: 'blank', db: 'mongodb', pm: 'npm', yes: true, install: false, dryRun: true, cwd: dir,
    })
    expect(files).toEqual(expect.arrayContaining(BLANK_FILES))
    expect(existsSync(join(dir, 'acme'))).toBe(false)
  })

  it('rejects an unknown db', async () => {
    await expect(
      runCreate({ name: 'acme', template: 'blank', db: 'sqlite' as never, pm: 'npm', yes: true, install: false, cwd: cwd() }),
    ).rejects.toThrow(CliError)
  })
})
