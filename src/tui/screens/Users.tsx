import { Box, Text, useInput } from 'ink'
import React, { useCallback, useEffect, useState } from 'react'
import {
  addUser,
  assignTenant,
  listUsers,
  removeUser,
  resetPassword,
  setUserRoles,
  unassignTenant,
  type UserRow,
} from '../../commands/user.js'
import { CliError } from '../../core/errors.js'
import type { LocalApi } from '../../core/localApi.js'
import { Confirm } from '../components/Confirm.js'
import type { Size } from '../components/Frame.js'
import { Select } from '../components/Select.js'
import { Table } from '../components/Table.js'
import { TextInput } from '../components/TextInput.js'
import { type Nav, useBack } from './index.js'

type Mode =
  | 'list'
  | 'menu'
  | 'assign-tenant'
  | 'assign-role'
  | 'unassign'
  | 'delete'
  | 'password'
  | 'add-email'
  | 'add-password'

type Action = 'toggle' | 'assign' | 'unassign' | 'remove' | 'password'

const msg = (e: unknown) => (e instanceof CliError ? e.message : e instanceof Error ? e.message : String(e))

export function Users({ nav, api, size }: { nav: Nav; api: LocalApi; size: Size }) {
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [tenants, setTenants] = useState<string[]>([])
  const [selected, setSelected] = useState(0)
  const [mode, setMode] = useState<Mode>('list')
  const [pickedTenant, setPickedTenant] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  useBack(nav, mode === 'list')

  const load = useCallback(() => {
    listUsers(api).then(setUsers, (e) => setError(msg(e)))
    api
      .find({ collection: 'tenants', limit: 0, pagination: false, depth: 0 })
      .then((r) => setTenants(r.docs.map((d) => String(d.slug))), () => {})
  }, [api])
  useEffect(load, [load])

  const current = users?.[selected]
  const run = (p: Promise<unknown>) => {
    setMode('list')
    p.then(
      () => {
        setError(undefined)
        load()
      },
      (e) => setError(msg(e)),
    )
  }

  useInput(
    (input, key) => {
      const count = users?.length ?? 0
      if (key.upArrow || input === 'k') setSelected((i) => Math.max(0, i - 1))
      else if (key.downArrow || input === 'j') setSelected((i) => Math.min(count - 1, i + 1))
      else if (key.return && current) setMode('menu')
      else if (input === 'a') {
        setError(undefined)
        setEmail('')
        setPassword('')
        setMode('add-email')
      } else if (input === 'r') load()
    },
    { isActive: mode === 'list' },
  )
  useInput((_i, key) => key.escape && setMode('list'), {
    isActive: ['menu', 'assign-tenant', 'assign-role', 'unassign'].includes(mode),
  })

  const onAction = (a: Action) => {
    if (!current) return
    if (a === 'toggle') {
      const isSuper = current.roles.includes('super-admin')
      run(setUserRoles(api, current.email, isSuper ? ['user'] : ['super-admin', ...current.roles.filter((r) => r !== 'super-admin')]))
    } else if (a === 'assign') setMode('assign-tenant')
    else if (a === 'unassign') setMode('unassign')
    else if (a === 'remove') setMode('delete')
    else {
      setPassword('')
      setMode('password')
    }
  }

  return (
    <Box flexDirection="column">
      {users === null && !error ? <Text dimColor>Connecting…</Text> : null}
      {users ? (
        <Table
          headers={['EMAIL', 'ROLES', 'TENANTS']}
          rows={users.map((u) => [
            u.email,
            u.roles.join(',') || '—',
            u.tenants.map((t) => `${t.slug}:${t.roles.join('+')}`).join(' ') || '—',
          ])}
          selected={selected}
          height={Math.max(5, size.rows - 14)}
          empty="No users."
        />
      ) : null}

      {mode === 'menu' && current ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{current.email}</Text>
          <Select
            items={[
              { value: 'toggle' as Action, label: current.roles.includes('super-admin') ? 'Make regular user' : 'Make super-admin' },
              { value: 'assign' as Action, label: 'Assign tenant' },
              { value: 'unassign' as Action, label: 'Unassign tenant' },
              { value: 'remove' as Action, label: 'Remove user' },
              { value: 'password' as Action, label: 'Reset password' },
            ]}
            onSelect={onAction}
          />
        </Box>
      ) : null}
      {mode === 'assign-tenant' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Tenant to assign</Text>
          {tenants.length === 0 ? (
            <Text dimColor>No tenants yet.</Text>
          ) : (
            <Select
              items={tenants.map((t) => ({ value: t, label: t }))}
              onSelect={(t) => {
                setPickedTenant(t)
                setMode('assign-role')
              }}
            />
          )}
        </Box>
      ) : null}
      {mode === 'assign-role' && current ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Role in {pickedTenant}</Text>
          <Select
            items={[
              { value: 'editor', label: 'editor' },
              { value: 'admin', label: 'admin' },
            ]}
            onSelect={(role) => run(assignTenant(api, current.email, pickedTenant, role))}
          />
        </Box>
      ) : null}
      {mode === 'unassign' && current ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Remove from tenant</Text>
          {current.tenants.length === 0 ? (
            <Text dimColor>Not assigned to any tenant.</Text>
          ) : (
            <Select
              items={current.tenants.map((t) => ({ value: t.slug, label: `${t.slug} (${t.roles.join('+')})` }))}
              onSelect={(slug) => run(unassignTenant(api, current.email, slug))}
            />
          )}
        </Box>
      ) : null}
      {mode === 'delete' && current ? (
        <Confirm
          message={`Delete user ${current.email}?`}
          onConfirm={() => run(removeUser(api, current.email))}
          onCancel={() => setMode('list')}
        />
      ) : null}
      {mode === 'password' && current ? (
        <Box>
          <Text>New password for {current.email}: </Text>
          <TextInput
            value={password}
            mask
            onChange={setPassword}
            onSubmit={(v) => v && run(resetPassword(api, current.email, v))}
            onCancel={() => setMode('list')}
          />
        </Box>
      ) : null}
      {mode === 'add-email' ? (
        <Box>
          <Text>Email: </Text>
          <TextInput value={email} onChange={setEmail} onSubmit={(v) => v.trim() && setMode('add-password')} onCancel={() => setMode('list')} />
        </Box>
      ) : null}
      {mode === 'add-password' ? (
        <Box>
          <Text>Password for {email}: </Text>
          <TextInput
            value={password}
            mask
            onChange={setPassword}
            onSubmit={(v) => v && run(addUser(api, { email, password: v }))}
            onCancel={() => setMode('list')}
          />
        </Box>
      ) : null}
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>↑↓ move · Enter actions · a add user · r reload · Esc back</Text>
    </Box>
  )
}
