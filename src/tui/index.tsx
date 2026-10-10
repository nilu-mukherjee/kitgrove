import { render } from 'ink'
import React from 'react'
import { findProject } from '../core/project.js'
import { App } from './App.js'

const ENTER_ALT = '\u001B[?1049h\u001B[H'
const LEAVE_ALT = '\u001B[?1049l'

/** Opens the full-screen TUI and always restores the terminal, including on errors and signals. */
export async function launchTui(): Promise<void> {
  const out = process.stdout
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    out.write(LEAVE_ALT)
  }

  out.write(ENTER_ALT)
  process.once('exit', restore)
  const onSignal = () => {
    restore()
    process.exit(130)
  }
  process.once('SIGTERM', onSignal)

  try {
    const cwd = process.cwd()
    const app = render(<App project={findProject(cwd)} cwd={cwd} />, { exitOnCtrlC: false })
    await app.waitUntilExit()
  } finally {
    restore()
    process.off('SIGTERM', onSignal)
  }
}
