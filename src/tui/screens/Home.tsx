import { Box, Text, useApp } from 'ink'
import { basename } from 'node:path'
import React from 'react'
import { Select, type SelectItem } from '../components/Select.js'
import type { Screen } from '../state/nav.js'
import type { ScreenContext } from './index.js'

type Choice = 'collections' | 'new-collection' | 'tenants' | 'users' | 'access' | 'data' | 'run' | 'doctor' | 'headless' | 'create-project' | 'quit'

const IN_PROJECT: SelectItem<Choice>[] = [
  { value: 'collections', label: 'Collections', hint: 'browse and open' },
  { value: 'new-collection', label: 'New collection', hint: 'fields, access, useAsTitle' },
  { value: 'tenants', label: 'Tenants', hint: 'sites' },
  { value: 'users', label: 'Users', hint: 'roles and tenant membership' },
  { value: 'access', label: 'Access', hint: 'who can read/create/update/delete' },
  { value: 'data', label: 'Data', hint: 'browse and edit documents' },
  { value: 'run', label: 'Run', hint: 'dev, build, types, migrate' },
  { value: 'doctor', label: 'Doctor', hint: 'check the setup' },
  { value: 'headless', label: 'Headless', hint: 'make it backend only' },
  { value: 'quit', label: 'Quit' },
]

const OUTSIDE: SelectItem<Choice>[] = [
  { value: 'create-project', label: 'Create project', hint: 'scaffold a multi-tenant Payload app' },
  { value: 'quit', label: 'Quit' },
]

const TARGET: Record<Exclude<Choice, 'quit' | 'new-collection'>, Screen> = {
  collections: { name: 'collections' },
  tenants: { name: 'tenants' },
  users: { name: 'users' },
  access: { name: 'access' },
  data: { name: 'data' },
  run: { name: 'run' },
  doctor: { name: 'doctor' },
  headless: { name: 'headless' },
  'create-project': { name: 'create-project' },
}

export function Home({ ctx, active }: { ctx: ScreenContext; active: boolean }) {
  const { exit } = useApp()
  const inProject = ctx.project !== null

  const onSelect = (choice: Choice) => {
    if (choice === 'quit') return exit()
    if (choice === 'new-collection') return ctx.nav.push({ name: 'builder', kind: 'collection' })
    ctx.nav.push(TARGET[choice])
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {inProject ? `Project: ${basename(ctx.project!.root)}` : 'No Payload project found in this directory.'}
      </Text>
      <Box marginTop={1}>
        <Select items={inProject ? IN_PROJECT : OUTSIDE} onSelect={onSelect} isActive={active} />
      </Box>
    </Box>
  )
}
