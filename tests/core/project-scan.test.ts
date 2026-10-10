import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCreate } from '../../src/commands/create.js'
import { runGenerate } from '../../src/commands/generate.js'
import { listProjectCollections } from '../../src/core/project-scan.js'
import { parseFieldSpecs } from '../../src/core/fields.js'

async function project(template: 'blank' | 'corporate' = 'blank') {
  const cwd = mkdtempSync(join(tmpdir(), 'paycms-scan-'))
  await runCreate({ name: 'site', template, db: 'postgres', pm: 'npm', yes: true, install: false, cwd })
  const root = join(cwd, 'site')
  return { root, config: join(root, 'src/payload.config.ts') }
}

describe('listProjectCollections', () => {
  it('lists collections with tenant scope and field counts', async () => {
    const { config } = await project()
    const rows = listProjectCollections(config)
    const by = Object.fromEntries(rows.map((r) => [r.slug, r]))
    expect(by.pages).toMatchObject({ tenantScoped: true, fieldCount: 3 })
    expect(by.media).toMatchObject({ tenantScoped: true })
    expect(by.users).toMatchObject({ tenantScoped: false, fieldCount: 1 })
    expect(by.tenants).toMatchObject({ tenantScoped: false, fieldCount: 4 })
  })

  it('reflects generated collections and --global-shared', async () => {
    const { root, config } = await project()
    await runGenerate('collection', 'notes', { cwd: root, fields: parseFieldSpecs('a:text,b:number') })
    await runGenerate('collection', 'lookups', { cwd: root, globalShared: true })
    const by = Object.fromEntries(listProjectCollections(config).map((r) => [r.slug, r]))
    expect(by.notes).toMatchObject({ tenantScoped: true, fieldCount: 2, file: 'collections/Notes.ts' })
    expect(by.lookups).toMatchObject({ tenantScoped: false, fieldCount: 1 })
  })

  it('treats per-tenant globals in the plugin map as tenant-scoped', async () => {
    const { config } = await project('corporate')
    const by = Object.fromEntries(listProjectCollections(config).map((r) => [r.slug, r]))
    expect(by.header).toMatchObject({ tenantScoped: true })
  })
})
