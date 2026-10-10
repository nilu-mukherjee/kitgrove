import { readFileSync } from 'node:fs'
import * as p from '@clack/prompts'
import type { Command } from 'commander'
import { checkKnownKeys, coerceSet } from '../core/coerce.js'
import { CliError } from '../core/errors.js'
import type { CollectionMeta, Doc, LocalApi, PagedDocs } from '../core/localApi.js'
import { withLocalApi } from '../core/payload.js'
import { requireProject } from '../core/project.js'

export function listCollections(api: LocalApi): CollectionMeta[] {
  return api.collections()
}

function metaFor(api: LocalApi, slug: string): CollectionMeta {
  const all = api.collections()
  const meta = all.find((c) => c.slug === slug)
  if (!meta) {
    throw new CliError(
      `No collection "${slug}". Run \`grovekit data collections\`; available: ${all.map((c) => c.slug).join(', ') || '(none)'}.`,
    )
  }
  return meta
}

async function tenantId(api: LocalApi, slug: string): Promise<string | number> {
  const { docs } = await api.find({ collection: 'tenants', where: { slug: { equals: slug } }, limit: 1, depth: 0 })
  const t = docs[0]
  if (!t) throw new CliError(`No tenant with slug "${slug}".`)
  return t.id
}

/** Resolves the user for `--as`; throws rather than falling back to an unfiltered query. */
export async function asUser(api: LocalApi, email: string): Promise<Doc> {
  const wanted = email.trim().toLowerCase()
  const { docs } = await api.find({ collection: 'users', limit: 0, pagination: false, depth: 0 })
  const user = docs.find((u) => String(u.email).toLowerCase() === wanted)
  if (!user) throw new CliError(`No user with email "${wanted}" (for --as).`)
  return user
}

async function accessArgs(api: LocalApi, as?: string) {
  if (!as) return { overrideAccess: true }
  return { user: await asUser(api, as), overrideAccess: false }
}

export interface ListOptions {
  collection: string
  tenant?: string
  where?: string[]
  limit?: number
  page?: number
  as?: string
}

export async function listDocuments(api: LocalApi, o: ListOptions): Promise<PagedDocs> {
  const meta = metaFor(api, o.collection)
  const conditions: Record<string, unknown>[] = []

  if (o.tenant) {
    if (!meta.tenantScoped) throw new CliError(`Collection "${o.collection}" is not tenant-scoped; drop --tenant.`)
    conditions.push({ tenant: { equals: await tenantId(api, o.tenant) } })
  }
  for (const pair of o.where ?? []) {
    const eq = pair.indexOf('=')
    if (eq > 0 && pair.slice(0, eq).trim() === 'id') {
      const v = pair.slice(eq + 1)
      conditions.push({ id: { equals: /^\d+$/.test(v) ? Number(v) : v } })
      continue
    }
    const [[field, value]] = Object.entries(coerceSet(meta, [pair])) as [[string, unknown]]
    conditions.push({ [field]: { equals: value } })
  }

  return api.find({
    collection: o.collection,
    where: conditions.length ? { and: conditions } : undefined,
    limit: o.limit ?? 20,
    page: o.page ?? 1,
    depth: 0,
    ...(await accessArgs(api, o.as)),
  })
}

export async function getDocument(api: LocalApi, o: { collection: string; id: string | number; as?: string }): Promise<Doc> {
  metaFor(api, o.collection)
  return api.findByID({ collection: o.collection, id: o.id, depth: 0, ...(await accessArgs(api, o.as)) })
}

function dataFrom(meta: CollectionMeta, set?: string[], json?: Record<string, unknown>): Record<string, unknown> {
  if (json) checkKnownKeys(meta, json)
  return { ...(json ?? {}), ...(set ? coerceSet(meta, set) : {}) }
}

export interface WriteOptions {
  collection: string
  tenant?: string
  set?: string[]
  json?: Record<string, unknown>
  as?: string
}

export async function createDocument(api: LocalApi, o: WriteOptions): Promise<Doc> {
  const meta = metaFor(api, o.collection)
  const data = dataFrom(meta, o.set, o.json)

  if (meta.tenantScoped) {
    if (!o.tenant) throw new CliError(`"${o.collection}" is tenant-scoped: pass --tenant <slug>.`)
    data.tenant = await tenantId(api, o.tenant)
  } else if (o.tenant) {
    throw new CliError(`Collection "${o.collection}" is not tenant-scoped; drop --tenant.`)
  }
  return api.create({ collection: o.collection, data, ...(await accessArgs(api, o.as)) })
}

export async function updateDocument(
  api: LocalApi,
  o: { collection: string; id: string | number; set?: string[]; json?: Record<string, unknown>; as?: string },
): Promise<Doc> {
  const meta = metaFor(api, o.collection)
  const data = dataFrom(meta, o.set, o.json)
  if (Object.keys(data).length === 0) throw new CliError('Nothing to update: pass --set key=value or --json <file>.')
  return api.update({ collection: o.collection, id: o.id, data, ...(await accessArgs(api, o.as)) })
}

export async function deleteDocument(
  api: LocalApi,
  o: { collection: string; id: string | number; as?: string },
): Promise<void> {
  metaFor(api, o.collection)
  await api.delete({ collection: o.collection, id: o.id, ...(await accessArgs(api, o.as)) })
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)))
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd()).join('\n')
}

const collect = (value: string, previous: string[] = []) => [...previous, value]

function readJsonFile(path: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch (err) {
    throw new CliError(`Could not read a JSON object from ${path}: ${(err as Error).message}`)
  }
}

const printDoc = (d: Doc) => console.log(JSON.stringify(d, null, 2))

export function registerData(program: Command): void {
  const data = program.command('data').description('Browse and edit documents in the current project')
  const project = () => requireProject(process.cwd())

  data
    .command('collections')
    .description('List collections')
    .action(async () => {
      const rows = await withLocalApi(project(), async (api) => listCollections(api))
      console.log(
        table([
          ['COLLECTION', 'TENANT-SCOPED', 'TITLE FIELD'],
          ...rows.map((c) => [c.slug, c.tenantScoped ? 'yes' : 'no', c.useAsTitle ?? 'id']),
        ]),
      )
    })

  data
    .command('list <collection>')
    .description('List documents')
    .option('--tenant <slug>')
    .option('--where <field=value>', 'filter (repeatable)', collect)
    .option('--limit <n>', 'page size', (v) => Number(v), 20)
    .option('--page <n>', 'page number', (v) => Number(v), 1)
    .option('--as <email>', 'run as this user, with access control enforced')
    .option('--json', 'print documents as JSON')
    .action(async (collection: string, o: Omit<ListOptions, 'collection'> & { json?: boolean }) => {
      const { result, meta } = await withLocalApi(project(), async (api) => ({
        result: await listDocuments(api, { collection, ...o }),
        meta: metaFor(api, collection),
      }))
      if (o.json) return console.log(JSON.stringify(result, null, 2))
      const title = meta.useAsTitle && meta.useAsTitle !== 'id' ? meta.useAsTitle : null
      console.log(
        table([
          ['ID', ...(title ? [title.toUpperCase()] : []), 'UPDATED'],
          ...result.docs.map((d) => [String(d.id), ...(title ? [String(d[title] ?? '')] : []), String(d.updatedAt ?? '')]),
        ]),
      )
      console.log(`\n${result.totalDocs} document(s), page ${result.page} of ${result.totalPages}`)
    })

  data
    .command('get <collection> <id>')
    .option('--as <email>')
    .action(async (collection: string, id: string, o: { as?: string }) => {
      printDoc(await withLocalApi(project(), (api) => getDocument(api, { collection, id, ...o })))
    })

  data
    .command('create <collection>')
    .option('--tenant <slug>')
    .option('--set <key=value>', 'field value (repeatable)', collect)
    .option('--json <file>', 'JSON object with field values')
    .option('--as <email>')
    .action(async (collection: string, o: { tenant?: string; set?: string[]; json?: string; as?: string }) => {
      const json = o.json ? readJsonFile(o.json) : undefined
      const doc = await withLocalApi(project(), (api) => createDocument(api, { collection, ...o, json }))
      console.log(`Created ${collection} ${doc.id}`)
    })

  data
    .command('update <collection> <id>')
    .option('--set <key=value>', 'field value (repeatable)', collect)
    .option('--json <file>', 'JSON object with field values')
    .option('--as <email>')
    .action(async (collection: string, id: string, o: { set?: string[]; json?: string; as?: string }) => {
      const json = o.json ? readJsonFile(o.json) : undefined
      await withLocalApi(project(), (api) => updateDocument(api, { collection, id, ...o, json }))
      console.log(`Updated ${collection} ${id}`)
    })

  data
    .command('delete <collection> <id>')
    .option('-y, --yes', 'do not ask for confirmation')
    .option('--as <email>')
    .action(async (collection: string, id: string, o: { yes?: boolean; as?: string }) => {
      if (!o.yes) {
        if (!process.stdin.isTTY) throw new CliError('Refusing to delete without confirmation: pass --yes.')
        const ok = await p.confirm({ message: `Delete ${collection} ${id}?` })
        if (p.isCancel(ok) || !ok) return
      }
      await withLocalApi(project(), (api) => deleteDocument(api, { collection, id, as: o.as }))
      console.log(`Deleted ${collection} ${id}`)
    })
}
