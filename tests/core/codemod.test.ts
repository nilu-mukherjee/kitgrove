import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ts } from 'ts-morph'
import { describe, expect, it } from 'vitest'
import { registerInConfig, type ConfigEdit } from '../../src/core/codemod.js'

const PLUGIN = `multiTenantPlugin({
      collections: { pages: {}, media: {} },
    }),`

const base = (body: string) => `import { buildConfig } from 'payload'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { Users } from './collections/Users'
${body}
`

const FIXTURES = {
  plain: base(`export default buildConfig({
  collections: [Users],
  plugins: [
    ${PLUGIN}
  ],
})`),
  variable: base(`const collections = [Users]
export default buildConfig({
  collections,
  plugins: [
    ${PLUGIN}
  ],
})`),
  spread: base(`const shared = [Users]
export default buildConfig({
  collections: [...shared],
  plugins: [
    ${PLUGIN}
  ],
})`),
  missing: base(`export default buildConfig({
  plugins: [
    ${PLUGIN}
  ],
})`),
  noPlugin: base(`export default buildConfig({
  collections: [Users],
})`),
  noBuildConfig: `export default { collections: [] }\n`,
}

function write(content: string) {
  const path = join(mkdtempSync(join(tmpdir(), 'kitgrove-codemod-')), 'payload.config.ts')
  writeFileSync(path, content)
  return path
}

const notes: ConfigEdit = {
  kind: 'collection',
  slug: 'notes',
  importName: 'Notes',
  importPath: './collections/Notes',
  tenantScoped: true,
}

function expectParses(code: string) {
  const { diagnostics } = ts.transpileModule(code, { reportDiagnostics: true })
  expect(diagnostics).toEqual([])
}

describe('registerInConfig', () => {
  it('adds the import and the collection entry', () => {
    const path = write(FIXTURES.plain)
    expect(registerInConfig(path, notes)).toEqual({ ok: true })
    const out = readFileSync(path, 'utf8')
    expect(out).toContain(`import { Notes } from './collections/Notes'`)
    expect(out).toMatch(/collections: \[\s*Users,\s*Notes\s*\]/)
    expectParses(out)
  })

  it('adds the slug to the multi-tenant plugin map, quoting hyphenated slugs', () => {
    const path = write(FIXTURES.plain)
    registerInConfig(path, { ...notes, slug: 'blog-posts', importName: 'BlogPosts' })
    const out = readFileSync(path, 'utf8')
    expect(out).toMatch(/'blog-posts': \{\}/)
    expect(out).toMatch(/pages: \{\}/)
    expectParses(out)
  })

  it('writes { isGlobal: true } to the plugin map for per-tenant globals', () => {
    const path = write(FIXTURES.plain)
    registerInConfig(path, { ...notes, slug: 'header', importName: 'Header', isGlobal: true })
    const out = readFileSync(path, 'utf8')
    expect(out).toMatch(/header: \{\s*isGlobal: true\s*\}/)
    expectParses(out)
  })

  it('does not touch the plugin map for non tenant-scoped collections', () => {
    const path = write(FIXTURES.plain)
    registerInConfig(path, { ...notes, tenantScoped: false })
    expect(readFileSync(path, 'utf8')).not.toMatch(/notes: \{\}/)
  })

  it('registers globals under `globals`', () => {
    const path = write(FIXTURES.plain)
    const result = registerInConfig(path, {
      kind: 'global',
      slug: 'header',
      importName: 'Header',
      importPath: './globals/Header',
    })
    expect(result).toEqual({ ok: true })
    const out = readFileSync(path, 'utf8')
    expect(out).toMatch(/globals: \[\s*Header\s*\]/)
    expectParses(out)
  })

  it('appends to an array literal that contains a spread', () => {
    const path = write(FIXTURES.spread)
    expect(registerInConfig(path, notes)).toEqual({ ok: true })
    const out = readFileSync(path, 'utf8')
    expect(out).toMatch(/\.\.\.shared/)
    expect(out).toMatch(/Notes/)
    expectParses(out)
  })

  it('creates the collections array when it is missing', () => {
    const path = write(FIXTURES.missing)
    expect(registerInConfig(path, notes)).toEqual({ ok: true })
    const out = readFileSync(path, 'utf8')
    expect(out).toMatch(/collections: \[\s*Notes\s*\]/)
    expectParses(out)
  })

  it('falls back to instructions, leaving the file byte-identical, for a variable array', () => {
    const path = write(FIXTURES.variable)
    const result = registerInConfig(path, notes)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.manualInstructions).toContain('collections')
      expect(result.manualInstructions).toContain(`import { Notes } from './collections/Notes'`)
    }
    expect(readFileSync(path, 'utf8')).toBe(FIXTURES.variable)
  })

  it('refuses a tenant-scoped edit when no multi-tenant plugin is found, writing nothing', () => {
    const path = write(FIXTURES.noPlugin)
    const result = registerInConfig(path, notes)
    expect(result.ok).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(FIXTURES.noPlugin)
  })

  it('falls back when there is no buildConfig call', () => {
    const path = write(FIXTURES.noBuildConfig)
    expect(registerInConfig(path, notes).ok).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(FIXTURES.noBuildConfig)
  })

  it('does not duplicate on a second identical call', () => {
    const path = write(FIXTURES.plain)
    registerInConfig(path, notes)
    const once = readFileSync(path, 'utf8')
    const second = registerInConfig(path, notes)
    expect(second.ok).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(once)
    expect(once.match(/import \{ Notes \}/g)).toHaveLength(1)
  })
})
