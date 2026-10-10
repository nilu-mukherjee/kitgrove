import { Text, useInput } from 'ink'
import { join } from 'node:path'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { dirname } from 'node:path'
import { discover, runGenerate } from '../../commands/generate.js'
import type { ProjectInfo } from '../../core/project.js'
import { ensureAccessHelpers, readAccess, setAccess } from '../../core/access.js'
import type { LocalApi } from '../../core/localApi.js'
import { listProjectCollections } from '../../core/project-scan.js'
import { Access, type AccessRow } from './Access.js'
import { Builder } from './Builder.js'
import { Data } from './Data.js'
import { Tenants } from './Tenants.js'
import { Users } from './Users.js'
import { Collections } from './Collections.js'
import { CreateProject } from './CreateProject.js'
import { Doctor } from './Doctor.js'
import { Headless } from './Headless.js'
import { Run } from './Run.js'
import type { Size } from '../components/Frame.js'
import type { Screen } from '../state/nav.js'

export interface Nav {
  push(screen: Screen): void
  pop(): void
  reset(screen: Screen): void
}

/** Opens the project's Payload once per session, on first use. Provided by App. */
export const ApiContext = createContext<(() => Promise<LocalApi>) | null>(null)

export interface ScreenContext {
  project: ProjectInfo | null
  cwd: string
  nav: Nav
  size: Size
}

/** Esc goes back; screens with their own Esc handling (inputs, modals) pass `enabled=false` while busy. */
export function useBack(nav: Nav, enabled = true): void {
  useInput((_input, key) => key.escape && nav.pop(), { isActive: enabled })
}

/** Connects to the project's database (once per session) before rendering a data screen. */
export function WithApi({ nav, children }: { nav: Nav; children: (api: LocalApi) => React.ReactNode }) {
  const get = useContext(ApiContext)
  const [state, setState] = useState<{ api?: LocalApi; error?: string }>({})
  useBack(nav, !state.api)

  useEffect(() => {
    if (!get) return setState({ error: 'No database connection is available in this session.' })
    let live = true
    get().then(
      (api) => live && setState({ api }),
      (e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      live = false
    }
  }, [get])

  if (state.api) return <>{children(state.api)}</>
  return state.error ? (
    <>
      <Text color="red">{state.error}</Text>
      <Text dimColor>Check .env and run Doctor. Esc to go back.</Text>
    </>
  ) : (
    <Text dimColor>Connecting to the database…</Text>
  )
}

export function Placeholder({ nav, name }: { nav: Nav; name: string }) {
  useBack(nav)
  return <Text dimColor>{name} is not available yet.</Text>
}

export function screenTitle(screen: Screen): string {
  switch (screen.name) {
    case 'home':
      return 'Home'
    case 'create-project':
      return 'Create project'
    case 'collections':
      return 'Collections'
    case 'builder':
      return `New ${screen.kind}`
    case 'tenants':
      return 'Tenants'
    case 'users':
      return 'Users'
    case 'access':
      return 'Access'
    case 'data':
      return screen.collection ? `Data · ${screen.collection}` : 'Data'
    case 'run':
      return 'Run'
    case 'doctor':
      return 'Doctor'
    case 'headless':
      return 'Headless'
  }
}

export function screenHints(screen: Screen): string[] {
  return screen.name === 'home' ? ['↑↓ move', 'Enter open', '? help', 'q quit'] : ['Esc back', '? help']
}

/** Screens registered in later tasks replace the placeholder here. */
export function renderScreen(screen: Screen, ctx: ScreenContext): React.ReactNode {
  switch (screen.name) {
    case 'builder':
      if (!ctx.project) return <Placeholder nav={ctx.nav} name="Run this inside a Payload project; the builder" />
      return (
        <Builder
          kind={screen.kind}
          info={discover(dirname(ctx.project.configPath))}
          generate={(kind, name, opts) => runGenerate(kind, name, { ...opts, cwd: ctx.cwd })}
          onExit={ctx.nav.pop}
          size={ctx.size}
        />
      )
    case 'create-project':
      return <CreateProject nav={ctx.nav} cwd={ctx.cwd} size={ctx.size} />
    case 'collections':
      if (!ctx.project) return <Placeholder nav={ctx.nav} name="Collections (open a Payload project first)" />
      return <Collections nav={ctx.nav} rows={listProjectCollections(ctx.project.configPath)} size={ctx.size} />
    case 'tenants':
      return <WithApi nav={ctx.nav}>{(api) => <Tenants nav={ctx.nav} api={api} size={ctx.size} />}</WithApi>
    case 'users':
      return <WithApi nav={ctx.nav}>{(api) => <Users nav={ctx.nav} api={api} size={ctx.size} />}</WithApi>
    case 'data':
      return (
        <WithApi nav={ctx.nav}>
          {(api) => <Data nav={ctx.nav} api={api} size={ctx.size} initial={screen.collection} />}
        </WithApi>
      )
    case 'access': {
      if (!ctx.project) return <Placeholder nav={ctx.nav} name="Access (open a Payload project first)" />
      const srcDir = dirname(ctx.project.configPath)
      const rows: AccessRow[] = listProjectCollections(ctx.project.configPath).flatMap((c) => {
        const file = join(srcDir, c.file)
        const read = readAccess(file)
        return read ? [{ slug: c.slug, file, ...read }] : []
      })
      const write = async (file: string, rules: Parameters<typeof setAccess>[1]) => {
        const r = setAccess(file, rules)
        if (r.ok) ensureAccessHelpers(srcDir, rules)
        return r
      }
      return <Access nav={ctx.nav} rows={rows} write={write} size={ctx.size} />
    }
    case 'doctor':
      if (!ctx.project) return <Placeholder nav={ctx.nav} name="Doctor (open a Payload project first)" />
      return <Doctor nav={ctx.nav} project={ctx.project} />
    case 'headless':
      if (!ctx.project) return <Placeholder nav={ctx.nav} name="Headless (open a Payload project first)" />
      return <Headless nav={ctx.nav} project={ctx.project} size={ctx.size} />
    case 'run':
      if (!ctx.project) return <Placeholder nav={ctx.nav} name="Run (open a Payload project first)" />
      return <Run nav={ctx.nav} project={ctx.project} size={ctx.size} />
    default:
      return <Placeholder nav={ctx.nav} name={screenTitle(screen)} />
  }
}
