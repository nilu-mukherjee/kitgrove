import { Box, Text, useInput } from 'ink'
import React, { useCallback, useEffect, useState } from 'react'
import { type DoctorCheck, runDoctor } from '../../commands/doctor.js'
import type { ProjectInfo } from '../../core/project.js'
import { type Nav, useBack } from './index.js'

export function Doctor({
  nav,
  project,
  run = runDoctor,
}: {
  nav: Nav
  project: ProjectInfo
  run?: (project: ProjectInfo) => Promise<DoctorCheck[]>
}) {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null)
  const [error, setError] = useState<string>()
  useBack(nav)

  const load = useCallback(() => {
    setChecks(null)
    setError(undefined)
    run(project).then(setChecks, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [project, run])

  useEffect(load, [load])
  useInput((input) => input === 'r' && load())

  return (
    <Box flexDirection="column">
      {error ? <Text color="red">{error}</Text> : null}
      {!checks && !error ? <Text dimColor>Checking…</Text> : null}
      {checks?.map((c) => (
        <Box key={c.name} flexDirection="column">
          <Text color={c.ok ? 'green' : 'red'}>
            {c.ok ? '✓' : '✗'} {c.name}
          </Text>
          {!c.ok && c.hint ? <Text dimColor>    {c.hint}</Text> : null}
        </Box>
      ))}
      {checks ? (
        <Text dimColor>
          {'\n'}
          {checks.filter((c) => !c.ok).length === 0 ? 'Everything looks good.' : 'Fix the ✗ items, then press r.'}
        </Text>
      ) : null}
      <Text dimColor>r re-run · Esc back</Text>
    </Box>
  )
}
