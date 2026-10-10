import { cleanup, render } from 'ink-testing-library'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HeadlessResult } from '../../src/commands/headless.js'
import type { ProjectInfo } from '../../src/core/project.js'
import { Headless } from '../../src/tui/screens/Headless.js'
import type { Nav } from '../../src/tui/screens/index.js'
import { has, settle, until } from '../helpers/ink.js'

afterEach(cleanup)

const project: ProjectInfo = { root: '/p/site', configPath: '/p/site/src/payload.config.ts', packageManager: 'npm' }
const size = { columns: 100, rows: 30 }
const nav = (): Nav & { calls: string[] } => {
  const calls: string[] = []
  return { calls, push: () => {}, pop: () => void calls.push('pop'), reset: () => {} }
}

const plan: HeadlessResult = {
  removed: ['src/app/(frontend)/layout.tsx', 'src/lib/tenant.ts'],
  kept: ['src/app/(frontend)/about/page.tsx'],
  edited: ['src/collections/Users.ts', 'src/payload.config.ts'],
  manual: [],
  alreadyHeadless: false,
}

describe('Headless screen', () => {
  it('shows the plan first and changes nothing until confirmed', async () => {
    const run = vi.fn(async (_o: { cwd: string; dryRun?: boolean; force?: boolean }) => plan)
    const t = render(<Headless nav={nav()} project={project} run={run} size={size} />)
    await until(t.lastFrame, has('src/lib/tenant.ts'))
    const frame = t.lastFrame()!
    expect(frame).toContain('Would remove')
    expect(frame).toContain('src/collections/Users.ts')
    expect(frame).toContain('src/app/(frontend)/about/page.tsx')
    expect(frame).toMatch(/Kept/)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]![0]).toMatchObject({ cwd: '/p/site', dryRun: true })
  })

  it('applies on y and shows the result', async () => {
    const run = vi.fn(async (o: { cwd: string; dryRun?: boolean; force?: boolean }) =>
      o.dryRun ? plan : { ...plan, manual: ['src/collections/Users.ts: set auth yourself'] },
    )
    const t = render(<Headless nav={nav()} project={project} run={run} size={size} />)
    await until(t.lastFrame, has('src/lib/tenant.ts'))
    await settle()
    t.stdin.write('y')
    await until(t.lastFrame, has('Done'))
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1]![0]).toMatchObject({ dryRun: false })
    expect(t.lastFrame()).toContain('set auth yourself')
  })

  it('does not apply when cancelled with n or Esc', async () => {
    const run = vi.fn(async (_o: { cwd: string; dryRun?: boolean; force?: boolean }) => plan)
    const n = nav()
    const t = render(<Headless nav={n} project={project} run={run} size={size} />)
    await until(t.lastFrame, has('src/lib/tenant.ts'))
    await settle()
    t.stdin.write('n')
    await settle(150)
    expect(run).toHaveBeenCalledTimes(1)
    expect(n.calls).toContain('pop')
  })

  it('says so when the project is already headless', async () => {
    const run = vi.fn(async () => ({ removed: [], kept: [], edited: [], manual: [], alreadyHeadless: true }))
    const t = render(<Headless nav={nav()} project={project} run={run} size={size} />)
    await until(t.lastFrame, has('already headless'))
    expect(t.lastFrame()).not.toContain('(y/N)')
  })

  it('f re-plans with force so changed files are included', async () => {
    const forced: HeadlessResult = { ...plan, removed: [...plan.removed, 'src/app/(frontend)/about/page.tsx'], kept: [] }
    const run = vi.fn(async (o: { cwd: string; dryRun?: boolean; force?: boolean }) => (o.force ? forced : plan))
    const t = render(<Headless nav={nav()} project={project} run={run} size={size} />)
    await until(t.lastFrame, has('Kept'))
    await settle()
    t.stdin.write('f')
    await until(t.lastFrame, (f) => !f.includes('Kept'))
    expect(run.mock.calls.at(-1)![0]).toMatchObject({ force: true, dryRun: true })
  })

  it('shows an error from the command instead of crashing', async () => {
    const run = vi.fn(async () => {
      throw new Error('Not inside a Payload project')
    })
    const t = render(<Headless nav={nav()} project={project} run={run} size={size} />)
    await until(t.lastFrame, has('Not inside a Payload project'))
  })
})
