import { Box, Text, useInput } from 'ink'
import React, { useReducer, useState } from 'react'
import { ACCESS_OPS, ACCESS_RULES, type AccessRule } from '../../core/access.js'
import { CliError } from '../../core/errors.js'
import type { FieldSpec } from '../../core/fields.js'
import type { GenerateKind, GenerateOptions, GenerateResult } from '../../commands/generate.js'
import { Confirm } from '../components/Confirm.js'
import { type Size, useSize } from '../components/Frame.js'
import { Table } from '../components/Table.js'
import { TextInput } from '../components/TextInput.js'
import {
  builderReducer,
  currentFields,
  initialBuilder,
  previewSource,
  validateBuilder,
} from '../state/builder.js'
import { type EditorInfo, FieldEditor } from './FieldEditor.js'

export interface BuilderProps {
  kind: GenerateKind
  info: EditorInfo
  generate: (kind: GenerateKind, name: string, opts: Omit<GenerateOptions, 'cwd'>) => Promise<GenerateResult>
  onExit: () => void
  size?: Size
}

type Mode = 'name' | 'title' | 'browse' | 'field' | 'delete' | 'discard' | 'access' | 'result'

function flags(f: FieldSpec): string {
  return [
    f.required && 'required',
    f.unique && 'unique',
    f.index && 'index',
    f.defaultValue !== undefined && 'default',
    f.hasMany && 'many',
    f.fields && `${f.fields.length} fields`,
    f.tabs && `${f.tabs.length} tabs`,
  ]
    .filter(Boolean)
    .join(' ')
}

export function Builder({ kind, info, generate, onExit, size }: BuilderProps) {
  const [s, dispatch] = useReducer(builderReducer, kind, initialBuilder)
  const [mode, setMode] = useState<Mode>('name')
  const [nameBuf, setNameBuf] = useState('')
  const [titleBuf, setTitleBuf] = useState('')
  const [editing, setEditing] = useState<{ index: number | null; spec: FieldSpec } | null>(null)
  const [accessCursor, setAccessCursor] = useState(0)
  const [message, setMessage] = useState<string>()
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null)
  const dims = useSize(size)

  const hasTitle = kind === 'collection' || (kind === 'global' && !s.globalShared)
  const list = currentFields(s)
  const selectedField = list[s.selected]

  const write = async () => {
    const problem = validateBuilder(s)
    if (problem) return setMessage(problem)
    setMessage('Writing…')
    try {
      const r = await generate(kind, s.name, {
        fields: s.fields,
        useAsTitle: hasTitle ? s.useAsTitle : undefined,
        access: Object.keys(s.access).length ? s.access : undefined,
        globalShared: s.globalShared,
      })
      const lines = [
        ...r.files.map((f) => `Created ${f}`),
        ...(r.registered ? ['Registered in payload.config.ts'] : []),
        ...(r.manualInstructions ? ['', r.manualInstructions] : []),
      ]
      setResult({ ok: !r.manualInstructions, lines })
      setMessage(undefined)
      setMode('result')
    } catch (err) {
      setResult({ ok: false, lines: [err instanceof CliError ? err.message : String(err)] })
      setMessage(undefined)
      setMode('result')
    }
  }

  const openEditor = (index: number | null, spec: FieldSpec) => {
    setEditing({ index, spec })
    setMode('field')
  }

  useInput(
    (input, key) => {
      if (key.ctrl && input === 's') return void write()
      if (key.escape || key.leftArrow || input === 'h') {
        if (s.path.length) return dispatch({ type: 'leave' })
        if (key.escape) return s.name || s.fields.length ? setMode('discard') : onExit()
        return
      }
      if (key.upArrow || input === 'k') return dispatch({ type: 'selectBy', delta: -1 })
      if (key.downArrow || input === 'j') return dispatch({ type: 'selectBy', delta: 1 })
      if (input === 'K') return dispatch({ type: 'move', index: s.selected, direction: 'up' })
      if (input === 'J') return dispatch({ type: 'move', index: s.selected, direction: 'down' })
      if (input === 'a') {
        setMessage(undefined)
        return openEditor(null, { name: '', type: 'text', required: false })
      }
      if ((input === 'e' || key.return) && selectedField) {
        if (key.return && (selectedField.fields || selectedField.tabs)) return dispatch({ type: 'enter' })
        return openEditor(s.selected, selectedField)
      }
      if (input === 'd' && selectedField) return setMode('delete')
      if (input === 'n') return setMode('name')
      if (input === 't' && hasTitle) return setMode('title')
      if (input === 'x' && hasTitle) return setMode('access')
      if (input === 'g' && kind === 'global') return dispatch({ type: 'setGlobalShared', value: !s.globalShared })
    },
    { isActive: mode === 'browse' },
  )

  useInput(
    (input, key) => {
      if (key.escape) return setMode('browse')
      if (key.upArrow || input === 'k') return setAccessCursor((c) => Math.max(0, c - 1))
      if (key.downArrow || input === 'j') return setAccessCursor((c) => Math.min(ACCESS_OPS.length - 1, c + 1))
      if (key.leftArrow || key.rightArrow || key.return || input === ' ') {
        const op = ACCESS_OPS[accessCursor]!
        const options: (AccessRule | undefined)[] = [undefined, ...ACCESS_RULES]
        const current = options.indexOf(s.access[op])
        const step = key.leftArrow ? -1 : 1
        const next = options[(current + step + options.length) % options.length]
        dispatch({ type: 'setAccess', op, rule: next })
      }
    },
    { isActive: mode === 'access' },
  )

  useInput(
    (_i, key) => {
      if (!result) return
      if (key.escape || key.return) return result.ok ? onExit() : setMode('browse')
    },
    { isActive: mode === 'result' },
  )

  if (mode === 'field' && editing) {
    const siblings = list.filter((_, i) => i !== editing.index)
    return (
      <FieldEditor
        initial={editing.spec}
        siblings={siblings}
        info={info}
        onCancel={() => setMode('browse')}
        onSave={(spec) => {
          dispatch(editing.index === null ? { type: 'add', spec } : { type: 'replace', index: editing.index, spec })
          setMode('browse')
        }}
      />
    )
  }

  if (mode === 'result' && result) {
    return (
      <Box flexDirection="column">
        <Text bold color={result.ok ? 'green' : 'yellow'}>
          {result.ok ? 'Done' : 'Needs attention'}
        </Text>
        {result.lines.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
        <Text dimColor>{result.ok ? 'Enter or Esc to finish' : 'Esc to go back — your work is kept'}</Text>
      </Box>
    )
  }

  const preview = previewSource(s).split('\n')
  const previewRows = Math.max(6, dims.rows - 12)
  const rows = list.map((f) => [f.name, f.type, flags(f)])
  const crumbs = ['Fields', ...s.path.map((p, i) => {
    let fields = s.fields
    for (const step of s.path.slice(0, i)) {
      const f = fields[step.field]!
      fields = f.tabs ? f.tabs[step.tab ?? 0]!.fields : f.fields!
    }
    return fields[p.field]?.name ?? '?'
  })]

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={Math.floor(dims.columns * 0.5)} paddingRight={2}>
        <Box>
          <Text bold>Name: </Text>
          {mode === 'name' ? (
            <TextInput
              value={nameBuf}
              onChange={setNameBuf}
              onSubmit={(v) => {
                dispatch({ type: 'setName', name: v.trim() })
                setMode(hasTitle ? 'title' : 'browse')
              }}
              onCancel={() => (s.name ? setMode('browse') : onExit())}
              placeholder={`e.g. Case Studies`}
            />
          ) : (
            <Text>{s.name || '(none)'}</Text>
          )}
        </Box>
        {hasTitle ? (
          <Box>
            <Text bold>useAsTitle: </Text>
            {mode === 'title' ? (
              <TextInput
                value={titleBuf}
                onChange={setTitleBuf}
                onSubmit={(v) => {
                  dispatch({ type: 'setUseAsTitle', field: v.trim() || undefined })
                  setMode('browse')
                }}
                onCancel={() => setMode('browse')}
                placeholder="auto (title, else first text field)"
              />
            ) : (
              <Text>{s.useAsTitle ?? 'auto'}</Text>
            )}
          </Box>
        ) : null}
        {kind === 'global' ? (
          <Text>
            <Text bold>Scope: </Text>
            {s.globalShared ? 'shared by all tenants' : 'per tenant'} <Text dimColor>(g toggles)</Text>
          </Text>
        ) : null}
        {hasTitle ? (
          <Text>
            <Text bold>Access: </Text>
            {ACCESS_OPS.filter((op) => s.access[op]).map((op) => `${op}=${s.access[op]}`).join(' ') || 'default'}{' '}
            <Text dimColor>(x edits)</Text>
          </Text>
        ) : null}

        <Box marginTop={1} flexDirection="column">
          <Text bold>{crumbs.join(' › ')}</Text>
          {mode === 'access' ? (
            <Box flexDirection="column">
              {ACCESS_OPS.map((op, i) => (
                <Text key={op} color={i === accessCursor ? 'cyan' : undefined}>
                  {i === accessCursor ? '› ' : '  '}
                  {op.padEnd(8)}
                  {s.access[op] ?? '(default)'}
                </Text>
              ))}
              <Text dimColor>←/→ change · Esc done</Text>
            </Box>
          ) : (
            <Table
              headers={['NAME', 'TYPE', 'OPTIONS']}
              rows={rows}
              selected={s.selected}
              height={Math.max(4, dims.rows - 16)}
              empty="No fields yet — the default `title` field is used. Press a to add one."
            />
          )}
        </Box>

        {mode === 'delete' && selectedField ? (
          <Confirm
            message={`Delete field "${selectedField.name}"?`}
            onConfirm={() => {
              dispatch({ type: 'remove', index: s.selected })
              setMode('browse')
            }}
            onCancel={() => setMode('browse')}
          />
        ) : null}
        {mode === 'discard' ? (
          <Confirm message={`Discard this ${kind}?`} onConfirm={onExit} onCancel={() => setMode('browse')} />
        ) : null}
        {s.error || message ? <Text color={s.error ? 'red' : 'yellow'}>{s.error ?? message}</Text> : null}
        <Text dimColor>
          a add · e/Enter edit · d delete · J/K move · n name · {hasTitle ? 't title · x access · ' : ''}Ctrl+S write · Esc back
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
        <Text bold dimColor>
          Preview
        </Text>
        {preview.slice(0, previewRows).map((line, i) => (
          <Text key={i} wrap="truncate">
            {line || ' '}
          </Text>
        ))}
        {preview.length > previewRows ? <Text dimColor>… {preview.length - previewRows} more lines</Text> : null}
      </Box>
    </Box>
  )
}
