import { render } from 'ink-testing-library'
import React from 'react'
import { describe, expect, it } from 'vitest'
import { Hello } from '../../src/tui/components/Hello.js'

describe('ink', () => {
  it('renders a component', () => {
    const { lastFrame } = render(<Hello name="x" />)
    expect(lastFrame()).toContain('Hello x')
  })
})
