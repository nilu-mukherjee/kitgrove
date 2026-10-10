import type { CollectionMeta, Doc, FindArgs, LocalApi, WriteArgs } from '../../src/core/localApi.js'

export interface Call {
  method: 'find' | 'findByID' | 'create' | 'update' | 'delete'
  args: Record<string, unknown>
}

type Where = Record<string, unknown>

function matches(doc: Doc, where?: Where): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'and') return (cond as Where[]).every((w) => matches(doc, w))
    if (key === 'or') return (cond as Where[]).some((w) => matches(doc, w))
    const c = cond as { equals?: unknown; in?: unknown[] }
    const value = doc[key]
    if ('equals' in c) return value === c.equals
    if (c.in) return c.in.includes(value)
    return true
  })
}

/** An in-memory LocalApi that records every call, for command tests. */
export function memoryApi(opts: { collections?: CollectionMeta[]; seed?: Record<string, Record<string, unknown>[]> } = {}) {
  const data: Record<string, Doc[]> = {}
  let nextId = 1
  for (const [slug, docs] of Object.entries(opts.seed ?? {})) {
    data[slug] = docs.map((d) => ({ id: nextId++, ...d }) as Doc)
  }
  const calls: Call[] = []
  const rows = (c: string) => (data[c] ??= [])

  const api: LocalApi = {
    collections: () => opts.collections ?? [],
    async find(a: FindArgs) {
      calls.push({ method: 'find', args: { ...a } })
      const all = rows(a.collection).filter((d) => matches(d, a.where))
      const limit = a.limit === 0 || a.pagination === false ? all.length || 1 : (a.limit ?? 10)
      const page = a.page ?? 1
      const totalPages = Math.max(1, Math.ceil(all.length / limit))
      const start = (page - 1) * limit
      return {
        docs: a.pagination === false || a.limit === 0 ? all : all.slice(start, start + limit),
        totalDocs: all.length,
        page,
        totalPages,
      }
    },
    async findByID(a) {
      calls.push({ method: 'findByID', args: { ...a } })
      const doc = rows(a.collection).find((d) => String(d.id) === String(a.id))
      if (!doc) throw new Error(`Not Found`)
      return doc
    },
    async create(a: WriteArgs) {
      calls.push({ method: 'create', args: { ...a } })
      const doc = { id: nextId++, ...a.data } as Doc
      rows(a.collection).push(doc)
      return doc
    },
    async update(a) {
      calls.push({ method: 'update', args: { ...a } })
      const doc = rows(a.collection).find((d) => String(d.id) === String(a.id))
      if (!doc) throw new Error(`Not Found`)
      Object.assign(doc, a.data)
      return doc
    },
    async delete(a) {
      calls.push({ method: 'delete', args: { ...a } })
      data[a.collection] = rows(a.collection).filter((d) => String(d.id) !== String(a.id))
      return {}
    },
  }
  return { api, data, calls }
}
