import { describe, expect, it } from 'vitest'
import {
  addUser,
  assignTenant,
  listUsers,
  removeUser,
  resetPassword,
  resolvePassword,
  setUserRoles,
  unassignTenant,
} from '../../src/commands/user.js'
import { CliError } from '../../src/core/errors.js'
import { memoryApi } from '../helpers/memoryApi.js'

function setup() {
  return memoryApi({
    seed: {
      tenants: [
        { slug: 'acme', name: 'Acme' },
        { slug: 'globex', name: 'Globex' },
      ],
      users: [
        { email: 'root@x.com', roles: ['super-admin'], tenants: [] },
        { email: 'ed@x.com', roles: ['user'], tenants: [{ tenant: 1, roles: ['editor'] }] },
      ],
    },
  })
}

describe('addUser', () => {
  it('lower-cases the email, defaults roles and can assign a tenant', async () => {
    const { api, data } = setup()
    const u = await addUser(api, { email: ' New@X.com ', password: 'pw', tenant: 'globex', tenantRole: 'admin' })
    expect(u).toMatchObject({ email: 'new@x.com', roles: ['user'], tenants: [{ slug: 'globex', roles: ['admin'] }] })
    expect(data.users!.at(-1)).toMatchObject({ email: 'new@x.com', password: 'pw' })
  })

  it('rejects a duplicate that differs only in case, writing nothing', async () => {
    const { api, data } = setup()
    await expect(addUser(api, { email: 'ROOT@x.com', password: 'pw' })).rejects.toThrow(/already exists/)
    expect(data.users).toHaveLength(2)
  })

  it('rejects an unknown tenant, an invalid email and an unknown role', async () => {
    const { api, data } = setup()
    await expect(addUser(api, { email: 'a@x.com', password: 'pw', tenant: 'nope' })).rejects.toThrow(/No tenant with slug "nope"/)
    await expect(addUser(api, { email: 'not-an-email', password: 'pw' })).rejects.toThrow(CliError)
    await expect(addUser(api, { email: 'a@x.com', password: 'pw', roles: ['god'] })).rejects.toThrow(/Unknown role "god"/)
    expect(data.users).toHaveLength(2)
  })
})

describe('listUsers', () => {
  it('shows tenant slugs and filters by tenant', async () => {
    const { api } = setup()
    expect(await listUsers(api)).toEqual([
      expect.objectContaining({ email: 'root@x.com', tenants: [] }),
      expect.objectContaining({ email: 'ed@x.com', tenants: [{ slug: 'acme', roles: ['editor'] }] }),
    ])
    expect((await listUsers(api, { tenant: 'acme' })).map((u) => u.email)).toEqual(['ed@x.com'])
    expect(await listUsers(api, { tenant: 'globex' })).toEqual([])
  })
})

describe('assignTenant / unassignTenant', () => {
  it('replaces the roles on an existing row instead of duplicating the tenant', async () => {
    const { api, data } = setup()
    await assignTenant(api, 'ED@x.com', 'acme', 'admin')
    await assignTenant(api, 'ed@x.com', 'acme', 'admin')
    expect(data.users![1]!.tenants).toEqual([{ tenant: 1, roles: ['admin'] }])
  })

  it('adds a second tenant and can remove one', async () => {
    const { api } = setup()
    const u = await assignTenant(api, 'ed@x.com', 'globex', 'editor')
    expect(u.tenants.map((t) => t.slug)).toEqual(['acme', 'globex'])
    expect((await unassignTenant(api, 'ed@x.com', 'acme')).tenants.map((t) => t.slug)).toEqual(['globex'])
  })

  it('errors, without writing, for unknown user, tenant or an unassigned tenant', async () => {
    const { api, calls } = setup()
    await expect(assignTenant(api, 'who@x.com', 'acme', 'admin')).rejects.toThrow(/No user/)
    await expect(assignTenant(api, 'ed@x.com', 'nope', 'admin')).rejects.toThrow(/No tenant/)
    await expect(unassignTenant(api, 'ed@x.com', 'globex')).rejects.toThrow(/not assigned/)
    expect(calls.filter((c) => c.method === 'update')).toEqual([])
  })
})

describe('roles and removal', () => {
  it('sets global roles', async () => {
    const { api } = setup()
    expect((await setUserRoles(api, 'ed@x.com', ['super-admin', 'user'])).roles).toEqual(['super-admin', 'user'])
  })

  it('refuses to demote or remove the last super-admin', async () => {
    const { api, data } = setup()
    await expect(setUserRoles(api, 'root@x.com', ['user'])).rejects.toThrow(/last super-admin/)
    await expect(removeUser(api, 'root@x.com')).rejects.toThrow(/last super-admin/)
    expect(data.users).toHaveLength(2)
  })

  it('allows it once another super-admin exists, and removes ordinary users', async () => {
    const { api, data } = setup()
    await setUserRoles(api, 'ed@x.com', ['super-admin'])
    await setUserRoles(api, 'root@x.com', ['user'])
    await removeUser(api, 'root@x.com')
    expect(data.users!.map((u) => u.email)).toEqual(['ed@x.com'])
  })
})

describe('resetPassword', () => {
  it('updates only the password', async () => {
    const { api, calls } = setup()
    await resetPassword(api, 'ed@x.com', 'new-pw')
    expect(calls.at(-1)).toMatchObject({ method: 'update', args: { collection: 'users', data: { password: 'new-pw' } } })
  })
})

describe('resolvePassword', () => {
  it('prompts on a TTY', async () => {
    expect(await resolvePassword({ KITGROVE_PASSWORD: 'env' }, async () => 'typed', true)).toBe('typed')
  })
  it('falls back to KITGROVE_PASSWORD without a TTY', async () => {
    expect(await resolvePassword({ KITGROVE_PASSWORD: 'env' }, async () => 'typed', false)).toBe('env')
  })
  it('errors naming the variable when neither is available', async () => {
    await expect(resolvePassword({}, async () => '', false)).rejects.toThrow(/KITGROVE_PASSWORD/)
    await expect(resolvePassword({}, async () => '', true)).rejects.toThrow(/empty/)
  })
})
