import { describe, expect, it } from 'vitest'
import { spawnLogged } from '../../src/core/exec.js'

describe('spawnLogged', () => {
  it('streams complete lines from stdout and stderr and resolves with the exit code', async () => {
    const lines: string[] = []
    const p = spawnLogged(
      'node',
      ['-e', "process.stdout.write('one\\ntw'); process.stdout.write('o\\n'); console.error('err'); process.exit(3)"],
      process.cwd(),
      (l) => lines.push(l),
    )
    expect(await p.done).toBe(3)
    expect(lines.sort()).toEqual(['err', 'one', 'two'])
  })

  it('stop() terminates a long-running process', async () => {
    const lines: string[] = []
    const p = spawnLogged(
      'node',
      ['-e', "console.log('up'); setInterval(() => {}, 1000)"],
      process.cwd(),
      (l) => lines.push(l),
    )
    await new Promise<void>((resolve) => {
      const t = setInterval(() => lines.includes('up') && (clearInterval(t), resolve()), 10)
    })
    p.stop()
    const code = await p.done
    expect(code).not.toBe(0)
  })

  it('reports a command that cannot start', async () => {
    const lines: string[] = []
    const p = spawnLogged('definitely-not-a-command-xyz', [], process.cwd(), (l) => lines.push(l))
    expect(await p.done).not.toBe(0)
    expect(lines.join('\n')).toMatch(/definitely-not-a-command-xyz/)
  })
})
