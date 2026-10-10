import { Box, Text, useInput } from 'ink'
import React, { useCallback, useEffect, useState } from 'react'
import { addTenant, listTenants, removeTenant, type TenantDoc } from '../../commands/tenant.js'
import { CliError } from '../../core/errors.js'
import type { LocalApi } from '../../core/localApi.js'
import { Confirm } from '../components/Confirm.js'
import type { Size } from '../components/Frame.js'
import { Table } from '../components/Table.js'
import { TextInput } from '../components/TextInput.js'
import { type Nav, useBack } from './index.js'

type Mode = 'list' | 'name' | 'domain' | 'starter' | 'delete'

const msg = (e: unknown) => (e instanceof CliError ? e.message : e instanceof Error ? e.message : String(e))

export function Tenants({ nav, api, size }: { nav: Nav; api: LocalApi; size: Size }) {
  const [tenants, setTenants] = useState<TenantDoc[] | null>(null)
  const [selected, setSelected] = useState(0)
  const [mode, setMode] = useState<Mode>('list')
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [error, setError] = useState<string>()
  useBack(nav, mode === 'list')

  const load = useCallback(() => {
    listTenants(api).then(setTenants, (e) => setError(msg(e)))
  }, [api])
  useEffect(load, [load])

  const create = (starter: boolean) => {
    setMode('list')
    addTenant(api, { name: name.trim(), domain: domain.trim() || undefined, starter }).then(
      () => {
        setError(undefined)
        setName('')
        setDomain('')
        load()
      },
      (e) => setError(msg(e)),
    )
  }

  useInput(
    (input, key) => {
      const count = tenants?.length ?? 0
      if (key.upArrow || input === 'k') setSelected((i) => Math.max(0, i - 1))
      else if (key.downArrow || input === 'j') setSelected((i) => Math.min(count - 1, i + 1))
      else if (input === 'a') {
        setError(undefined)
        setMode('name')
      } else if (input === 'd' && tenants?.[selected]) setMode('delete')
      else if (input === 'r') load()
    },
    { isActive: mode === 'list' },
  )
  useInput(
    (input, key) => {
      if (key.escape) setMode('list')
      else if (input === 'y' || input === 'Y') create(true)
      else if (input === 'n' || input === 'N' || key.return) create(false)
    },
    { isActive: mode === 'starter' },
  )

  const current = tenants?.[selected]
  return (
    <Box flexDirection="column">
      {tenants === null && !error ? <Text dimColor>Connecting…</Text> : null}
      {tenants ? (
        <Table
          headers={['SLUG', 'DOMAIN', 'NAME']}
          rows={tenants.map((t) => [t.slug, t.domain ?? '—', t.name])}
          selected={selected}
          height={Math.max(5, size.rows - 14)}
          empty="No tenants yet. Press a to add one."
        />
      ) : null}

      {mode === 'name' ? (
        <Box>
          <Text>Tenant name: </Text>
          <TextInput value={name} onChange={setName} onSubmit={(v) => v.trim() && setMode('domain')} onCancel={() => setMode('list')} />
        </Box>
      ) : null}
      {mode === 'domain' ? (
        <Box>
          <Text>Domain (optional, e.g. acme.com): </Text>
          <TextInput value={domain} onChange={setDomain} onSubmit={() => setMode('starter')} onCancel={() => setMode('list')} />
        </Box>
      ) : null}
      {mode === 'starter' ? <Text>Create a home page for it? <Text dimColor>(y/N)</Text></Text> : null}
      {mode === 'delete' && current ? (
        <Confirm
          message={`Delete tenant "${current.slug}" and its content?`}
          onConfirm={() => {
            setMode('list')
            removeTenant(api, current.slug).then(load, (e) => setError(msg(e)))
          }}
          onCancel={() => setMode('list')}
        />
      ) : null}
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>a add · d delete · r reload · Esc back</Text>
    </Box>
  )
}
