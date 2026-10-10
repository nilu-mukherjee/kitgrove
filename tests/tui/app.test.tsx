import { render } from 'ink-testing-library'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryApi } from '../helpers/memoryApi.js'
import { has, settle, until } from '../helpers/ink.js'
import { cleanup } from 'ink-testing-library'
import type { ProjectInfo } from '../../src/core/project.js'
import { App } from '../../src/tui/App.js'

afterEach(cleanup)

const DOWN = '\u001B[B'
const tick = () => new Promise((r) => setTimeout(r, 80))
const size = { columns: 100, rows: 30 }

const project: ProjectInfo = {
  root: '/work/my-site',
  configPath: '/work/my-site/src/payload.config.ts',
  packageManager: 'npm',
}

describe('App / Home', () => {
  it('shows the project menu inside a project', () => {
    const { lastFrame } = render(<App project={project} cwd="/work/my-site" size={size} />)
    const out = lastFrame()!
    expect(out).toContain('my-site')
    for (const label of ['Collections', 'New collection', 'Tenants', 'Users', 'Access', 'Data', 'Run', 'Doctor', 'Quit']) {
      expect(out, label).toContain(label)
    }
    expect(out).not.toContain('Create project')
  })

  it('offers only Create project and Quit outside a project', () => {
    const { lastFrame } = render(<App project={null} cwd="/tmp" size={size} />)
    const out = lastFrame()!
    expect(out).toContain('Create project')
    expect(out).toContain('Quit')
    expect(out).not.toContain('Tenants')
  })

  it('navigates into a screen with Enter and back with Esc', async () => {
    const { stdin, lastFrame } = render(<App project={project} cwd="/work/my-site" size={size} />)
    stdin.write(DOWN) // New collection
    await tick()
    stdin.write(DOWN) // Tenants
    await tick()
    stdin.write('\r')
    await tick()
    expect(lastFrame()).toContain('Tenants')
    expect(lastFrame()).toContain('Esc back')
    stdin.write('\u001B')
    await tick()
    expect(lastFrame()).toContain('New collection')
  })

  it('toggles the help overlay with ?', async () => {
    const { stdin, lastFrame } = render(<App project={project} cwd="/work/my-site" size={size} />)
    stdin.write('?')
    await tick()
    expect(lastFrame()).toContain('Keys')
    stdin.write('?')
    await tick()
    expect(lastFrame()).not.toContain('Keys')
  })

  it('does not treat ? as help while typing in a text field', async () => {
    const { stdin, lastFrame } = render(<App project={project} cwd="/work/my-site" size={size} />)
    stdin.write(DOWN) // New collection
    await tick()
    stdin.write('\r')
    await tick()
    stdin.write('Why?')
    await tick()
    expect(lastFrame()).toContain('Why?')
    expect(lastFrame()).not.toContain('Keys')
  })

  it('opens the collection builder from Home', async () => {
    const { stdin, lastFrame } = render(<App project={project} cwd="/work/my-site" size={size} />)
    stdin.write(DOWN)
    await tick()
    stdin.write('\r')
    await tick()
    expect(lastFrame()).toContain('Name:')
    expect(lastFrame()).toContain('Preview')
  })

  it('shows the too-small message in a small terminal', () => {
    const { lastFrame } = render(<App project={project} cwd="/work" size={{ columns: 50, rows: 10 }} />)
    expect(lastFrame()).toContain('too small')
  })
})

describe('App / data screens', () => {
  const connect = () => {
    const { api } = memoryApi({
      seed: { tenants: [{ slug: 'acme', name: 'Acme', domain: 'acme.com' }] },
    })
    const close = vi.fn(async () => {})
    return { connect: vi.fn(async () => ({ api, close })), close }
  }

  it('connects lazily when a data screen opens and shows its data', async () => {
    const c = connect()
    const t = render(<App project={project} cwd="/work/my-site" size={size} connect={c.connect} />)
    expect(c.connect).not.toHaveBeenCalled()
    await settle()
    t.stdin.write(DOWN)
    await settle()
    t.stdin.write(DOWN) // Tenants
    await settle()
    t.stdin.write('\r')
    await until(t.lastFrame, has('acme.com'))
    expect(c.connect).toHaveBeenCalledTimes(1)
  })

  it('closes the connection when the app unmounts', async () => {
    const c = connect()
    const t = render(<App project={project} cwd="/work/my-site" size={size} connect={c.connect} />)
    await settle()
    t.stdin.write(DOWN)
    await settle()
    t.stdin.write(DOWN)
    await settle()
    t.stdin.write('\r')
    await until(t.lastFrame, has('acme.com'))
    t.unmount()
    await vi.waitFor(() => expect(c.close).toHaveBeenCalledTimes(1))
  })

  it('shows a connection failure and lets the user go back', async () => {
    const connect = vi.fn(async () => {
      throw new Error('Could not initialise Payload: connect ECONNREFUSED')
    })
    const t = render(<App project={project} cwd="/work/my-site" size={size} connect={connect} />)
    await settle()
    t.stdin.write(DOWN)
    await settle()
    t.stdin.write(DOWN)
    await settle()
    t.stdin.write('\r')
    await until(t.lastFrame, has('ECONNREFUSED'))
    t.stdin.write('\u001B')
    await until(t.lastFrame, has('New collection'))
  })
})
