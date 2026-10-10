import { Text, useInput } from 'ink'
import React from 'react'
import { dirname } from 'node:path'
import { discover, runGenerate } from '../../commands/generate.js'
import type { ProjectInfo } from '../../core/project.js'
import { listProjectCollections } from '../../core/project-scan.js'
import { Builder } from './Builder.js'
import { Collections } from './Collections.js'
import { CreateProject } from './CreateProject.js'
import { Doctor } from './Doctor.js'
import { Run } from './Run.js'
import type { Size } from '../components/Frame.js'
import type { Screen } from '../state/nav.js'

export interface Nav {
  push(screen: Screen): void
  pop(): void
  reset(screen: Screen): void
}

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
    case 'doctor':
      if (!ctx.project) return <Placeholder nav={ctx.nav} name="Doctor (open a Payload project first)" />
      return <Doctor nav={ctx.nav} project={ctx.project} />
    case 'run':
      if (!ctx.project) return <Placeholder nav={ctx.nav} name="Run (open a Payload project first)" />
      return <Run nav={ctx.nav} project={ctx.project} size={ctx.size} />
    default:
      return <Placeholder nav={ctx.nav} name={screenTitle(screen)} />
  }
}
