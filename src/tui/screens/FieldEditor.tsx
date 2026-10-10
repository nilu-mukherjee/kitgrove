import { Box, Text, useInput } from 'ink'
import React, { useState } from 'react'
import { FIELD_TYPES, type FieldSpec } from '../../core/fields.js'
import { Select } from '../components/Select.js'
import { TextInput } from '../components/TextInput.js'
import { applyRow, completeContainer, fieldForm, type FormRow, type RowKey, validateDraft } from '../state/form.js'

export interface EditorInfo {
  /** Collections a relationship, upload or join can point at. */
  collections: string[]
  /** Slugs of existing blocks. */
  blocks: string[]
}

function display(row: FormRow): string {
  if (row.kind === 'bool') return row.value ? '[x]' : '[ ]'
  if (Array.isArray(row.value)) return row.value.length ? row.value.join(', ') : '(none)'
  return row.value === '' || row.value === undefined ? '—' : String(row.value)
}

function BlockPicker({ blocks, selected, onToggle, onClose }: {
  blocks: string[]
  selected: string[]
  onToggle: (slug: string) => void
  onClose: () => void
}) {
  const [i, setI] = useState(0)
  useInput((input, key) => {
    if (key.escape) onClose()
    else if (key.upArrow || input === 'k') setI((v) => Math.max(0, v - 1))
    else if (key.downArrow || input === 'j') setI((v) => Math.min(blocks.length - 1, v + 1))
    else if ((key.return || input === ' ') && blocks[i]) onToggle(blocks[i]!)
  })
  if (blocks.length === 0) {
    return <Text color="yellow">No blocks yet. Create one first (kitgrove generate block &lt;name&gt;). Esc to close.</Text>
  }
  return (
    <Box flexDirection="column">
      <Text bold>Allowed blocks · Space toggles · Esc closes</Text>
      {blocks.map((b, idx) => (
        <Text key={b} color={idx === i ? 'cyan' : undefined}>
          {idx === i ? '› ' : '  '}[{selected.includes(b) ? 'x' : ' '}] {b}
        </Text>
      ))}
    </Box>
  )
}

/** Edits one field as a form: only the rows its type supports, validated before saving. */
export function FieldEditor({ initial, siblings, info, onSave, onCancel }: {
  initial: FieldSpec
  siblings: FieldSpec[]
  info: EditorInfo
  onSave: (spec: FieldSpec) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<FieldSpec>(initial)
  const [cursor, setCursor] = useState(0)
  const [editing, setEditing] = useState<RowKey | null>(initial.name ? null : 'name')
  const [buffer, setBuffer] = useState('')
  const [picker, setPicker] = useState<'type' | 'blocks' | null>(null)
  const [error, setError] = useState<string>()

  const rows = fieldForm(draft)
  const saveIndex = rows.length

  const apply = (key: RowKey, value: Parameters<typeof applyRow>[2]) => {
    const r = applyRow(draft, key, value)
    if ('error' in r) return setError(r.error)
    setDraft(r.spec)
    setError(undefined)
  }

  const save = () => {
    const completed = completeContainer(draft)
    const problem = validateDraft(completed, siblings)
    if (problem) return setError(problem)
    onSave(completed)
  }

  useInput(
    (input, key) => {
      if (key.ctrl && input === 's') return save()
      if (key.escape) return onCancel()
      if (key.upArrow || input === 'k') return setCursor((c) => Math.max(0, c - 1))
      if (key.downArrow || input === 'j') return setCursor((c) => Math.min(saveIndex, c + 1))
      if (!(key.return || input === ' ')) return
      if (cursor === saveIndex) return save()
      const row = rows[cursor]!
      if (row.kind === 'bool') return apply(row.key, !row.value)
      if (row.kind === 'text') {
        setBuffer(String(row.value ?? ''))
        return setEditing(row.key)
      }
      if (row.kind === 'multi') return setPicker('blocks')
      if (row.key === 'type') return setPicker('type')
      const choices = row.choices ?? []
      const next = choices[(choices.indexOf(String(row.value)) + 1) % Math.max(1, choices.length)]
      apply(row.key, next)
    },
    { isActive: editing === null && picker === null },
  )
  useInput((_i, key) => key.escape && setPicker(null), { isActive: picker === 'type' })

  if (picker === 'type') {
    return (
      <Box flexDirection="column">
        <Text bold>Type · Enter selects · Esc cancels</Text>
        <Select
          items={FIELD_TYPES.map((t) => ({ value: t, label: t }))}
          initialIndex={FIELD_TYPES.indexOf(draft.type)}
          onSelect={(t) => {
            apply('type', t)
            setPicker(null)
          }}
        />
      </Box>
    )
  }
  if (picker === 'blocks') {
    return (
      <BlockPicker
        blocks={info.blocks}
        selected={draft.blocks ?? []}
        onToggle={(slug) => {
          const cur = draft.blocks ?? []
          apply('blocks', cur.includes(slug) ? cur.filter((b) => b !== slug) : [...cur, slug])
        }}
        onClose={() => setPicker(null)}
      />
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold>{initial.name ? `Edit field "${initial.name}"` : 'New field'}</Text>
      {rows.map((row, i) => (
        <Box key={row.key}>
          <Text color={i === cursor ? 'cyan' : undefined}>
            {i === cursor ? '› ' : '  '}
            {row.label.padEnd(26)}
          </Text>
          {editing === row.key ? (
            <TextInput
              value={buffer}
              onChange={setBuffer}
              onSubmit={(v) => {
                apply(row.key, v)
                setEditing(null)
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <Text>{display(row)}</Text>
          )}
        </Box>
      ))}
      <Text color={cursor === saveIndex ? 'cyan' : undefined}>
        {cursor === saveIndex ? '› ' : '  '}[ Save field ]
      </Text>
      {(draft.type === 'relationship' || draft.type === 'upload' || draft.type === 'join') && info.collections.length ? (
        <Text dimColor>Collections: {info.collections.join(', ')}</Text>
      ) : null}
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>Enter edit/toggle · Ctrl+S save · Esc cancel</Text>
    </Box>
  )
}
