export type Doc = Record<string, unknown> & { id: string | number }

export interface AccessArgs {
  /** Run as this user. Only meaningful together with `overrideAccess: false`. */
  user?: unknown
  overrideAccess?: boolean
}

export interface FindArgs extends AccessArgs {
  collection: string
  where?: Record<string, unknown>
  limit?: number
  page?: number
  depth?: number
  sort?: string
  pagination?: boolean
}

export interface WriteArgs extends AccessArgs {
  collection: string
  data: Record<string, unknown>
  depth?: number
}

export interface FieldMeta {
  name?: string
  type: string
  options?: string[]
  hasMany?: boolean
}

export interface CollectionMeta {
  slug: string
  useAsTitle?: string
  /** True when the collection has a `tenant` field (added by the multi-tenant plugin). */
  tenantScoped: boolean
  fields: FieldMeta[]
}

export interface PagedDocs {
  docs: Doc[]
  totalDocs: number
  page: number
  totalPages: number
}

/** The subset of Payload's Local API the commands use. Real Payload via `fromPayload`; a stub in tests. */
export interface LocalApi {
  collections(): CollectionMeta[]
  find(args: FindArgs): Promise<PagedDocs>
  findByID(args: { collection: string; id: string | number } & AccessArgs & { depth?: number }): Promise<Doc>
  create(args: WriteArgs): Promise<Doc>
  update(args: WriteArgs & { id: string | number }): Promise<Doc>
  delete(args: { collection: string; id: string | number } & AccessArgs): Promise<unknown>
}

interface RawField {
  name?: string
  type: string
  options?: (string | { value: string })[]
  hasMany?: boolean
  fields?: RawField[]
  tabs?: { fields: RawField[] }[]
}

interface RawPayload {
  config: {
    collections: { slug: string; admin?: { useAsTitle?: string }; fields: RawField[] }[]
  }
  find(args: unknown): Promise<PagedDocs>
  findByID(args: unknown): Promise<Doc>
  create(args: unknown): Promise<Doc>
  update(args: unknown): Promise<Doc>
  delete(args: unknown): Promise<unknown>
}

/** Fields with layout containers (row, collapsible, unnamed tabs) flattened into their children. */
function flatten(fields: RawField[]): RawField[] {
  return fields.flatMap((f) => {
    if (!f.name && f.fields) return flatten(f.fields)
    if (!f.name && f.tabs) return f.tabs.flatMap((t) => flatten(t.fields))
    return [f]
  })
}

export function fromPayload(payload: unknown): LocalApi {
  const raw = payload as RawPayload
  return {
    collections() {
      return raw.config.collections
        .filter((c) => !c.slug.startsWith('payload-'))
        .map((c) => {
          const fields = flatten(c.fields)
          return {
            slug: c.slug,
            useAsTitle: c.admin?.useAsTitle,
            tenantScoped: fields.some((f) => f.name === 'tenant'),
            fields: fields.map((f) => ({
              name: f.name,
              type: f.type,
              hasMany: f.hasMany,
              options: f.options?.map((o) => (typeof o === 'string' ? o : o.value)),
            })),
          }
        })
    },
    find: (args) => raw.find(args),
    findByID: (args) => raw.findByID(args),
    create: (args) => raw.create(args),
    update: (args) => raw.update(args),
    delete: (args) => raw.delete(args),
  }
}
