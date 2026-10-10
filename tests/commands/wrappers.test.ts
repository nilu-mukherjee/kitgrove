import { describe, expect, it } from 'vitest'
import { runWrapper } from '../../src/commands/wrappers.js'
import { scriptCommand } from '../../src/core/exec.js'
import type { ProjectInfo } from '../../src/core/project.js'

const project = (pm: ProjectInfo['packageManager']): ProjectInfo => ({
  root: '/p',
  configPath: '/p/src/payload.config.ts',
  packageManager: pm,
})

describe('scriptCommand', () => {
  it('npm uses `run <script> --` only when there are args', () => {
    expect(scriptCommand('npm', 'dev', [])).toEqual({ command: 'npm', args: ['run', 'dev'] })
    expect(scriptCommand('npm', 'payload', ['migrate'])).toEqual({
      command: 'npm',
      args: ['run', 'payload', '--', 'migrate'],
    })
  })
  it('pnpm and yarn', () => {
    expect(scriptCommand('pnpm', 'payload', ['migrate'])).toEqual({
      command: 'pnpm',
      args: ['run', 'payload', 'migrate'],
    })
    expect(scriptCommand('yarn', 'build', [])).toEqual({ command: 'yarn', args: ['build'] })
  })
})

describe('runWrapper', () => {
  const spy = (code = 0) => {
    const calls: unknown[][] = []
    return { calls, exec: async (...a: unknown[]) => (calls.push(a), code) }
  }

  it.each([
    ['dev', 'dev', []],
    ['build', 'build', []],
    ['types', 'generate:types', []],
  ] as const)('%s runs the %s script', async (name, script, args) => {
    const { calls, exec } = spy()
    expect(await runWrapper(name, [], project('npm'), exec)).toBe(0)
    expect(calls).toEqual([[project('npm'), script, args]])
  })

  it('migrate passes its arguments to `payload migrate`', async () => {
    const { calls, exec } = spy()
    await runWrapper('migrate', ['create', 'add-notes'], project('pnpm'), exec)
    expect(calls).toEqual([[project('pnpm'), 'payload', ['migrate', 'create', 'add-notes']]])
  })

  it('propagates a non-zero exit code', async () => {
    expect(await runWrapper('build', [], project('npm'), spy(3).exec)).toBe(3)
  })
})
