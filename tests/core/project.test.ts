import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CliError } from '../../src/core/errors.js'
import { findProject, requireProject } from '../../src/core/project.js'

function makeProject(opts: { lock?: string; dir?: string; configIn?: 'src' | 'root' } = {}) {
  const base = mkdtempSync(join(tmpdir(), opts.dir ?? 'paycms-'))
  writeFileSync(join(base, 'package.json'), JSON.stringify({ dependencies: { payload: '^3.0.0' } }))
  if (opts.configIn === 'root') writeFileSync(join(base, 'payload.config.ts'), 'export default {}')
  else {
    mkdirSync(join(base, 'src'))
    writeFileSync(join(base, 'src', 'payload.config.ts'), 'export default {}')
  }
  if (opts.lock) writeFileSync(join(base, opts.lock), '')
  return base
}

describe('findProject', () => {
  it('finds the root from a nested subdirectory', () => {
    const root = makeProject()
    const nested = join(root, 'src', 'deep')
    mkdirSync(nested)
    const p = findProject(nested)
    expect(p?.root).toBe(root)
    expect(p?.configPath).toBe(join(root, 'src', 'payload.config.ts'))
  })

  it('detects pnpm from pnpm-lock.yaml', () => {
    expect(findProject(makeProject({ lock: 'pnpm-lock.yaml' }))?.packageManager).toBe('pnpm')
  })

  it('detects yarn from yarn.lock and defaults to npm', () => {
    expect(findProject(makeProject({ lock: 'yarn.lock' }))?.packageManager).toBe('yarn')
    expect(findProject(makeProject())?.packageManager).toBe('npm')
  })

  it('finds a config at the project root', () => {
    const root = makeProject({ configIn: 'root' })
    expect(findProject(root)?.configPath).toBe(join(root, 'payload.config.ts'))
  })

  it('returns null outside a project', () => {
    expect(findProject(mkdtempSync(join(tmpdir(), 'paycms-empty-')))).toBeNull()
  })

  it('works for a path containing spaces', () => {
    const root = makeProject({ dir: 'paycms with space ' })
    expect(findProject(root)?.root).toBe(root)
  })
})

describe('requireProject', () => {
  it('throws a CliError outside a project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paycms-empty-'))
    expect(() => requireProject(dir)).toThrow(CliError)
    expect(() => requireProject(dir)).toThrow(/Not inside a Payload project/)
  })
})
