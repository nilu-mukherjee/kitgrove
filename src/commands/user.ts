import * as p from '@clack/prompts'
import type { Command } from 'commander'
import { CliError } from '../core/errors.js'
import type { Doc, LocalApi } from '../core/localApi.js'
import { withLocalApi } from '../core/payload.js'
import { requireProject } from '../core/project.js'

export const GLOBAL_ROLES = ['super-admin', 'user'] as const
export const TENANT_ROLES = ['admin', 'editor'] as const
export type TenantRole = (typeof TENANT_ROLES)[number]

export interface UserRow {
  id: string | number
  email: string
  roles: string[]
  tenants: { slug: string; roles: string[] }[]
}

interface TenantRef {
  slug: string
  id: string | number
}

export const normalizeEmail = (email: string): string => {
  const e = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new CliError(`"${email}" is not a valid email address.`)
  return e
}

async function loadTenants(api: LocalApi): Promise<TenantRef[]> {
  const { docs } = await api.find({ collection: 'tenants', limit: 0, pagination: false, depth: 0 })
  return docs.map((d) => ({ id: d.id, slug: String(d.slug) }))
}

async function loadUsers(api: LocalApi): Promise<Doc[]> {
  const { docs } = await api.find({ collection: 'users', limit: 0, pagination: false, depth: 0 })
  return docs
}

const idOf = (v: unknown): string | number =>
  typeof v === 'object' && v !== null ? (v as { id: string | number }).id : (v as string | number)

type RawTenantRow = { tenant: unknown; roles?: string[] }
const rowsOf = (u: Doc): RawTenantRow[] => (Array.isArray(u.tenants) ? (u.tenants as RawTenantRow[]) : [])

function toRow(u: Doc, tenants: TenantRef[]): UserRow {
  return {
    id: u.id,
    email: String(u.email),
    roles: Array.isArray(u.roles) ? (u.roles as string[]) : [],
    tenants: rowsOf(u).map((r) => ({
      slug: tenants.find((t) => t.id === idOf(r.tenant))?.slug ?? String(idOf(r.tenant)),
      roles: r.roles ?? [],
    })),
  }
}

const isSuper = (u: Doc) => Array.isArray(u.roles) && (u.roles as string[]).includes('super-admin')

function findUser(users: Doc[], email: string): Doc {
  const e = normalizeEmail(email)
  const user = users.find((u) => String(u.email).toLowerCase() === e)
  if (!user) throw new CliError(`No user with email "${e}".`)
  return user
}

function findTenant(tenants: TenantRef[], slug: string): TenantRef {
  const t = tenants.find((x) => x.slug === slug)
  if (!t) throw new CliError(`No tenant with slug "${slug}".`)
  return t
}

function checkRoles(roles: string[]): string[] {
  for (const r of roles) {
    if (!(GLOBAL_ROLES as readonly string[]).includes(r)) {
      throw new CliError(`Unknown role "${r}". Choose from: ${GLOBAL_ROLES.join(', ')}.`)
    }
  }
  return roles
}

function checkTenantRole(role: string): TenantRole {
  if (!(TENANT_ROLES as readonly string[]).includes(role)) {
    throw new CliError(`Unknown tenant role "${role}". Choose from: ${TENANT_ROLES.join(', ')}.`)
  }
  return role as TenantRole
}

export async function listUsers(api: LocalApi, opts: { tenant?: string } = {}): Promise<UserRow[]> {
  const [users, tenants] = await Promise.all([loadUsers(api), loadTenants(api)])
  const rows = users.map((u) => toRow(u, tenants))
  if (!opts.tenant) return rows
  const slug = findTenant(tenants, opts.tenant).slug
  return rows.filter((r) => r.tenants.some((t) => t.slug === slug))
}

export async function addUser(
  api: LocalApi,
  input: { email: string; password: string; roles?: string[]; tenant?: string; tenantRole?: string },
): Promise<UserRow> {
  const email = normalizeEmail(input.email)
  const roles = checkRoles(input.roles?.length ? input.roles : ['user'])
  const [users, tenants] = await Promise.all([loadUsers(api), loadTenants(api)])
  if (users.some((u) => String(u.email).toLowerCase() === email)) {
    throw new CliError(`A user with email "${email}" already exists.`)
  }
  const tenant = input.tenant ? findTenant(tenants, input.tenant) : undefined
  const tenantRole = checkTenantRole(input.tenantRole ?? 'editor')

  const doc = await api.create({
    collection: 'users',
    data: {
      email,
      password: input.password,
      roles,
      tenants: tenant ? [{ tenant: tenant.id, roles: [tenantRole] }] : [],
    },
  })
  return toRow(doc, tenants)
}

function guardLastSuperAdmin(users: Doc[], user: Doc, action: string): void {
  if (isSuper(user) && users.filter(isSuper).length === 1) {
    throw new CliError(`Cannot ${action} the last super-admin; create or promote another one first.`)
  }
}

export async function setUserRoles(api: LocalApi, email: string, roles: string[]): Promise<UserRow> {
  checkRoles(roles)
  const [users, tenants] = await Promise.all([loadUsers(api), loadTenants(api)])
  const user = findUser(users, email)
  if (!roles.includes('super-admin')) guardLastSuperAdmin(users, user, 'demote')
  return toRow(await api.update({ collection: 'users', id: user.id, data: { roles } }), tenants)
}

export async function assignTenant(api: LocalApi, email: string, tenantSlug: string, role: string): Promise<UserRow> {
  const tenantRole = checkTenantRole(role)
  const [users, tenants] = await Promise.all([loadUsers(api), loadTenants(api)])
  const user = findUser(users, email)
  const tenant = findTenant(tenants, tenantSlug)

  const rows = rowsOf(user).map((r) => ({ tenant: idOf(r.tenant), roles: r.roles ?? [] }))
  const existing = rows.find((r) => r.tenant === tenant.id)
  if (existing) existing.roles = [tenantRole]
  else rows.push({ tenant: tenant.id, roles: [tenantRole] })
  return toRow(await api.update({ collection: 'users', id: user.id, data: { tenants: rows } }), tenants)
}

export async function unassignTenant(api: LocalApi, email: string, tenantSlug: string): Promise<UserRow> {
  const [users, tenants] = await Promise.all([loadUsers(api), loadTenants(api)])
  const user = findUser(users, email)
  const tenant = findTenant(tenants, tenantSlug)
  const rows = rowsOf(user).map((r) => ({ tenant: idOf(r.tenant), roles: r.roles ?? [] }))
  if (!rows.some((r) => r.tenant === tenant.id)) {
    throw new CliError(`"${normalizeEmail(email)}" is not assigned to tenant "${tenantSlug}".`)
  }
  const next = rows.filter((r) => r.tenant !== tenant.id)
  return toRow(await api.update({ collection: 'users', id: user.id, data: { tenants: next } }), tenants)
}

export async function removeUser(api: LocalApi, email: string): Promise<void> {
  const users = await loadUsers(api)
  const user = findUser(users, email)
  guardLastSuperAdmin(users, user, 'remove')
  await api.delete({ collection: 'users', id: user.id })
}

export async function resetPassword(api: LocalApi, email: string, password: string): Promise<void> {
  const user = findUser(await loadUsers(api), email)
  await api.update({ collection: 'users', id: user.id, data: { password } })
}

/** Password from a hidden prompt on a TTY, otherwise PAYCMS_PASSWORD. Never from a flag. */
export async function resolvePassword(
  env: Record<string, string | undefined>,
  prompt: () => Promise<string>,
  isTTY: boolean,
): Promise<string> {
  const value = isTTY ? await prompt() : env.PAYCMS_PASSWORD
  if (value === undefined) {
    throw new CliError('A password is required: run in a terminal to be prompted, or set PAYCMS_PASSWORD.')
  }
  if (!value) throw new CliError('The password must not be empty.')
  return value
}

async function promptPassword(label = 'Password'): Promise<string> {
  const v = await p.password({ message: label })
  if (p.isCancel(v)) {
    p.cancel('Cancelled.')
    process.exit(1)
  }
  return String(v ?? '')
}

const password = (label?: string) =>
  resolvePassword(process.env, () => promptPassword(label), Boolean(process.stdin.isTTY && process.stdout.isTTY))

const show = (u: UserRow) =>
  `${u.email}\t${u.roles.join(',') || '-'}\t${u.tenants.map((t) => `${t.slug}:${t.roles.join('+')}`).join(' ') || '-'}`

export function registerUser(program: Command): void {
  const user = program.command('user').description('Manage users, roles and tenant membership')
  const project = () => requireProject(process.cwd())

  user
    .command('list')
    .description('List users')
    .option('--tenant <slug>', 'only members of this tenant')
    .action(async (o: { tenant?: string }) => {
      const rows = await withLocalApi(project(), (api) => listUsers(api, o))
      if (rows.length === 0) console.log('No users.')
      for (const r of rows) console.log(show(r))
    })

  user
    .command('add <email>')
    .description('Create a user (password is prompted, or taken from PAYCMS_PASSWORD)')
    .option('--role <roles>', 'global roles, comma separated (super-admin, user)')
    .option('--tenant <slug>', 'assign to this tenant')
    .option('--tenant-role <role>', 'admin | editor (default editor)')
    .action(async (email: string, o: { role?: string; tenant?: string; tenantRole?: string }) => {
      const pw = await password()
      const row = await withLocalApi(project(), (api) =>
        addUser(api, { email, password: pw, roles: o.role?.split(','), tenant: o.tenant, tenantRole: o.tenantRole }),
      )
      console.log(`Created ${show(row)}`)
    })

  user
    .command('roles <email>')
    .description('Set a user\'s global roles')
    .requiredOption('--set <roles>', 'comma separated: super-admin, user')
    .action(async (email: string, o: { set: string }) => {
      const row = await withLocalApi(project(), (api) => setUserRoles(api, email, o.set.split(',').map((s) => s.trim())))
      console.log(show(row))
    })

  user
    .command('assign <email>')
    .description('Add a user to a tenant, or change their role there')
    .requiredOption('--tenant <slug>')
    .option('--tenant-role <role>', 'admin | editor', 'editor')
    .action(async (email: string, o: { tenant: string; tenantRole: string }) => {
      console.log(show(await withLocalApi(project(), (api) => assignTenant(api, email, o.tenant, o.tenantRole))))
    })

  user
    .command('unassign <email>')
    .description('Remove a user from a tenant')
    .requiredOption('--tenant <slug>')
    .action(async (email: string, o: { tenant: string }) => {
      console.log(show(await withLocalApi(project(), (api) => unassignTenant(api, email, o.tenant))))
    })

  user
    .command('remove <email>')
    .description('Delete a user')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (email: string, o: { yes?: boolean }) => {
      if (!o.yes) {
        if (!process.stdin.isTTY) throw new CliError('Refusing to delete without confirmation: pass --yes.')
        const ok = await p.confirm({ message: `Delete user "${email}"?` })
        if (p.isCancel(ok) || !ok) return
      }
      await withLocalApi(project(), (api) => removeUser(api, email))
      console.log(`Removed ${normalizeEmail(email)}.`)
    })

  user
    .command('reset-password <email>')
    .description('Set a new password (prompted, or PAYCMS_PASSWORD)')
    .action(async (email: string) => {
      const pw = await password('New password')
      await withLocalApi(project(), (api) => resetPassword(api, email, pw))
      console.log(`Password updated for ${normalizeEmail(email)}.`)
    })
}
