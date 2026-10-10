import { render } from 'ink-testing-library'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Confirm } from '../../src/tui/components/Confirm.js'
import { Frame } from '../../src/tui/components/Frame.js'
import { Select } from '../../src/tui/components/Select.js'
import { Table } from '../../src/tui/components/Table.js'
import { TextInput } from '../../src/tui/components/TextInput.js'

const DOWN = '\u001B[B'
const UP = '\u001B[A'
const tick = () => new Promise((r) => setTimeout(r, 20))

describe('Frame', () => {
  it('renders title, body and hints in a large enough terminal', () => {
    const { lastFrame } = render(
      <Frame title="my-site" hints={['↑↓ move', 'q quit']} size={{ columns: 100, rows: 30 }}>
        <></>
      </Frame>,
    )
    const out = lastFrame()!
    expect(out).toContain('my-site')
    expect(out).toContain('↑↓ move')
    expect(out).not.toContain('too small')
  })

  it('shows a too-small message below 80x24', () => {
    const { lastFrame } = render(
      <Frame title="x" hints={[]} size={{ columns: 60, rows: 10 }}>
        <></>
      </Frame>,
    )
    expect(lastFrame()).toMatch(/too small.*80x24.*60x10/s)
  })
})

describe('Select', () => {
  const items = [
    { label: 'One', value: 'one' },
    { label: 'Two', value: 'two' },
    { label: 'Three', value: 'three' },
  ]

  it('moves with arrows / j k and selects with Enter', async () => {
    const onSelect = vi.fn()
    const { stdin, lastFrame } = render(<Select items={items} onSelect={onSelect} />)
    expect(lastFrame()).toContain('› One')
    stdin.write(DOWN)
    await tick()
    stdin.write('j')
    await tick()
    expect(lastFrame()).toContain('› Three')
    stdin.write(UP)
    await tick()
    stdin.write('\r')
    await tick()
    expect(onSelect).toHaveBeenCalledWith('two')
  })

  it('stops at the ends instead of wrapping', async () => {
    const { stdin, lastFrame } = render(<Select items={items} onSelect={() => {}} />)
    stdin.write(UP)
    await tick()
    expect(lastFrame()).toContain('› One')
  })

  it('ignores input when inactive', async () => {
    const onSelect = vi.fn()
    const { stdin } = render(<Select items={items} onSelect={onSelect} isActive={false} />)
    stdin.write('\r')
    await tick()
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('TextInput', () => {
  it('collects typed characters, supports backspace, submits on Enter and cancels on Esc', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    function Host() {
      const [v, setV] = React.useState('')
      return <TextInput value={v} onChange={setV} onSubmit={onSubmit} onCancel={onCancel} />
    }
    const { stdin, lastFrame } = render(<Host />)
    stdin.write('abc')
    await tick()
    stdin.write('\u007F')
    await tick()
    expect(lastFrame()).toContain('ab')
    stdin.write('\r')
    await tick()
    expect(onSubmit).toHaveBeenCalledWith('ab')
    stdin.write('\u001B')
    await tick()
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('Table', () => {
  const rows = Array.from({ length: 30 }, (_, i) => [`row-${i}`, String(i)])

  it('renders headers and scrolls to keep the selected row visible', () => {
    const { lastFrame } = render(<Table headers={['NAME', 'N']} rows={rows} selected={25} height={5} />)
    const out = lastFrame()!
    expect(out).toContain('NAME')
    expect(out).toContain('row-25')
    expect(out).not.toContain('row-0 ')
  })

  it('shows an empty message', () => {
    const { lastFrame } = render(<Table headers={['NAME']} rows={[]} selected={0} height={5} empty="Nothing here" />)
    expect(lastFrame()).toContain('Nothing here')
  })
})

describe('Confirm', () => {
  it('confirms with y and cancels with n or Esc', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { stdin, lastFrame } = render(<Confirm message="Delete it?" onConfirm={onConfirm} onCancel={onCancel} />)
    expect(lastFrame()).toContain('Delete it?')
    stdin.write('n')
    await tick()
    expect(onCancel).toHaveBeenCalledTimes(1)
    stdin.write('y')
    await tick()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
