import { Box, Text, useInput } from 'ink'
import React, { useCallback, useEffect, useState } from 'react'
import { createDocument, deleteDocument, getDocument, listDocuments, updateDocument } from '../../commands/data.js'
import { CliError } from '../../core/errors.js'
import type { CollectionMeta, Doc, LocalApi, PagedDocs } from '../../core/localApi.js'
import { Confirm } from '../components/Confirm.js'
import type { Size } from '../components/Frame.js'
import { Select } from '../components/Select.js'
import { Table } from '../components/Table.js'
import { TextInput } from '../components/TextInput.js'
import { changedPairs, dataForm, type DataRow } from '../state/dataForm.js'
import { type Nav, useBack } from './index.js'

type Stage = 'pick' | 'list' | 'tenant' | 'form' | 'view' | 'delete'
const PAGE = 12
const msg = (e: unknown) => (e instanceof CliError ? e.message : e instanceof Error ? e.message : String(e))

export function Data({ nav, api, size, initial }: { nav: Nav; api: LocalApi; size: Size; initial?: string }) {
  const collections = api.collections()
  const [slug, setSlug] = useState<string | undefined>(initial)
  const [stage, setStage] = useState<Stage>(initial ? 'list' : 'pick')
  const [tenants, setTenants] = useState<string[]>([])
  const [tenant, setTenant] = useState<string | undefined>()
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<PagedDocs | null>(null)
  const [selected, setSelected] = useState(0)
  const [viewDoc, setViewDoc] = useState<Doc>()
  const [error, setError] = useState<string>()

  const [editing, setEditing] = useState<{ id: string | number | null; rows: DataRow[]; original: DataRow[] } | null>(null)
  const [cursor, setCursor] = useState(0)
  const [editBuffer, setEditBuffer] = useState<string | null>(null)

  const meta: CollectionMeta | undefined = collections.find((c) => c.slug === slug)

  const load = useCallback(() => {
    if (!slug) return
    setResult(null)
    listDocuments(api, { collection: slug, tenant, limit: PAGE, page }).then(
      (r) => {
        setResult(r)
        setError(undefined)
      },
      (e) => setError(msg(e)),
    )
  }, [api, slug, tenant, page])
  useEffect(load, [load])

  useEffect(() => {
    if (!meta?.tenantScoped) return setTenants([])
    api
      .find({ collection: 'tenants', limit: 0, pagination: false, depth: 0 })
      .then((r) => setTenants(r.docs.map((d) => String(d.slug))), () => {})
  }, [api, meta?.tenantScoped])

  useBack(nav, stage === 'pick')
  useInput((_i, key) => key.escape && (stage === 'list' ? setStage('pick') : setStage('list')), {
    isActive: stage === 'list' || stage === 'view' || stage === 'tenant',
  })

  const docs = result?.docs ?? []
  const current = docs[selected]
  const titleField = meta?.useAsTitle && meta.useAsTitle !== 'id' ? meta.useAsTitle : null

  const openForm = async (id: string | number | null, forTenant?: string) => {
    if (!meta) return
    try {
      const doc = id === null ? undefined : await getDocument(api, { collection: meta.slug, id })
      const rows = dataForm(meta, doc)
      setEditing({ id, rows, original: rows })
      if (forTenant) setTenant(forTenant)
      setCursor(0)
      setError(undefined)
      setStage('form')
    } catch (e) {
      setError(msg(e))
    }
  }

  useInput(
    (input, key) => {
      if (key.upArrow || input === 'k') setSelected((i) => Math.max(0, i - 1))
      else if (key.downArrow || input === 'j') setSelected((i) => Math.min(docs.length - 1, i + 1))
      else if (input === ']' && result && page < result.totalPages) {
        setPage((p) => p + 1)
        setSelected(0)
      } else if (input === '[' && page > 1) {
        setPage((p) => p - 1)
        setSelected(0)
      } else if (input === 't' && meta?.tenantScoped) {
        const order = [undefined, ...tenants]
        setTenant(order[(order.indexOf(tenant) + 1) % order.length])
        setPage(1)
        setSelected(0)
      } else if (input === 'n') {
        if (meta?.tenantScoped) setStage('tenant')
        else void openForm(null)
      } else if (input === 'e' && current) void openForm(current.id)
      else if (input === 'd' && current) setStage('delete')
      else if (key.return && current && slug) {
        getDocument(api, { collection: slug, id: current.id }).then(
          (d) => {
            setViewDoc(d)
            setStage('view')
          },
          (e) => setError(msg(e)),
        )
      } else if (input === 'r') load()
    },
    { isActive: stage === 'list' },
  )

  const save = async () => {
    if (!editing || !meta) return
    const set = changedPairs(editing.rows, editing.original)
    try {
      if (editing.id === null) await createDocument(api, { collection: meta.slug, tenant: meta.tenantScoped ? tenant : undefined, set })
      else await updateDocument(api, { collection: meta.slug, id: editing.id, set })
      setEditing(null)
      setError(undefined)
      setStage('list')
      load()
    } catch (e) {
      setError(msg(e))
    }
  }

  useInput(
    (input, key) => {
      if (key.ctrl && input === 's') return void save()
      if (key.escape) {
        setEditing(null)
        setError(undefined)
        return setStage('list')
      }
      if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1))
      else if (key.downArrow || input === 'j') setCursor((c) => Math.min((editing?.rows.length ?? 1) - 1, c + 1))
      else if (key.return && editing) {
        const row = editing.rows[cursor]
        if (row && !row.readOnly) setEditBuffer(row.value)
      }
    },
    { isActive: stage === 'form' && editBuffer === null },
  )

  if (stage === 'pick') {
    return (
      <Box flexDirection="column">
        <Text bold>Collection</Text>
        <Select
          items={collections.map((c) => ({ value: c.slug, label: c.slug, hint: c.tenantScoped ? 'tenant-scoped' : undefined }))}
          onSelect={(s) => {
            setSlug(s)
            setPage(1)
            setSelected(0)
            setTenant(undefined)
            setStage('list')
          }}
        />
        <Text dimColor>Enter open · Esc back</Text>
      </Box>
    )
  }

  if (stage === 'tenant') {
    return (
      <Box flexDirection="column">
        <Text bold>Tenant for the new {slug} document</Text>
        {tenants.length === 0 ? (
          <Text dimColor>No tenants yet. Create one first.</Text>
        ) : (
          <Select items={tenants.map((t) => ({ value: t, label: t }))} onSelect={(t) => void openForm(null, t)} />
        )}
      </Box>
    )
  }

  if (stage === 'form' && editing) {
    return (
      <Box flexDirection="column">
        <Text bold>
          {editing.id === null ? `New ${slug}` : `Edit ${slug} ${editing.id}`}
          {tenant && editing.id === null ? <Text dimColor> · tenant {tenant}</Text> : null}
        </Text>
        {editing.rows.map((r, i) => (
          <Box key={r.name}>
            <Text color={i === cursor ? 'cyan' : undefined}>
              {i === cursor ? '› ' : '  '}
              {r.name.padEnd(18)}
            </Text>
            {editBuffer !== null && i === cursor ? (
              <TextInput
                value={editBuffer}
                onChange={setEditBuffer}
                onSubmit={(v) => {
                  setEditing((e) => e && { ...e, rows: e.rows.map((x, xi) => (xi === cursor ? { ...x, value: v } : x)) })
                  setEditBuffer(null)
                }}
                onCancel={() => setEditBuffer(null)}
              />
            ) : (
              <Text dimColor={r.readOnly}>
                {r.value || '—'}
                {r.note ? <Text dimColor>  ({r.note})</Text> : null}
              </Text>
            )}
          </Box>
        ))}
        {error ? <Text color="red">{error}</Text> : null}
        <Text dimColor>Enter edit value · Ctrl+S save · Esc cancel</Text>
      </Box>
    )
  }

  if (stage === 'view' && viewDoc) {
    return (
      <Box flexDirection="column">
        <Text bold>
          {slug} {viewDoc.id}
        </Text>
        {JSON.stringify(viewDoc, null, 2)
          .split('\n')
          .slice(0, Math.max(8, size.rows - 10))
          .map((l, i) => (
            <Text key={i} wrap="truncate">
              {l}
            </Text>
          ))}
        <Text dimColor>Esc back</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        {slug}
        {tenant ? <Text dimColor> · tenant {tenant}</Text> : null}
      </Text>
      {result === null && !error ? <Text dimColor>Loading…</Text> : null}
      {result ? (
        <Table
          headers={['ID', titleField ? titleField.toUpperCase() : 'TITLE', 'UPDATED']}
          rows={docs.map((d) => [String(d.id), titleField ? String(d[titleField] ?? '') : '—', String(d.updatedAt ?? '')])}
          selected={selected}
          height={Math.max(5, size.rows - 15)}
          empty="No documents."
        />
      ) : null}
      {result ? (
        <Text dimColor>
          {result.totalDocs} document(s), page {result.page} of {result.totalPages}
        </Text>
      ) : null}
      {stage === 'delete' && current ? (
        <Confirm
          message={`Delete ${slug} ${current.id}?`}
          onConfirm={() => {
            setStage('list')
            deleteDocument(api, { collection: slug!, id: current.id }).then(load, (e) => setError(msg(e)))
          }}
          onCancel={() => setStage('list')}
        />
      ) : null}
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>
        ↑↓ move · Enter view · n new · e edit · d delete · {meta?.tenantScoped ? 't tenant · ' : ''}[ ] page · Esc back
      </Text>
    </Box>
  )
}
