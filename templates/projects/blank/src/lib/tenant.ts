import type { Payload } from 'payload'

export interface TenantRef {
  id: string | number
  slug: string
}

interface ResolveInput {
  /** Raw `Host` header. */
  host?: string | null
  /** `x-tenant` header, honoured on localhost only. */
  tenantHeader?: string | null
  /** `?tenant=` search param, honoured on localhost only. */
  tenantParam?: string | null
}

const LOCAL_HOSTS = new Set(['', 'localhost', '127.0.0.1', '[::1]'])

/** Resolves which tenant (site) a request is for: by `domain`, or by slug during local dev. */
export async function resolveTenant(payload: Payload, input: ResolveInput): Promise<TenantRef | null> {
  const hostname = (input.host ?? '').split(':')[0]!.toLowerCase()

  const findOne = async (field: 'domain' | 'slug', value: string): Promise<TenantRef | null> => {
    const { docs } = await payload.find({
      collection: 'tenants',
      where: { [field]: { equals: value } },
      limit: 1,
      depth: 0,
      pagination: false,
    })
    const doc = docs[0]
    return doc ? { id: doc.id, slug: doc.slug as string } : null
  }

  if (!LOCAL_HOSTS.has(hostname)) {
    const byDomain = await findOne('domain', hostname)
    if (byDomain) return byDomain
  }

  const slug = input.tenantParam || input.tenantHeader
  if (slug && LOCAL_HOSTS.has(hostname)) return findOne('slug', slug)
  return null
}
