import { render } from 'ink'
import React from 'react'
import type { LocalApi } from '../core/localApi.js'
import { openLocalApi } from '../core/payload.js'
import { findProject } from '../core/project.js'
import { App } from './App.js'

const ENTER_ALT = '\u001B[?1049h\u001B[H'
const LEAVE_ALT = '\u001B[?1049l'

function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | undefined
  return () => (result ??= fn())
}

/** Opens the full-screen TUI and always restores the terminal, including on errors and signals. */
export async function launchTui(): Promise<void> {
  const out = process.stdout
  const session: { opened: Promise<{ api: LocalApi; close: () => Promise<void> }> | null } = { opened: null }
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
    const project = findProject(cwd)
    const connect = project
      ? () => {
          session.opened ??= openLocalApi(project).then((s) => ({ api: s.api, close: once(s.close) }))
          return session.opened
        }
      : undefined
    const app = render(<App project={project} cwd={cwd} connect={connect} />, { exitOnCtrlC: false })
    await app.waitUntilExit()
    // Wait for the connection to be released so the process can exit cleanly.
    await session.opened?.then((s) => s.close()).catch(() => {})
  } finally {
    restore()
    process.off('SIGTERM', onSignal)
  }
}
