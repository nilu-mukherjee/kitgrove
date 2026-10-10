import { cleanup, render } from 'ink-testing-library'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DoctorCheck } from '../../src/commands/doctor.js'
import type { ProjectInfo } from '../../src/core/project.js'
import { Collections } from '../../src/tui/screens/Collections.js'
import { CreateProject } from '../../src/tui/screens/CreateProject.js'
import { Doctor } from '../../src/tui/screens/Doctor.js'
import type { Nav } from '../../src/tui/screens/index.js'
import { Run } from '../../src/tui/screens/Run.js'
import { has, settle, until } from '../helpers/ink.js'

afterEach(cleanup)

const DOWN = '\u001B[B'
const ESC = '\u001B'
const CTRL_C = '\u0003'
const project: ProjectInfo = { root: '/p/site', configPath: '/p/site/src/payload.config.ts', packageManager: 'pnpm' }
const nav = (): Nav & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    push: (s) => void calls.push(`push:${s.name}`),
    pop: () => void calls.push('pop'),
    reset: (s) => void calls.push(`reset:${s.name}`),
  }
}
const size = { columns: 100, rows: 30 }

describe('Collections', () => {
  const rows = [
    { slug: 'pages', file: 'collections/Pages.ts', tenantScoped: true, fieldCount: 3 },
    { slug: 'users', file: 'collections/Users.ts', tenantScoped: false, fieldCount: 1 },
  ]

  it('lists collections and opens the builder on n', async () => {
    const n = nav()
    const t = render(<Collections nav={n} rows={rows} size={size} />)
    await until(t.lastFrame, has('pages'))
    expect(t.lastFrame()).toContain('Pages.ts')
    expect(t.lastFrame()).toContain('yes')
    await settle()
    t.stdin.write('n')
    await vi.waitFor(() => expect(n.calls).toContain('push:builder'))
  })

  it('shows the file of the selected collection on Enter and goes back on Esc', async () => {
    const n = nav()
    const t = render(<Collections nav={n} rows={rows} size={size} />)
    await settle()
    t.stdin.write(DOWN)
    await settle()
    t.stdin.write('\r')
    await until(t.lastFrame, has('src/collections/Users.ts'))
    t.stdin.write(ESC)
    await vi.waitFor(() => expect(n.calls).toContain('pop'))
  })
})

describe('Doctor', () => {
  it('shows checks with hints and re-runs on r', async () => {
    const results: DoctorCheck[][] = [
      [
        { name: 'dependencies installed', ok: true },
        { name: 'PAYLOAD_SECRET is set', ok: false, hint: 'Add PAYLOAD_SECRET to .env' },
      ],
      [{ name: 'dependencies installed', ok: true }],
    ]
    const run = vi.fn(async () => results.shift()!)
    const t = render(<Doctor nav={nav()} project={project} run={run} />)
    await until(t.lastFrame, has('PAYLOAD_SECRET is set'))
    expect(t.lastFrame()).toContain('✓ dependencies installed')
    expect(t.lastFrame()).toContain('✗ PAYLOAD_SECRET is set')
    expect(t.lastFrame()).toContain('Add PAYLOAD_SECRET to .env')
    await settle()
    t.stdin.write('r')
    await until(t.lastFrame, (f) => !f.includes('PAYLOAD_SECRET is set'))
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('Run', () => {
  function fakeSpawn() {
    const state = { cmd: '', args: [] as string[], stopped: 0, onLine: (_l: string) => {}, finish: (_c: number) => {} }
    const spawn = vi.fn((cmd: string, args: string[], _cwd: string, onLine: (l: string) => void) => {
      state.cmd = cmd
      state.args = args
      state.onLine = onLine
      const done = new Promise<number>((r) => (state.finish = r))
      return { stop: () => void state.stopped++, done }
    })
    return { state, spawn }
  }

  it('runs the chosen script through the project package manager and streams output', async () => {
    const { state, spawn } = fakeSpawn()
    const t = render(<Run nav={nav()} project={project} spawn={spawn} size={size} />)
    await until(t.lastFrame, has('dev'))
    await settle()
    t.stdin.write('\r') // dev
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
    expect(state.cmd).toBe('pnpm')
    expect(state.args).toEqual(['run', 'dev'])
    state.onLine('ready on http://localhost:3000')
    await until(t.lastFrame, has('ready on http://localhost:3000'))
    state.finish(0)
    await until(t.lastFrame, has('exited with code 0'))
  })

  it('Ctrl+C stops the process but keeps the screen', async () => {
    const { state, spawn } = fakeSpawn()
    const n = nav()
    const t = render(<Run nav={n} project={project} spawn={spawn} size={size} />)
    await settle()
    t.stdin.write('\r')
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
    await settle()
    t.stdin.write(CTRL_C)
    await vi.waitFor(() => expect(state.stopped).toBe(1))
    expect(n.calls).not.toContain('pop')
  })

  it('stops a running process when the screen unmounts', async () => {
    const { state, spawn } = fakeSpawn()
    const t = render(<Run nav={nav()} project={project} spawn={spawn} size={size} />)
    await settle()
    t.stdin.write('\r')
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
    t.unmount()
    expect(state.stopped).toBe(1)
  })

  it('asks for a name before running migrate create', async () => {
    const { state, spawn } = fakeSpawn()
    const t = render(<Run nav={nav()} project={project} spawn={spawn} size={size} />)
    await settle()
    for (let i = 0; i < 5; i++) {
      t.stdin.write(DOWN)
      await settle(10)
    }
    await settle()
    t.stdin.write('\r')
    await until(t.lastFrame, has('Migration name'))
    await settle()
    t.stdin.write('add-notes')
    await until(t.lastFrame, has('add-notes'))
    await settle()
    t.stdin.write('\r')
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
    expect(state.args).toEqual(['run', 'payload', 'migrate:create', 'add-notes'])
  })
})

describe('CreateProject', () => {
  it('collects name, template and database, then creates and installs', async () => {
    const create = vi.fn(async (_options: unknown) => ['package.json'])
    const lines: string[] = []
    const install = vi.fn((_c: string, _a: string[], _cwd: string, onLine: (l: string) => void) => {
      onLine('added 120 packages')
      lines.push('x')
      return { stop() {}, done: Promise.resolve(0) }
    })
    const t = render(<CreateProject nav={nav()} cwd="/work" create={create} spawn={install} size={size} />)
    await settle()
    t.stdin.write('my-sites')
    await until(t.lastFrame, has('my-sites'))
    await settle()
    t.stdin.write('\r') // name
    await until(t.lastFrame, has('Template'))
    await settle()
    t.stdin.write('j') // blog
    await settle()
    t.stdin.write('\r')
    await until(t.lastFrame, has('Database'))
    await settle()
    t.stdin.write('j') // mongodb
    await settle()
    t.stdin.write('\r')
    await vi.waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0]![0]).toMatchObject({
      name: 'my-sites',
      template: 'blog',
      db: 'mongodb',
      install: false,
      cwd: '/work',
    })
    await until(t.lastFrame, has('added 120 packages'))
    await until(t.lastFrame, has('cd my-sites'))
  })
})
