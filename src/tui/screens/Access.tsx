import { Box, Text, useInput } from 'ink'
import React, { useState } from 'react'
import { ACCESS_OPS, ACCESS_RULES, type AccessOp, type AccessRule, type AccessRules } from '../../core/access.js'
import { Confirm } from '../components/Confirm.js'
import type { Size } from '../components/Frame.js'
import { Select } from '../components/Select.js'
import { type Nav, useBack } from './index.js'

export interface AccessRow {
  slug: string
  /** Absolute path of the collection file. */
  file: string
  rules: AccessRules
  custom: Partial<Record<AccessOp, string>>
}

type Write = (file: string, rules: AccessRules) => Promise<{ ok: true } | { ok: false; manualInstructions: string }>

export function Access({ nav, rows: initial, write, size }: { nav: Nav; rows: AccessRow[]; write: Write; size: Size }) {
  const [rows, setRows] = useState(initial)
  const [cursor, setCursor] = useState({ r: 0, c: 0 })
  const [mode, setMode] = useState<'grid' | 'confirm' | 'pick'>('grid')
  const [message, setMessage] = useState<string>()
  useBack(nav, mode === 'grid')

  const row = rows[cursor.r]
  const op = ACCESS_OPS[cursor.c]!
  const cell = (r: AccessRow, o: AccessOp) => (r.rules[o] ? r.rules[o]! : r.custom[o] ? 'custom' : '-')

  useInput(
    (input, key) => {
      if (key.upArrow || input === 'k') setCursor((c) => ({ ...c, r: Math.max(0, c.r - 1) }))
      else if (key.downArrow || input === 'j') setCursor((c) => ({ ...c, r: Math.min(rows.length - 1, c.r + 1) }))
      else if (key.leftArrow || input === 'h') setCursor((c) => ({ ...c, c: Math.max(0, c.c - 1) }))
      else if (key.rightArrow || input === 'l') setCursor((c) => ({ ...c, c: Math.min(ACCESS_OPS.length - 1, c.c + 1) }))
      else if (key.return && row) {
        setMessage(undefined)
        setMode(row.custom[op] ? 'confirm' : 'pick')
      }
    },
    { isActive: mode === 'grid' },
  )
  useInput((_i, key) => key.escape && setMode('grid'), { isActive: mode === 'pick' })

  const apply = async (rule: AccessRule) => {
    if (!row) return
    setMode('grid')
    const r = await write(row.file, { [op]: rule })
    if (!r.ok) return setMessage(r.manualInstructions)
    setRows((all) =>
      all.map((x) => {
        if (x.slug !== row.slug) return x
        const custom = { ...x.custom }
        delete custom[op]
        return { ...x, rules: { ...x.rules, [op]: rule }, custom }
      }),
    )
    setMessage(`${row.slug}.${op} = ${rule}`)
  }

  const width = 15
  return (
    <Box flexDirection="column">
      <Text bold dimColor>
        {'  '}
        {'COLLECTION'.padEnd(20)}
        {ACCESS_OPS.map((o) => o.toUpperCase().padEnd(width)).join('')}
      </Text>
      {rows.length === 0 ? <Text dimColor>No collections found.</Text> : null}
      {rows.slice(0, Math.max(5, size.rows - 14)).map((r, ri) => (
        <Text key={r.slug}>
          {ri === cursor.r ? '› ' : '  '}
          {r.slug.padEnd(20)}
          {ACCESS_OPS.map((o, ci) => {
            const selected = ri === cursor.r && ci === cursor.c
            const text = cell(r, o)
            return (
              <Text key={o} color={selected ? 'cyan' : text === 'custom' ? 'yellow' : undefined} bold={selected}>
                {(selected ? `[${text}]` : text).padEnd(width)}
              </Text>
            )
          })}
        </Text>
      ))}

      {mode === 'confirm' && row ? (
        <Confirm
          message={`${row.slug}.${op} is a custom rule (${row.custom[op]}). Replace it?`}
          onConfirm={() => setMode('pick')}
          onCancel={() => setMode('grid')}
        />
      ) : null}
      {mode === 'pick' && row ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            Rule for {row.slug}.{op} · Enter selects · Esc cancels
          </Text>
          <Select items={ACCESS_RULES.map((r) => ({ value: r, label: r }))} onSelect={(r) => void apply(r)} />
        </Box>
      ) : null}
      {message ? <Text color={message.includes('\n') || message.includes('manual') ? 'yellow' : 'green'}>{message}</Text> : null}
      <Text dimColor>←↑↓→ move · Enter set rule · Esc back · "-" = Payload default (signed-in users)</Text>
    </Box>
  )
}
