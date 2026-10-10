import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildProgram } from '../src/cli.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('buildProgram', () => {
  it('is named kitgrove', () => {
    expect(buildProgram().name()).toBe('kitgrove')
  })

  it('reports the package.json version', () => {
    expect(buildProgram().version()).toBe(pkg.version)
  })
})
