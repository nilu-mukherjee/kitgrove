import { describe, expect, it } from 'vitest'
import { fromPayload } from '../../src/core/localApi.js'

function fakePayload() {
  const calls: { method: string; args: unknown }[] = []
  const record = (method: string, result: unknown) => async (args: unknown) => {
    calls.push({ method, args })
    return result
  }
  return {
    calls,
    config: {
      collections: [
        {
          slug: 'pages',
          admin: { useAsTitle: 'title' },
          fields: [
            { name: 'title', type: 'text' },
            { name: 'tenant', type: 'relationship' },
            { name: 'status', type: 'select', options: ['draft', { label: 'Live', value: 'live' }] },
            { type: 'row', fields: [{ name: 'inRow', type: 'text' }] },
          ],
        },
        { slug: 'users', admin: { useAsTitle: 'email' }, fields: [{ name: 'email', type: 'email' }] },
        { slug: 'payload-preferences', fields: [] },
      ],
    },
    find: record('find', { docs: [], totalDocs: 0, page: 1, totalPages: 1 }),
    findByID: record('findByID', { id: 1 }),
    create: record('create', { id: 2 }),
    update: record('update', { id: 3 }),
    delete: record('delete', { id: 4 }),
  }
}

describe('fromPayload', () => {
  it('lists collections, flags tenant-scoped ones and hides payload-* internals', () => {
    const api = fromPayload(fakePayload())
    expect(api.collections().map((c) => c.slug)).toEqual(['pages', 'users'])
    const [pages, users] = api.collections()
    expect(pages).toMatchObject({ useAsTitle: 'title', tenantScoped: true })
    expect(users).toMatchObject({ useAsTitle: 'email', tenantScoped: false })
  })

  it('normalises select options to strings and flattens layout fields', () => {
    const [pages] = fromPayload(fakePayload()).collections()
    expect(pages!.fields.find((f) => f.name === 'status')!.options).toEqual(['draft', 'live'])
    expect(pages!.fields.map((f) => f.name)).toContain('inRow')
  })

  it('passes arguments through to the matching Payload methods', async () => {
    const raw = fakePayload()
    const api = fromPayload(raw)
    await api.find({ collection: 'pages', limit: 5, user: { id: 1 }, overrideAccess: false })
    await api.findByID({ collection: 'pages', id: 7 })
    await api.create({ collection: 'pages', data: { title: 'x' } })
    await api.update({ collection: 'pages', id: 7, data: { title: 'y' } })
    await api.delete({ collection: 'pages', id: 7 })
    expect(raw.calls.map((c) => c.method)).toEqual(['find', 'findByID', 'create', 'update', 'delete'])
    expect(raw.calls[0]!.args).toEqual({ collection: 'pages', limit: 5, user: { id: 1 }, overrideAccess: false })
    expect(raw.calls[3]!.args).toEqual({ collection: 'pages', id: 7, data: { title: 'y' } })
  })
})
