import { cleanup, render } from 'ink-testing-library'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccessRules } from '../../src/core/access.js'
import type { CollectionMeta } from '../../src/core/localApi.js'
import { changedPairs, dataForm } from '../../src/tui/state/dataForm.js'
import { Access, type AccessRow } from '../../src/tui/screens/Access.js'
import { Data } from '../../src/tui/screens/Data.js'
import type { Nav } from '../../src/tui/screens/index.js'
import { Tenants } from '../../src/tui/screens/Tenants.js'
import { Users } from '../../src/tui/screens/Users.js'
import { memoryApi } from '../helpers/memoryApi.js'
import { has, settle, until } from '../helpers/ink.js'

afterEach(cleanup)

const DOWN = '\u001B[B'
const RIGHT = '\u001B[C'
const ESC = '\u001B'
const CTRL_S = '\u0013'
const size = { columns: 110, rows: 32 }
const nav = (): Nav => ({ push() {}, pop() {}, reset() {} })

const collections: CollectionMeta[] = [
  {
    slug: 'pages',
    useAsTitle: 'title',
    tenantScoped: true,
    fields: [
      { name: 'title', type: 'text' },
      { name: 'views', type: 'number' },
      { name: 'body', type: 'richText' },
      { name: 'items', type: 'array' },
      { name: 'tenant', type: 'relationship' },
    ],
  },
  { slug: 'categories', useAsTitle: 'title', tenantScoped: false, fields: [{ name: 'title', type: 'text' }] },
]

const seed = () => ({
  tenants: [
    { slug: 'acme', name: 'Acme', domain: 'acme.com' },
    { slug: 'globex', name: 'Globex' },
  ],
  users: [
    { email: 'root@x.com', roles: ['super-admin'], tenants: [] },
    { email: 'ed@x.com', roles: ['user'], tenants: [{ tenant: 1, roles: ['editor'] }] },
  ],
  pages: [
    { title: 'Alpha', views: 1, tenant: 1, items: [{ x: 1 }] },
    { title: 'Beta', tenant: 2 },
  ],
  categories: [{ title: 'news' }],
})

async function press(t: { stdin: { write: (s: string) => void } }, keys: string, ms = 70) {
  t.stdin.write(keys)
  await settle(ms)
}

describe('dataForm / changedPairs', () => {
  const pages = collections[0]!

  it('builds rows without the tenant field, with richText read-only and JSON as text', () => {
    const rows = dataForm(pages, { id: 1, title: 'Alpha', views: 1, body: { root: {} }, items: [{ x: 1 }] })
    expect(rows.map((r) => r.name)).toEqual(['title', 'views', 'body', 'items'])
    expect(rows.find((r) => r.name === 'body')).toMatchObject({ readOnly: true })
    expect(rows.find((r) => r.name === 'items')!.value).toBe('[{"x":1}]')
    expect(rows.find((r) => r.name === 'views')!.value).toBe('1')
  })

  it('hides fields Payload manages (auth internals, timestamps, upload metadata)', () => {
    const users: CollectionMeta = {
      slug: 'users',
      tenantScoped: false,
      fields: [
        { name: 'email', type: 'email' },
        { name: 'roles', type: 'select', hasMany: true },
        { name: 'salt', type: 'text' },
        { name: 'hash', type: 'text' },
        { name: 'loginAttempts', type: 'number' },
        { name: 'lockUntil', type: 'date' },
        { name: 'sessions', type: 'array' },
        { name: 'createdAt', type: 'date' },
        { name: 'updatedAt', type: 'date' },
        { name: 'filename', type: 'text' },
        { name: 'filesize', type: 'number' },
      ],
    }
    expect(dataForm(users).map((r) => r.name)).toEqual(['email', 'roles'])
  })

  it('returns only changed, editable rows as key=value pairs', () => {
    const original = dataForm(pages, { id: 1, title: 'Alpha', views: 1 })
    const edited = original.map((r) => (r.name === 'title' ? { ...r, value: 'Gamma=1' } : r))
    expect(changedPairs(edited, original)).toEqual(['title=Gamma=1'])
  })

  it('for a new document includes only the rows that were filled in', () => {
    const blank = dataForm(pages)
    const filled = blank.map((r) => (r.name === 'views' ? { ...r, value: '7' } : r))
    expect(changedPairs(filled, blank)).toEqual(['views=7'])
  })
})

describe('Data screen', () => {
  function setup() {
    const m = memoryApi({ collections, seed: seed() })
    const t = render(<Data nav={nav()} api={m.api} size={size} />)
    return { ...m, t }
  }

  async function openPages(s: ReturnType<typeof setup>) {
    await until(s.t.lastFrame, has('pages'))
    await settle()
    await press(s.t, '\r')
    await until(s.t.lastFrame, has('Alpha'))
  }

  it('lists documents of the chosen collection', async () => {
    const s = setup()
    await openPages(s)
    expect(s.t.lastFrame()).toContain('Beta')
    expect(s.t.lastFrame()).toContain('2 document')
  })

  it('creates a document for a chosen tenant', async () => {
    const s = setup()
    await openPages(s)
    await press(s.t, 'n')
    await until(s.t.lastFrame, has('Tenant'))
    await press(s.t, DOWN) // globex
    await press(s.t, '\r')
    await until(s.t.lastFrame, has('New pages'))
    await press(s.t, '\r') // edit title
    await press(s.t, 'Gamma')
    await press(s.t, '\r')
    await press(s.t, CTRL_S)
    await until(s.t.lastFrame, has('Gamma'))
    expect(s.data.pages!.at(-1)).toMatchObject({ title: 'Gamma', tenant: 2 })
  })

  it('shows validation errors inline and writes nothing', async () => {
    const s = setup()
    await openPages(s)
    await press(s.t, 'n')
    await until(s.t.lastFrame, has('Tenant'))
    await press(s.t, '\r')
    await until(s.t.lastFrame, has('New pages'))
    await press(s.t, DOWN) // views
    await press(s.t, '\r')
    await press(s.t, 'abc')
    await press(s.t, '\r')
    await press(s.t, CTRL_S)
    await until(s.t.lastFrame, has('must be a number'))
    expect(s.data.pages).toHaveLength(2)
  })

  it('edits and deletes the selected document, asking before deleting', async () => {
    const s = setup()
    await openPages(s)
    await press(s.t, 'e')
    await until(s.t.lastFrame, has('Edit pages'))
    await press(s.t, '\r')
    for (let i = 0; i < 5; i++) await press(s.t, '\u007F', 15)
    await press(s.t, 'Omega')
    await press(s.t, '\r')
    await press(s.t, CTRL_S)
    await until(s.t.lastFrame, has('Omega'))
    expect(s.data.pages![0]).toMatchObject({ title: 'Omega' })

    await press(s.t, 'd')
    await until(s.t.lastFrame, has('Delete'))
    await press(s.t, 'n')
    expect(s.data.pages).toHaveLength(2)
    await press(s.t, 'd')
    await until(s.t.lastFrame, has('Delete'))
    await press(s.t, 'y')
    await vi.waitFor(() => expect(s.data.pages).toHaveLength(1))
  })

  it('marks rich text read-only in the form', async () => {
    const s = setup()
    await openPages(s)
    await press(s.t, 'e')
    await until(s.t.lastFrame, has('edit in the admin'))
  })
})

describe('Tenants screen', () => {
  function setup() {
    const m = memoryApi({ collections, seed: seed() })
    return { ...m, t: render(<Tenants nav={nav()} api={m.api} size={size} />) }
  }

  it('lists tenants and adds one with a domain', async () => {
    const s = setup()
    await until(s.t.lastFrame, has('acme.com'))
    await press(s.t, 'a')
    await until(s.t.lastFrame, has('Tenant name'))
    await press(s.t, 'Initech')
    await press(s.t, '\r')
    await until(s.t.lastFrame, has('Domain'))
    await press(s.t, 'initech.com')
    await press(s.t, '\r')
    await until(s.t.lastFrame, has('home page'))
    await press(s.t, 'n')
    await until(s.t.lastFrame, has('initech.com'))
    expect(s.data.tenants!.at(-1)).toMatchObject({ slug: 'initech', domain: 'initech.com' })
    expect(s.data.pages).toHaveLength(2)
  })

  it('shows a duplicate as an inline error', async () => {
    const s = setup()
    await until(s.t.lastFrame, has('acme.com'))
    await press(s.t, 'a')
    await until(s.t.lastFrame, has('Tenant name'))
    await press(s.t, 'Acme')
    await press(s.t, '\r')
    await until(s.t.lastFrame, has('Domain'))
    await press(s.t, '\r')
    await until(s.t.lastFrame, has('home page'))
    await press(s.t, 'n')
    await until(s.t.lastFrame, has('already used'))
  })

  it('deletes after confirmation', async () => {
    const s = setup()
    await until(s.t.lastFrame, has('acme.com'))
    await press(s.t, 'd')
    await until(s.t.lastFrame, has('Delete tenant'))
    await press(s.t, 'y')
    await vi.waitFor(() => expect(s.data.tenants).toHaveLength(1))
  })
})

describe('Users screen', () => {
  function setup() {
    const m = memoryApi({ collections, seed: seed() })
    return { ...m, t: render(<Users nav={nav()} api={m.api} size={size} />) }
  }

  it('lists users with roles and tenants', async () => {
    const s = setup()
    await until(s.t.lastFrame, has('ed@x.com'))
    expect(s.t.lastFrame()).toContain('super-admin')
    expect(s.t.lastFrame()).toContain('acme:editor')
  })

  it('refuses to remove the last super-admin and shows why', async () => {
    const s = setup()
    await until(s.t.lastFrame, has('root@x.com'))
    await press(s.t, '\r') // action menu for root
    await until(s.t.lastFrame, has('Remove user'))
    for (let i = 0; i < 3; i++) await press(s.t, DOWN, 20)
    await press(s.t, '\r')
    await until(s.t.lastFrame, has('Delete'))
    await press(s.t, 'y')
    await until(s.t.lastFrame, has('last super-admin'))
    expect(s.data.users).toHaveLength(2)
  })

  it('assigns a tenant with a role', async () => {
    const s = setup()
    await until(s.t.lastFrame, has('ed@x.com'))
    await press(s.t, DOWN)
    await press(s.t, '\r')
    await until(s.t.lastFrame, has('Assign tenant'))
    await press(s.t, DOWN, 20) // Assign tenant (second item)
    await press(s.t, '\r')
    await until(s.t.lastFrame, has('Tenant to assign'))
    await press(s.t, DOWN) // globex
    await press(s.t, '\r')
    await until(s.t.lastFrame, has('Role in'))
    await press(s.t, DOWN) // editor -> admin? first item is editor; move to admin
    await press(s.t, '\r')
    await until(s.t.lastFrame, has('globex:admin'))
  })
})

describe('Access screen', () => {
  const rows = (): AccessRow[] => [
    { slug: 'notes', file: '/p/src/collections/Notes.ts', rules: { read: 'tenant-scoped' }, custom: { delete: 'myRule' } },
    { slug: 'pages', file: '/p/src/collections/Pages.ts', rules: {}, custom: {} },
  ]

  it('shows the grid, marking custom cells', async () => {
    const t = render(<Access nav={nav()} rows={rows()} write={vi.fn(async () => ({ ok: true as const }))} size={size} />)
    await until(t.lastFrame, has('notes'))
    expect(t.lastFrame()).toContain('tenant-scoped')
    expect(t.lastFrame()).toContain('custom')
  })

  it('sets a rule through the picker and writes the file', async () => {
    const write = vi.fn(async (_file: string, _rules: AccessRules) => ({ ok: true as const }))
    const t = render(<Access nav={nav()} rows={rows()} write={write} size={size} />)
    await until(t.lastFrame, has('notes'))
    await settle()
    await press(t, '\r') // read cell of notes
    await until(t.lastFrame, has('Rule for'))
    await press(t, '\r') // first option: public
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('/p/src/collections/Notes.ts', { read: 'public' }))
  })

  it('asks before overwriting a custom rule', async () => {
    const write = vi.fn(async (_file: string, _rules: AccessRules) => ({ ok: true as const }))
    const t = render(<Access nav={nav()} rows={rows()} write={write} size={size} />)
    await until(t.lastFrame, has('notes'))
    await settle()
    for (let i = 0; i < 3; i++) await press(t, RIGHT, 20) // delete column
    await press(t, '\r')
    await until(t.lastFrame, has('custom rule'))
    await press(t, 'n')
    expect(write).not.toHaveBeenCalled()
    await press(t, '\r')
    await until(t.lastFrame, has('custom rule'))
    await press(t, 'y')
    await until(t.lastFrame, has('Rule for'))
    await press(t, '\r')
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('/p/src/collections/Notes.ts', { delete: 'public' }))
  })

  it('shows manual instructions when the file cannot be edited', async () => {
    const write = vi.fn(async () => ({ ok: false as const, manualInstructions: 'Add these manually: read: () => true' }))
    const t = render(<Access nav={nav()} rows={rows()} write={write} size={size} />)
    await until(t.lastFrame, has('notes'))
    await settle()
    await press(t, '\r')
    await until(t.lastFrame, has('Rule for'))
    await press(t, '\r')
    await until(t.lastFrame, has('Add these manually'))
  })
})
