import { describe, expect, it } from 'vitest'
import {
  createDocument,
  deleteDocument,
  getDocument,
  listCollections,
  listDocuments,
  updateDocument,
} from '../../src/commands/data.js'
import { CliError } from '../../src/core/errors.js'
import type { CollectionMeta } from '../../src/core/localApi.js'
import { memoryApi } from '../helpers/memoryApi.js'

const collections: CollectionMeta[] = [
  {
    slug: 'pages',
    useAsTitle: 'title',
    tenantScoped: true,
    fields: [
      { name: 'title', type: 'text' },
      { name: 'views', type: 'number' },
      { name: 'tenant', type: 'relationship' },
    ],
  },
  { slug: 'categories', useAsTitle: 'title', tenantScoped: false, fields: [{ name: 'title', type: 'text' }] },
]

function setup() {
  return memoryApi({
    collections,
    seed: {
      tenants: [
        { slug: 'acme', name: 'Acme' },
        { slug: 'globex', name: 'Globex' },
      ],
      users: [{ email: 'ed@x.com', roles: ['user'] }],
      pages: [
        { title: 'A', tenant: 1 },
        { title: 'B', tenant: 2 },
        { title: 'C', tenant: 1 },
      ],
      categories: [{ title: 'news' }],
    },
  })
}

describe('listCollections', () => {
  it('returns the collections metadata', () => {
    expect(listCollections(setup().api).map((c) => c.slug)).toEqual(['pages', 'categories'])
  })
})

describe('listDocuments', () => {
  it('filters by tenant slug and uses overrideAccess by default', async () => {
    const { api, calls } = setup()
    const r = await listDocuments(api, { collection: 'pages', tenant: 'acme' })
    expect(r.docs.map((d) => d.title)).toEqual(['A', 'C'])
    const find = calls.filter((c) => c.method === 'find').at(-1)!
    expect(find.args).toMatchObject({ collection: 'pages', overrideAccess: true })
    expect(find.args.user).toBeUndefined()
  })

  it('adds --where pairs, coerced by field type', async () => {
    const { api } = setup()
    const r = await listDocuments(api, { collection: 'pages', where: ['title=B'] })
    expect(r.docs.map((d) => d.title)).toEqual(['B'])
    await expect(listDocuments(api, { collection: 'pages', where: ['views=abc'] })).rejects.toThrow(/number/)
  })

  it('runs as a user with access enforced for --as', async () => {
    const { api, calls } = setup()
    await listDocuments(api, { collection: 'pages', as: 'ED@x.com' })
    const find = calls.filter((c) => c.method === 'find').at(-1)!
    expect(find.args).toMatchObject({ overrideAccess: false, user: { email: 'ed@x.com' } })
  })

  it('errors for an unknown --as user instead of listing unfiltered', async () => {
    const { api, calls } = setup()
    await expect(listDocuments(api, { collection: 'pages', as: 'nobody@x.com' })).rejects.toThrow(/No user/)
    expect(calls.filter((c) => c.method === 'find' && c.args.collection === 'pages')).toEqual([])
  })

  it('paginates and returns an empty page beyond the last one', async () => {
    const { api } = setup()
    const first = await listDocuments(api, { collection: 'pages', limit: 2, page: 1 })
    expect(first).toMatchObject({ totalDocs: 3, totalPages: 2, page: 1 })
    expect(first.docs).toHaveLength(2)
    const beyond = await listDocuments(api, { collection: 'pages', limit: 2, page: 9 })
    expect(beyond.docs).toEqual([])
    expect(beyond.totalDocs).toBe(3)
  })

  it('rejects an unknown collection with a hint, and --tenant on a non tenant-scoped one', async () => {
    const { api } = setup()
    await expect(listDocuments(api, { collection: 'pgaes' })).rejects.toThrow(/kitgrove data collections/)
    await expect(listDocuments(api, { collection: 'categories', tenant: 'acme' })).rejects.toThrow(/not tenant-scoped/)
    await expect(listDocuments(api, { collection: 'pages', tenant: 'nope' })).rejects.toThrow(/No tenant/)
  })
})

describe('createDocument', () => {
  it('sets the tenant id and coerces --set values', async () => {
    const { api, data } = setup()
    const d = await createDocument(api, { collection: 'pages', tenant: 'globex', set: ['title=Hi=there', 'views=3'] })
    expect(d).toMatchObject({ title: 'Hi=there', views: 3, tenant: 2 })
    expect(data.pages).toHaveLength(4)
  })

  it('requires a known tenant for tenant-scoped collections and writes nothing otherwise', async () => {
    const { api, data } = setup()
    await expect(createDocument(api, { collection: 'pages', set: ['title=x'] })).rejects.toThrow(/--tenant/)
    await expect(createDocument(api, { collection: 'pages', tenant: 'nope', set: ['title=x'] })).rejects.toThrow(/No tenant/)
    expect(data.pages).toHaveLength(3)
  })

  it('merges --json with --set (set wins) and rejects unknown keys', async () => {
    const { api } = setup()
    const d = await createDocument(api, { collection: 'categories', json: { title: 'a' }, set: ['title=b'] })
    expect(d.title).toBe('b')
    await expect(createDocument(api, { collection: 'categories', json: { nope: 1 } })).rejects.toThrow(/Unknown field "nope"/)
  })
})

describe('updateDocument / getDocument / deleteDocument', () => {
  it('updates, reads and deletes', async () => {
    const { api, data } = setup()
    expect((await updateDocument(api, { collection: 'categories', id: 7, set: ['title=sport'] })).title).toBe('sport')
    expect((await getDocument(api, { collection: 'categories', id: 7 })).title).toBe('sport')
    await deleteDocument(api, { collection: 'categories', id: 7 })
    expect(data.categories).toEqual([])
  })

  it('rejects an update with nothing to change', async () => {
    const { api } = setup()
    await expect(updateDocument(api, { collection: 'categories', id: 7 })).rejects.toThrow(CliError)
  })

  it('passes the --as user and overrideAccess:false to every write', async () => {
    const { api, calls } = setup()
    await updateDocument(api, { collection: 'categories', id: 7, set: ['title=z'], as: 'ed@x.com' })
    await deleteDocument(api, { collection: 'categories', id: 7, as: 'ed@x.com' })
    for (const c of calls.filter((x) => x.method === 'update' || x.method === 'delete')) {
      expect(c.args).toMatchObject({ overrideAccess: false, user: { email: 'ed@x.com' } })
    }
  })
})
