import { describe, expect, it } from 'vitest'
import { shouldLaunchTui } from '../../src/tui/entry.js'

const tty = { stdinIsTTY: true, stdoutIsTTY: true }

describe('shouldLaunchTui', () => {
  it.each([
    [[], tty, true],
    [['tui'], tty, true],
    [[], { stdinIsTTY: false, stdoutIsTTY: true }, false],
    [[], { stdinIsTTY: true, stdoutIsTTY: false }, false],
    [['create'], tty, false],
    [['--help'], tty, false],
    [['--version'], tty, false],
    [['generate', 'collection', 'x'], tty, false],
  ])('argv=%j %j -> %s', (argv, ttys, expected) => {
    expect(shouldLaunchTui({ argv: argv as string[], ...ttys })).toBe(expected)
  })
})
