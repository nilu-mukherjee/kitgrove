import { describe, expect, it } from 'vitest'
import {
  addTenant,
  listTenants,
  normalizeDomain,
  removeTenant,
  type TenantPayload,
} from '../../src/commands/tenant.js'
import { CliError } from '../../src/core/errors.js'

interface Doc {
  id: number
  [key: string]: unknown
}

/** In-memory stand-in implementing just the Local API calls the tenant commands use. */
function stub() {
  const data: Record<string, Doc[]> = { tenants: [], pages: [] }
  let next = 1
  const payload: TenantPayload = {
    async find({ collection, where }) {
      const entries = Object.entries(where ?? {}) as [string, { equals: unknown }][]
      const docs = (data[collection] ?? []).filter((d) => entries.every(([k, v]) => d[k] === v.equals))
      return { docs }
    },
    async create({ collection, data: doc }) {
      const created = { id: next++, ...doc } as Doc
      ;(data[collection] ??= []).push(created)
      return created
    },
    async delete({ collection, id }) {
      data[collection] = (data[collection] ?? []).filter((d) => d.id !== id)
    },
  }
  return { payload, data }
}

describe('normalizeDomain', () => {
  it.each([
    ['Acme.com', 'acme.com'],
    ['https://Acme.com/', 'acme.com'],
    ['http://www.acme.com/about?x=1', 'www.acme.com'],
    ['acme.com:3000', 'acme.com'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected)
  })

  it.each([[''], ['not a domain'], ['a b.com']])('rejects %j', (input) => {
    expect(() => normalizeDomain(input)).toThrow(CliError)
  })
})

describe('addTenant', () => {
  it('derives the slug from the name and normalises the domain', async () => {
    const { payload } = stub()
    const t = await addTenant(payload, { name: 'Acme Corp', domain: 'https://Acme.com/' })
    expect(t).toMatchObject({ name: 'Acme Corp', slug: 'acme-corp', domain: 'acme.com' })
  })

  it('rejects a duplicate slug and creates nothing', async () => {
    const { payload, data } = stub()
    await addTenant(payload, { name: 'Acme' })
    await expect(addTenant(payload, { name: 'ACME' })).rejects.toThrow(/slug "acme" is already used/)
    expect(data.tenants).toHaveLength(1)
  })

  it('rejects a duplicate domain and creates nothing', async () => {
    const { payload, data } = stub()
    await addTenant(payload, { name: 'One', domain: 'a.com' })
    await expect(addTenant(payload, { name: 'Two', domain: 'A.com' })).rejects.toThrow(
      /domain "a.com" is already used/,
    )
    expect(data.tenants).toHaveLength(1)
  })

  it('creates a home page for the tenant with --starter', async () => {
    const { payload, data } = stub()
    const t = await addTenant(payload, { name: 'Acme', starter: true })
    expect(data.pages).toEqual([expect.objectContaining({ title: 'Acme', slug: 'home', tenant: t.id })])
  })
})

describe('listTenants / removeTenant', () => {
  it('lists slug and domain', async () => {
    const { payload } = stub()
    await addTenant(payload, { name: 'Acme', domain: 'acme.com' })
    await addTenant(payload, { name: 'Globex' })
    expect(await listTenants(payload)).toEqual([
      expect.objectContaining({ slug: 'acme', domain: 'acme.com' }),
      expect.objectContaining({ slug: 'globex' }),
    ])
  })

  it('removes a tenant by slug', async () => {
    const { payload, data } = stub()
    await addTenant(payload, { name: 'Acme' })
    await removeTenant(payload, 'acme')
    expect(data.tenants).toHaveLength(0)
  })

  it('errors for an unknown slug', async () => {
    const { payload } = stub()
    await expect(removeTenant(payload, 'nope')).rejects.toThrow(/No tenant with slug "nope"/)
  })
})
