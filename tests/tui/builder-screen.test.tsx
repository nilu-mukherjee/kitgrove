import { render } from 'ink-testing-library'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from 'ink-testing-library'
import type { GenerateResult } from '../../src/commands/generate.js'
import { Builder } from '../../src/tui/screens/Builder.js'
import { has, settle, until } from '../helpers/ink.js'

const DOWN = '\u001B[B'
const ESC = '\u001B'
const CTRL_S = '\u0013'
const info = { collections: ['users', 'media', 'posts'], blocks: ['hero'] }
const size = { columns: 110, rows: 32 }

afterEach(cleanup)

function setup(result: GenerateResult = { files: ['src/collections/CaseStudies.ts'], registered: true }) {
  const generate = vi.fn(async () => result)
  const onExit = vi.fn()
  const utils = render(<Builder kind="collection" info={info} generate={generate} onExit={onExit} size={size} />)
  const frame = () => utils.lastFrame()
  /** Sends keys, then waits for the screen to show `expected`. */
  const send = async (keys: string, expected?: string) => {
    utils.stdin.write(keys)
    if (expected) await until(frame, has(expected))
    await settle()
  }
  return { ...utils, generate, onExit, send, frame }
}

/** Name entered, useAsTitle left on auto: the table is focused. */
async function toTable(t: ReturnType<typeof setup>, name: string) {
  await t.send(name, name)
  await t.send('\r', 'auto (title')
  await t.send('\r', 'a add')
}

describe('Builder', () => {
  it('walks name -> useAsTitle -> a field, then writes through generate', async () => {
    const t = setup()
    await toTable(t, 'Case Studies')
    await t.send('a', 'New field')
    await t.send('client', 'client')
    await t.send('\r', 'Save field')
    await t.send(DOWN)
    await t.send(DOWN)
    await t.send('\r', '[x]') // required toggled
    await t.send(CTRL_S, 'client') // field saved, back in the table
    await until(t.frame, (f) => f.includes('required') && f.includes('a add'))

    await t.send(CTRL_S, 'Created src/collections/CaseStudies.ts')
    expect(t.generate).toHaveBeenCalledTimes(1)
    const [kind, name, opts] = t.generate.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(kind).toBe('collection')
    expect(name).toBe('Case Studies')
    expect(opts.fields).toEqual([expect.objectContaining({ name: 'client', type: 'text', required: true })])
    expect(opts.useAsTitle).toBeUndefined()
  })

  it('shows the live preview as fields are added', async () => {
    const t = setup()
    await toTable(t, 'Notes')
    await until(t.frame, has("slug: 'notes'"))
    await t.send('a', 'New field')
    await t.send('summary', 'summary')
    await t.send('\r', 'Save field')
    await t.send(CTRL_S, "name: 'summary'")
  })

  it('refuses to write without a name and says why', async () => {
    const t = setup()
    await t.send('\r') // empty name
    await t.send('\r', 'a add') // useAsTitle auto
    await t.send(CTRL_S, 'Enter a name')
    expect(t.generate).not.toHaveBeenCalled()
  })

  it('shows manual instructions and keeps the builder state', async () => {
    const t = setup({
      files: ['src/collections/Notes.ts'],
      registered: false,
      manualInstructions: 'Could not edit the config automatically. Add: import { Notes }',
    })
    await toTable(t, 'Notes')
    await t.send(CTRL_S, 'Could not edit the config automatically')
    expect(t.generate).toHaveBeenCalled()
    await t.send(ESC, 'a add')
    expect(t.frame()).toContain('Notes')
    expect(t.frame()).toContain('Fields')
  })

  it('blocks a duplicate field name with an inline error', async () => {
    const t = setup()
    await toTable(t, 'Notes')
    await t.send('a', 'New field')
    await t.send('dup', 'dup')
    await t.send('\r', 'Save field')
    await t.send(CTRL_S, 'a add')
    await t.send('a', 'New field')
    await t.send('dup', 'dup')
    await t.send('\r', 'Save field')
    await t.send(CTRL_S, 'Duplicate field "dup"')
  })

  it('asks before discarding work on Esc', async () => {
    const t = setup()
    await toTable(t, 'Notes')
    await t.send(ESC, 'Discard')
    expect(t.onExit).not.toHaveBeenCalled()
    await t.send('y')
    await vi.waitFor(() => expect(t.onExit).toHaveBeenCalled())
  })

  it('adds an array field and drills into it', async () => {
    const t = setup()
    await toTable(t, 'Notes')
    await t.send('a', 'New field')
    await t.send('links', 'links')
    await t.send('\r', 'Save field')
    await t.send(DOWN) // type row
    await t.send('\r', 'Type ·') // type picker opens on the current type (text)
    for (let i = 0; i < 20; i++) {
      t.stdin.write('k') // up to the first option: array
      await settle(8)
    }
    await t.send('\r', 'Save field')
    await t.send(CTRL_S, 'Fields › links'.slice(0, 6)) // saved: container gets a default child
    await until(t.frame, has('a add'))
    await t.send('\r', 'Fields › links')
    expect(t.frame()).toContain('title')
  })
})
