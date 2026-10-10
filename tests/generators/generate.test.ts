import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCreate } from '../../src/commands/create.js'
import { runGenerate } from '../../src/commands/generate.js'
import { CliError } from '../../src/core/errors.js'

async function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'paycms-gen-'))
  await runCreate({ name: 'site', template: 'blank', db: 'postgres', pm: 'npm', yes: true, install: false, cwd })
  return join(cwd, 'site')
}
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8')

describe('generate collection', () => {
  it('normalises the name, writes the file and registers it as tenant-scoped', async () => {
    const root = await project()
    const result = await runGenerate('collection', 'BlogPosts', { cwd: root })
    expect(result.registered).toBe(true)
    expect(result.files).toEqual(['src/collections/BlogPosts.ts'])

    const file = read(root, 'src/collections/BlogPosts.ts')
    expect(file).toContain(`slug: 'blog-posts'`)
    expect(file).toContain('export const BlogPosts: CollectionConfig')
    expect(file).toContain(`from '../access/tenantScoped'`)

    const config = read(root, 'src/payload.config.ts')
    expect(config).toContain(`import { BlogPosts } from './collections/BlogPosts'`)
    expect(config).toMatch(/collections: \[[^\]]*BlogPosts[^\]]*\]/)
    expect(config).toMatch(/'blog-posts': \{\}/)
  })

  it('--global-shared registers the collection but not in the tenant plugin map', async () => {
    const root = await project()
    await runGenerate('collection', 'notes', { cwd: root, globalShared: true })
    const config = read(root, 'src/payload.config.ts')
    expect(config).toMatch(/collections: \[[^\]]*Notes[^\]]*\]/)
    expect(config).not.toMatch(/notes: \{\}/)
    expect(read(root, 'src/collections/Notes.ts')).not.toContain('tenantScoped')
  })

  it.each(['users', 'tenants', 'media'])('refuses the built-in slug %s', async (slug) => {
    const root = await project()
    await expect(runGenerate('collection', slug, { cwd: root })).rejects.toThrow(CliError)
    expect(existsSync(join(root, `src/collections/${slug[0]!.toUpperCase()}${slug.slice(1)}.ts.new`))).toBe(false)
  })

  it('refuses a slug that already exists, without touching the config', async () => {
    const root = await project()
    await runGenerate('collection', 'notes', { cwd: root })
    const before = read(root, 'src/payload.config.ts')
    await expect(runGenerate('collection', 'Notes', { cwd: root })).rejects.toThrow(CliError)
    expect(read(root, 'src/payload.config.ts')).toBe(before)
    await expect(runGenerate('collection', 'pages', { cwd: root })).rejects.toThrow(/already exists/)
  })

  it.each([[''], ['9lives'], ['!!!']])('rejects the invalid name %j', async (name) => {
    const root = await project()
    await expect(runGenerate('collection', name, { cwd: root })).rejects.toThrow(CliError)
  })

  it('works from a subdirectory of the project', async () => {
    const root = await project()
    const result = await runGenerate('collection', 'events', { cwd: join(root, 'src', 'collections') })
    expect(result.registered).toBe(true)
    expect(existsSync(join(root, 'src/collections/Events.ts'))).toBe(true)
  })

  it('still writes the file and returns instructions when the config cannot be edited', async () => {
    const root = await project()
    const configPath = join(root, 'src/payload.config.ts')
    writeFileSync(
      configPath,
      read(root, 'src/payload.config.ts').replace(/collections: \[[^\]]*\],/, 'collections,').replace(
        'export default',
        'const collections = []\nexport default',
      ),
    )
    const result = await runGenerate('collection', 'notes', { cwd: root })
    expect(result.registered).toBe(false)
    expect(result.manualInstructions).toContain(`import { Notes } from './collections/Notes'`)
    expect(existsSync(join(root, 'src/collections/Notes.ts'))).toBe(true)
  })

  it('does not write anything with dryRun', async () => {
    const root = await project()
    const before = read(root, 'src/payload.config.ts')
    const result = await runGenerate('collection', 'notes', { cwd: root, dryRun: true })
    expect(result.files).toEqual(['src/collections/Notes.ts'])
    expect(existsSync(join(root, 'src/collections/Notes.ts'))).toBe(false)
    expect(read(root, 'src/payload.config.ts')).toBe(before)
  })
})

describe('generate global', () => {
  it('creates a per-tenant global by default', async () => {
    const root = await project()
    await runGenerate('global', 'Site Settings', { cwd: root })
    expect(existsSync(join(root, 'src/collections/SiteSettings.ts'))).toBe(true)
    expect(read(root, 'src/payload.config.ts')).toMatch(/'site-settings': \{\s*isGlobal: true\s*\}/)
  })

  it('--global-shared creates a real Payload global in `globals`', async () => {
    const root = await project()
    await runGenerate('global', 'Branding', { cwd: root, globalShared: true })
    expect(read(root, 'src/globals/Branding.ts')).toContain('GlobalConfig')
    expect(read(root, 'src/payload.config.ts')).toMatch(/globals: \[\s*Branding\s*\]/)
  })
})

describe('other generators', () => {
  it.each([
    ['block', 'CallOut', 'src/blocks/CallOut.ts', `export const CallOut: Block`],
    ['field', 'seo meta', 'src/fields/seoMeta.ts', `export const seoMeta: Field`],
    ['hook', 'Set Slug', 'src/hooks/setSlug.ts', `export const setSlug`],
    ['access', 'Owner Only', 'src/access/ownerOnly.ts', `export const ownerOnly: Access`],
  ] as const)('%s %s', async (kind, name, file, marker) => {
    const root = await project()
    const result = await runGenerate(kind, name, { cwd: root })
    expect(result.files).toEqual([file])
    expect(result.registered).toBe(false)
    expect(read(root, file)).toContain(marker)
  })

  it('refuses to overwrite without force and overwrites with it', async () => {
    const root = await project()
    await runGenerate('block', 'Hero', { cwd: root })
    writeFileSync(join(root, 'src/blocks/Hero.ts'), '// mine')
    await expect(runGenerate('block', 'Hero', { cwd: root })).rejects.toThrow(CliError)
    expect(read(root, 'src/blocks/Hero.ts')).toBe('// mine')
    await runGenerate('block', 'Hero', { cwd: root, force: true })
    expect(read(root, 'src/blocks/Hero.ts')).toContain('export const Hero: Block')
  })
})

describe('outside a project', () => {
  it('throws a CliError', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paycms-nogen-'))
    mkdirSync(join(dir, 'x'))
    await expect(runGenerate('collection', 'notes', { cwd: join(dir, 'x') })).rejects.toThrow(
      /Not inside a Payload project/,
    )
  })
})
