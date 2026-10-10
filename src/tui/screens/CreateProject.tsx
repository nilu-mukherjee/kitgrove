import { Box, Text, useInput } from 'ink'
import { join } from 'node:path'
import React, { useEffect, useRef, useState } from 'react'
import {
  DATABASES,
  type Database,
  type TemplateName,
  TEMPLATES,
  detectPackageManager,
  runCreate,
} from '../../commands/create.js'
import { CliError } from '../../core/errors.js'
import { type LoggedProcess, spawnLogged } from '../../core/exec.js'
import { toSlug } from '../../core/template.js'
import type { Size } from '../components/Frame.js'
import { LogPanel } from '../components/LogPanel.js'
import { Select } from '../components/Select.js'
import { TextInput } from '../components/TextInput.js'
import { type Nav, useBack } from './index.js'

type Step = 'name' | 'template' | 'db' | 'frontend' | 'working' | 'done'

export function CreateProject({
  nav,
  cwd,
  create = runCreate,
  spawn = spawnLogged,
  size,
}: {
  nav: Nav
  cwd: string
  create?: typeof runCreate
  spawn?: typeof spawnLogged
  size: Size
}) {
  const [step, setStep] = useState<Step>('name')
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<TemplateName>('blank')
  const [db, setDb] = useState<Database>('postgres')
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<{ ok: boolean; message: string }>()
  const proc = useRef<LoggedProcess | null>(null)
  useBack(nav, step !== 'name' || true)
  useEffect(() => () => proc.current?.stop(), [])

  const run = async (headless: boolean) => {
    setStep('working')
    const pm = detectPackageManager()
    try {
      await create({ name, template, db, headless, pm, yes: true, install: false, cwd })
    } catch (err) {
      setError(err instanceof CliError ? err.message : String(err))
      return setStep('name')
    }
    const dir = toSlug(name)
    const p = spawn(pm, ['install'], join(cwd, dir), (l) => setLines((cur) => [...cur, l]))
    proc.current = p
    const code = await p.done
    setResult(
      code === 0
        ? { ok: true, message: `Created ${dir}/. Next: cd ${dir} && cp .env.example .env && ${pm} run dev` }
        : { ok: false, message: `${pm} install failed (exit ${code}). Run it yourself in ${dir}/.` },
    )
    setStep('done')
  }

  useInput((_i, key) => key.return && step === 'done' && nav.pop(), { isActive: step === 'done' })

  return (
    <Box flexDirection="column">
      <Text bold>Create a multi-tenant Payload project</Text>
      {step === 'name' ? (
        <Box flexDirection="column">
          <Text>Project name</Text>
          <TextInput
            value={name}
            onChange={setName}
            onSubmit={(v) => {
              if (!v.trim()) return setError('Enter a project name.')
              try {
                toSlug(v)
              } catch (err) {
                return setError(err instanceof CliError ? err.message : String(err))
              }
              setError(undefined)
              setStep('template')
            }}
            onCancel={() => nav.pop()}
            placeholder="e.g. my-sites"
          />
        </Box>
      ) : null}
      {step === 'template' ? (
        <Box flexDirection="column">
          <Text>Template</Text>
          <Select
            items={TEMPLATES.map((t) => ({ value: t, label: t }))}
            onSelect={(t) => {
              setTemplate(t)
              setStep('db')
            }}
          />
        </Box>
      ) : null}
      {step === 'db' ? (
        <Box flexDirection="column">
          <Text>Database</Text>
          <Select
            items={DATABASES.map((d) => ({ value: d, label: d }))}
            onSelect={(d) => {
              setDb(d)
              setStep('frontend')
            }}
          />
        </Box>
      ) : null}
      {step === 'frontend' ? (
        <Box flexDirection="column">
          <Text>Frontend</Text>
          <Select
            items={[
              { value: 'demo', label: 'Demo frontend', hint: 'a small Next.js site per tenant' },
              { value: 'headless', label: 'Headless', hint: 'API only: sites call REST/GraphQL' },
            ]}
            onSelect={(v) => void run(v === 'headless')}
          />
        </Box>
      ) : null}
      {step === 'working' || step === 'done' ? (
        <LogPanel lines={lines} height={Math.max(5, size.rows - 14)} title={step === 'working' ? 'Installing…' : undefined} />
      ) : null}
      {result ? <Text color={result.ok ? 'green' : 'red'}>{result.message}</Text> : null}
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>{step === 'done' ? 'Enter to finish' : 'Enter continue · Esc back'}</Text>
    </Box>
  )
}
