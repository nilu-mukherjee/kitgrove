/** Pure so the CLI can decide cheaply, before loading Ink. */
export function shouldLaunchTui(a: { argv: string[]; stdinIsTTY: boolean; stdoutIsTTY: boolean }): boolean {
  if (!a.stdinIsTTY || !a.stdoutIsTTY) return false
  return a.argv.length === 0 || (a.argv.length === 1 && a.argv[0] === 'tui')
}
