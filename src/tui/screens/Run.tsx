import { Box, Text, useInput } from 'ink'
import React, { useEffect, useRef, useState } from 'react'
import { type LoggedProcess, scriptCommand, spawnLogged } from '../../core/exec.js'
import type { ProjectInfo } from '../../core/project.js'
import type { Size } from '../components/Frame.js'
import { LogPanel } from '../components/LogPanel.js'
import { Select } from '../components/Select.js'
import { TextInput } from '../components/TextInput.js'
import { type Nav } from './index.js'

type Choice = 'dev' | 'build' | 'types' | 'migrate' | 'status' | 'create'
type Spawn = (cmd: string, args: string[], cwd: string, onLine: (l: string) => void) => LoggedProcess

const ITEMS: { value: Choice; label: string; hint: string }[] = [
  { value: 'dev', label: 'dev', hint: 'start the dev server' },
  { value: 'build', label: 'build', hint: 'production build' },
  { value: 'types', label: 'types', hint: 'regenerate payload-types.ts' },
  { value: 'migrate', label: 'migrate', hint: 'run pending migrations' },
  { value: 'status', label: 'migrate status', hint: 'show migration status' },
  { value: 'create', label: 'migrate create', hint: 'create a migration' },
]

function script(choice: Choice, name?: string): { script: string; args: string[] } {
  switch (choice) {
    case 'dev':
      return { script: 'dev', args: [] }
    case 'build':
      return { script: 'build', args: [] }
    case 'types':
      return { script: 'generate:types', args: [] }
    case 'migrate':
      return { script: 'payload', args: ['migrate'] }
    case 'status':
      return { script: 'payload', args: ['migrate:status'] }
    case 'create':
      return { script: 'payload', args: ['migrate:create', ...(name ? [name] : [])] }
  }
}

export function Run({
  nav,
  project,
  spawn = spawnLogged,
  size,
}: {
  nav: Nav
  project: ProjectInfo
  spawn?: Spawn
  size: Size
}) {
  const [phase, setPhase] = useState<'menu' | 'name' | 'running'>('menu')
  const [label, setLabel] = useState('')
  const [name, setName] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [exit, setExit] = useState<number | null>(null)
  const proc = useRef<LoggedProcess | null>(null)
  const running = phase === 'running' && exit === null

  const stop = () => {
    proc.current?.stop()
  }
  // Never leave a child behind when the screen goes away.
  useEffect(() => () => stop(), [])

  const start = (choice: Choice, migrationName?: string) => {
    const { script: s, args } = script(choice, migrationName)
    const cmd = scriptCommand(project.packageManager, s, args)
    setLabel([cmd.command, ...cmd.args].join(' '))
    setLines([])
    setExit(null)
    setPhase('running')
    const p = spawn(cmd.command, cmd.args, project.root, (line) => setLines((l) => [...l, line]))
    proc.current = p
    void p.done.then((code) => {
      if (proc.current === p) setExit(code)
    })
  }

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') return stop()
      if (key.escape) {
        stop()
        proc.current = null
        setPhase('menu')
      }
    },
    { isActive: phase === 'running' },
  )
  useInput((_i, key) => key.escape && nav.pop(), { isActive: phase === 'menu' })
  useInput((_i, key) => key.escape && setPhase('menu'), { isActive: phase === 'name' })

  if (phase === 'menu') {
    return (
      <Box flexDirection="column">
        <Text bold>Run a project script</Text>
        <Select
          items={ITEMS}
          onSelect={(c) => (c === 'create' ? setPhase('name') : start(c))}
        />
        <Text dimColor>Enter run · Esc back</Text>
      </Box>
    )
  }
  if (phase === 'name') {
    return (
      <Box flexDirection="column">
        <Text bold>Migration name</Text>
        <TextInput
          value={name}
          onChange={setName}
          onSubmit={(v) => v.trim() && start('create', v.trim())}
          onCancel={() => setPhase('menu')}
          placeholder="e.g. add-notes"
        />
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Text bold>
        $ {label}{' '}
        <Text color={exit === null ? 'yellow' : exit === 0 ? 'green' : 'red'}>
          {exit === null ? '(running)' : `exited with code ${exit}`}
        </Text>
      </Text>
      <LogPanel lines={lines} height={Math.max(5, size.rows - 12)} />
      <Text dimColor>{running ? 'Ctrl+C stop · Esc stop and go back' : 'Esc back to the menu'}</Text>
    </Box>
  )
}
