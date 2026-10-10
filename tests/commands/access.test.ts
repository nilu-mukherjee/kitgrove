import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAccessSet, runAccessShow } from '../../src/commands/access.js'
import { runCreate } from '../../src/commands/create.js'
import { runGenerate } from '../../src/commands/generate.js'
import { CliError } from '../../src/core/errors.js'

async function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'paycms-acc-'))
  await runCreate({ name: 'site', template: 'blank', db: 'postgres', pm: 'npm', yes: true, install: false, cwd })
  const root = join(cwd, 'site')
  await runGenerate('collection', 'Case Studies', { cwd: root })
  return root
}

describe('runAccessSet', () => {
  it('changes one operation of an existing collection, found by slug or name', async () => {
    const root = await project()
    const r = await runAccessSet({ cwd: root, collection: 'case-studies', rules: { update: 'tenant-editor' } })
    expect(r.file).toBe('src/collections/CaseStudies.ts')
    const file = readFileSync(join(root, r.file), 'utf8')
    expect(file).toContain('read: tenantScoped,')
    expect(file).toContain('update: tenantEditorOrAdmin,')
    await runAccessSet({ cwd: root, collection: 'CaseStudies', rules: { delete: 'super-admin' } })
    expect(readFileSync(join(root, r.file), 'utf8')).toContain('delete: isSuperAdmin,')
  })

  it('rejects an unknown collection, listing the existing ones', async () => {
    const root = await project()
    await expect(runAccessSet({ cwd: root, collection: 'nope', rules: { read: 'public' } })).rejects.toThrow(
      /No collection "nope".*case-studies/,
    )
  })

  it('rejects an empty rule set', async () => {
    const root = await project()
    await expect(runAccessSet({ cwd: root, collection: 'case-studies', rules: {} })).rejects.toThrow(CliError)
  })

  it('returns instructions and leaves the file alone when the access block has a spread', async () => {
    const root = await project()
    const file = join(root, 'src/collections/CaseStudies.ts')
    const src = readFileSync(file, 'utf8').replace('read: tenantScoped,', '...base,\n    read: tenantScoped,')
    writeFileSync(file, src)
    const r = await runAccessSet({ cwd: root, collection: 'case-studies', rules: { read: 'public' } })
    expect(r.manualInstructions).toContain('read: () => true')
    expect(readFileSync(file, 'utf8')).toBe(src)
  })
})

describe('runAccessShow', () => {
  it('lists the rules of one or all collections', async () => {
    const root = await project()
    await runAccessSet({ cwd: root, collection: 'case-studies', rules: { create: 'authenticated' } })
    const one = await runAccessShow({ cwd: root, collection: 'case-studies' })
    expect(one).toEqual([
      expect.objectContaining({
        collection: 'case-studies',
        rules: { read: 'tenant-scoped', create: 'authenticated' },
      }),
    ])
    const all = await runAccessShow({ cwd: root })
    expect(all.map((c) => c.collection)).toEqual(expect.arrayContaining(['pages', 'media', 'case-studies']))
  })
})
