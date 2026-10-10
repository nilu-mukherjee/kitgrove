import { Box, Text, useInput } from 'ink'
import React, { useCallback, useEffect, useState } from 'react'
import { type HeadlessResult, runHeadless } from '../../commands/headless.js'
import type { ProjectInfo } from '../../core/project.js'
import type { Size } from '../components/Frame.js'
import { type Nav, useBack } from './index.js'

type Run = (opts: { cwd: string; dryRun?: boolean; force?: boolean }) => Promise<HeadlessResult>

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function Section({ title, color, items, max }: { title: string; color: string; items: string[]; max: number }) {
  if (items.length === 0) return null
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={color}>
        {title} ({items.length})
      </Text>
      {items.slice(0, max).map((f) => (
        <Text key={f}>  {f}</Text>
      ))}
      {items.length > max ? <Text dimColor>  … and {items.length - max} more</Text> : null}
    </Box>
  )
}

/** Plans the conversion to a backend-only project, applies it only after `y`. */
export function Headless({
  nav,
  project,
  run = runHeadless,
  size,
}: {
  nav: Nav
  project: ProjectInfo
  run?: Run
  size: Size
}) {
  const [plan, setPlan] = useState<HeadlessResult | null>(null)
  const [done, setDone] = useState<HeadlessResult | null>(null)
  const [force, setForce] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useBack(nav)

  const load = useCallback(
    (withForce: boolean) => {
      setPlan(null)
      setError(undefined)
      run({ cwd: project.root, dryRun: true, force: withForce }).then(setPlan, (e) => setError(message(e)))
    },
    [project.root, run],
  )
  useEffect(() => load(false), [load])

  const apply = () => {
    setBusy(true)
    run({ cwd: project.root, dryRun: false, force }).then(
      (r) => {
        setDone(r)
        setBusy(false)
      },
      (e) => {
        setError(message(e))
        setBusy(false)
      },
    )
  }

  const pending = plan !== null && done === null && !plan.alreadyHeadless && !busy
  useInput(
    (input) => {
      if (input === 'y' || input === 'Y') apply()
      else if (input === 'n' || input === 'N') nav.pop()
      else if (input === 'f') {
        setForce(true)
        load(true)
      }
    },
    { isActive: pending },
  )

  const max = Math.max(4, Math.floor((size.rows - 14) / 3))
  const shown = done ?? plan

  return (
    <Box flexDirection="column">
      <Text bold>Make this project backend only (headless)</Text>
      {error ? <Text color="red">{error}</Text> : null}
      {!shown && !error ? <Text dimColor>Checking the project…</Text> : null}
      {shown?.alreadyHeadless ? <Text color="green">This project is already headless; nothing to change.</Text> : null}
      {shown && !shown.alreadyHeadless ? (
        <Box flexDirection="column" marginTop={1}>
          <Section title={done ? 'Removed' : 'Would remove'} color="red" items={shown.removed} max={max} />
          <Section title={done ? 'Edited' : 'Would edit'} color="cyan" items={shown.edited} max={max} />
          <Section title="Kept (changed, or not from the template)" color="yellow" items={shown.kept} max={max} />
          <Section title="Do by hand" color="yellow" items={shown.manual} max={max} />
        </Box>
      ) : null}
      {done ? (
        <Text color="green">
          Done. Set CORS_ORIGINS in your .env for sites that call the API from a browser.
        </Text>
      ) : null}
      {busy ? <Text dimColor>Applying…</Text> : null}
      {pending ? (
        <Text>
          Apply these changes? <Text dimColor>(y/N)</Text>
          {plan.kept.length ? <Text dimColor>  f also removes the kept files</Text> : null}
        </Text>
      ) : null}
      <Text dimColor>Esc back</Text>
    </Box>
  )
}
