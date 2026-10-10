import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACCESS_RULES,
  type AccessRule,
  ensureAccessHelpers,
  parseAccessFlag,
  readAccess,
  renderAccessBlock,
  setAccess,
} from '../../src/core/access.js'
import { CliError } from '../../src/core/errors.js'

const BASE = `import type { CollectionConfig } from 'payload'

import { tenantScoped } from '../access/tenantScoped'

export const Notes: CollectionConfig = {
  slug: 'notes',
  access: {
    read: tenantScoped,
  },
  admin: { useAsTitle: 'title' },
  fields: [],
}
`

const write = (content: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'kitgrove-access-'))
  const path = join(dir, 'Notes.ts')
  writeFileSync(path, content)
  return path
}
const read = (p: string) => readFileSync(p, 'utf8')

describe('parseAccessFlag', () => {
  it('parses op=rule pairs', () => {
    expect(parseAccessFlag('read=public,update=tenant-editor')).toEqual({
      read: 'public',
      update: 'tenant-editor',
    })
  })

  it.each([
    ['read=nope', /Unknown access rule "nope".*public/],
    ['bogus=public', /Unknown operation "bogus".*read, create, update, delete/],
    ['read', /op=rule/],
    ['', /op=rule/],
  ])('rejects %j', (input, message) => {
    expect(() => parseAccessFlag(input)).toThrow(CliError)
    expect(() => parseAccessFlag(input)).toThrow(message)
  })
})

describe('renderAccessBlock', () => {
  it('is empty without rules', () => {
    expect(renderAccessBlock({})).toEqual({ block: '', imports: '' })
  })

  it('emits only the given operations in canonical order, with their imports', () => {
    const { block, imports } = renderAccessBlock({ update: 'tenant-editor', read: 'public' })
    expect(block).toBe(
      '  access: {\n    read: () => true,\n    update: tenantEditorOrAdmin,\n  },\n',
    )
    expect(imports).toBe(`import { tenantEditorOrAdmin } from '../access/tenantEditorOrAdmin'\n`)
  })

  it('matches the historical default for tenant-scoped read', () => {
    expect(renderAccessBlock({ read: 'tenant-scoped' })).toEqual({
      block: '  access: {\n    read: tenantScoped,\n  },\n',
      imports: `import { tenantScoped } from '../access/tenantScoped'\n`,
    })
  })
})

describe('readAccess', () => {
  it('reads known rules', () => {
    expect(readAccess(write(BASE))).toEqual({ rules: { read: 'tenant-scoped' }, custom: {} })
  })

  it('reports expressions outside the vocabulary as custom', () => {
    const src = BASE.replace('read: tenantScoped,', 'read: tenantScoped,\n    delete: ({ req }) => req.user?.id === 1,')
    expect(readAccess(write(src))).toEqual({
      rules: { read: 'tenant-scoped' },
      custom: { delete: '({ req }) => req.user?.id === 1' },
    })
  })

  it('returns an empty result when there is no access block and null without a collection', () => {
    expect(readAccess(write(BASE.replace(/  access: \{[^}]*\},\n/, '')))).toEqual({ rules: {}, custom: {} })
    expect(readAccess(write('export default {}\n'))).toBeNull()
  })
})

describe('setAccess', () => {
  it('sets one operation, keeps the others byte-identical and adds the import once', () => {
    const path = write(BASE)
    expect(setAccess(path, { update: 'tenant-editor' })).toEqual({ ok: true })
    const out = read(path)
    expect(out).toContain('    read: tenantScoped,\n')
    expect(out).toMatch(/update: tenantEditorOrAdmin/)
    expect(out.match(/import \{ tenantEditorOrAdmin \}/g)).toHaveLength(1)
    expect(out).toContain(`import { tenantScoped } from '../access/tenantScoped'`)
  })

  it('is idempotent', () => {
    const path = write(BASE)
    setAccess(path, { update: 'tenant-editor', read: 'public' })
    const once = read(path)
    expect(setAccess(path, { update: 'tenant-editor', read: 'public' })).toEqual({ ok: true })
    expect(read(path)).toBe(once)
  })

  it('adds an access block when there is none', () => {
    const path = write(BASE.replace(/  access: \{[^}]*\},\n/, ''))
    expect(setAccess(path, { read: 'authenticated' })).toEqual({ ok: true })
    expect(readAccess(path)).toEqual({ rules: { read: 'authenticated' }, custom: {} })
  })

  it('leaves custom operations untouched', () => {
    const src = BASE.replace('read: tenantScoped,', 'read: tenantScoped,\n    delete: myCustomRule,')
    const path = write(src)
    setAccess(path, { read: 'public' })
    expect(read(path)).toContain('delete: myCustomRule,')
    expect(readAccess(path)!.rules.read).toBe('public')
  })

  it('round-trips every rule through set then read', () => {
    for (const rule of ACCESS_RULES) {
      const path = write(BASE)
      expect(setAccess(path, { create: rule as AccessRule })).toEqual({ ok: true })
      expect(readAccess(path)!.rules.create).toBe(rule)
    }
  })

  it('refuses, writing nothing, when access contains a spread', () => {
    const src = BASE.replace('read: tenantScoped,', '...base,\n    read: tenantScoped,')
    const path = write(src)
    const result = setAccess(path, { read: 'public' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.manualInstructions).toContain('read: () => true')
    expect(read(path)).toBe(src)
  })

  it('refuses when the file has no collection config', () => {
    const path = write('export const X = 1\n')
    expect(setAccess(path, { read: 'public' }).ok).toBe(false)
    expect(read(path)).toBe('export const X = 1\n')
  })
})

describe('ensureAccessHelpers', () => {
  it('creates the helper files that are missing and reports them', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'kitgrove-helpers-'))
    const created = ensureAccessHelpers(srcDir, { update: 'tenant-editor' })
    expect(created.sort()).toEqual(
      ['access/isSuperAdmin.ts', 'access/tenantAdminOnly.ts', 'access/tenantEditorOrAdmin.ts', 'access/tenantScoped.ts'].sort(),
    )
    expect(existsSync(join(srcDir, 'access/tenantEditorOrAdmin.ts'))).toBe(true)
    expect(ensureAccessHelpers(srcDir, { update: 'tenant-editor' })).toEqual([])
  })

  it('creates nothing for rules that need no helper', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'kitgrove-helpers-'))
    expect(ensureAccessHelpers(srcDir, { read: 'public', create: 'authenticated' })).toEqual([])
  })
})
