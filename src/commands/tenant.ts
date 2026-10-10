import * as p from '@clack/prompts'
import type { Command } from 'commander'
import { CliError } from '../core/errors.js'
import type { LocalApi } from '../core/localApi.js'
import { withLocalApi } from '../core/payload.js'
import { requireProject } from '../core/project.js'
import { toSlug } from '../core/template.js'

/** The Local API calls the tenant commands use. */
export type TenantPayload = Pick<LocalApi, 'find' | 'create' | 'delete'>

export interface TenantDoc {
  id: string | number
  name: string
  slug: string
  domain?: string | null
}

export interface AddTenantInput {
  name: string
  slug?: string
  domain?: string
  /** Also create a `home` page for the tenant. */
  starter?: boolean
}

/** Lower-cased bare hostname from a domain or URL; throws CliError when it is not one. */
export function normalizeDomain(input: string): string {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0]!
    .replace(/:\d+$/, '')
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) {
    throw new CliError(`"${input}" is not a valid domain.`)
  }
  return host
}

async function exists(payload: TenantPayload, field: 'slug' | 'domain', value: string): Promise<boolean> {
  const { docs } = await payload.find({
    collection: 'tenants',
    where: { [field]: { equals: value } },
    limit: 1,
    depth: 0,
  })
  return docs.length > 0
}

export async function addTenant(payload: TenantPayload, input: AddTenantInput): Promise<TenantDoc> {
  const slug = toSlug(input.slug ?? input.name)
  const domain = input.domain ? normalizeDomain(input.domain) : undefined

  if (await exists(payload, 'slug', slug)) throw new CliError(`A tenant with slug "${slug}" is already used.`)
  if (domain && (await exists(payload, 'domain', domain))) {
    throw new CliError(`A tenant with domain "${domain}" is already used.`)
  }

  const tenant = (await payload.create({
    collection: 'tenants',
    data: { name: input.name, slug, ...(domain ? { domain } : {}) },
  })) as unknown as TenantDoc

  if (input.starter) {
    await payload.create({
      collection: 'pages',
      data: { title: input.name, slug: 'home', tenant: tenant.id },
    })
  }
  return tenant
}

export async function listTenants(payload: TenantPayload): Promise<TenantDoc[]> {
  const { docs } = await payload.find({ collection: 'tenants', limit: 0, depth: 0, pagination: false })
  return docs as unknown as TenantDoc[]
}

export async function removeTenant(payload: TenantPayload, slug: string): Promise<void> {
  const { docs } = await payload.find({
    collection: 'tenants',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
  })
  const tenant = docs[0] as unknown as TenantDoc | undefined
  if (!tenant) throw new CliError(`No tenant with slug "${slug}".`)
  await payload.delete({ collection: 'tenants', id: tenant.id })
}

export function registerTenant(program: Command): void {
  const tenant = program.command('tenant').description('Manage tenants (sites) of the current project')

  tenant
    .command('add <name>')
    .description('Create a tenant')
    .option('--slug <slug>', 'slug (default: derived from the name)')
    .option('--domain <domain>', 'domain the site is served from, e.g. acme.com')
    .option('--starter', 'also create a home page')
    .action(async (name: string, o: { slug?: string; domain?: string; starter?: boolean }) => {
      const project = requireProject(process.cwd())
      const created = await withLocalApi(project, (api) => addTenant(api, { name, ...o }))
      console.log(`Created tenant "${created.name}" (${created.slug}${created.domain ? `, ${created.domain}` : ''})`)
    })

  tenant
    .command('list')
    .description('List tenants')
    .action(async () => {
      const project = requireProject(process.cwd())
      const tenants = await withLocalApi(project, listTenants)
      if (tenants.length === 0) console.log('No tenants yet. Create one with `kitgrove tenant add <name>`.')
      for (const t of tenants) console.log(`${t.slug}\t${t.domain ?? '-'}\t${t.name}`)
    })

  tenant
    .command('remove <slug>')
    .description('Delete a tenant (and, via the plugin, its content)')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (slug: string, o: { yes?: boolean }) => {
      const project = requireProject(process.cwd())
      if (!o.yes) {
        if (!process.stdin.isTTY) throw new CliError('Refusing to delete without confirmation: pass --yes.')
        const ok = await p.confirm({ message: `Delete tenant "${slug}" and its content?` })
        if (p.isCancel(ok) || !ok) return
      }
      await withLocalApi(project, (api) => removeTenant(api, slug))
      console.log(`Removed tenant "${slug}".`)
    })
}
