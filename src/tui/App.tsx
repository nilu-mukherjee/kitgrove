import { Box, Text, useApp, useInput } from 'ink'
import { basename } from 'node:path'
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { LocalApi } from '../core/localApi.js'
import type { ProjectInfo } from '../core/project.js'
import { Frame, type Size, useSize } from './components/Frame.js'
import { TextEntryContext } from './components/TextInput.js'
import { Home } from './screens/Home.js'
import { ApiContext, type Nav, renderScreen, screenHints, screenTitle } from './screens/index.js'
import { navReducer, type Screen } from './state/nav.js'

const HELP = [
  ['↑ ↓ / j k', 'move'],
  ['Enter', 'open / confirm'],
  ['Esc', 'back'],
  ['?', 'toggle this help'],
  ['q', 'quit (from Home)'],
  ['Ctrl+C', 'quit, or stop a running process'],
]

export interface Session {
  api: LocalApi
  close: () => Promise<void>
}

export function App({
  project,
  cwd,
  size,
  connect,
}: {
  project: ProjectInfo | null
  cwd: string
  size?: Size
  /** Opens the database connection used by the data screens; called at most once, on first use. */
  connect?: () => Promise<Session>
}) {
  const [stack, dispatch] = useReducer(navReducer, [{ name: 'home' } as Screen])
  const [help, setHelp] = useState(false)
  const { exit } = useApp()
  const dims = useSize(size)
  const session = useRef<Promise<Session> | null>(null)
  const getApi = useMemo(
    () =>
      connect
        ? () => {
            session.current ??= connect()
            return session.current.then((s) => s.api)
          }
        : null,
    [connect],
  )
  // Close the connection when the app goes away, if it was ever opened.
  useEffect(
    () => () => {
      void session.current?.then((s) => s.close()).catch(() => {})
    },
    [],
  )
  const typing = useRef(0)
  const textEntry = useMemo(
    () => ({
      enter: () => {
        typing.current++
        return () => {
          typing.current--
        }
      },
    }),
    [],
  )
  const screen = stack[stack.length - 1]!

  const nav: Nav = {
    push: (s) => dispatch({ type: 'push', screen: s }),
    pop: () => dispatch({ type: 'pop' }),
    reset: (s) => dispatch({ type: 'reset', screen: s }),
  }

  useInput((input, key) => {
    // The Run screen uses Ctrl+C to stop its process; everywhere else it quits.
    if (key.ctrl && input === 'c') {
      if (screen.name !== 'run') exit()
      return
    }
    if (input === '?' && typing.current === 0) setHelp((h) => !h)
    else if (input === 'q' && screen.name === 'home' && !help && typing.current === 0) exit()
  })

  const ctx = { project, cwd, nav, size: dims }
  const title = project ? basename(project.root) : 'no project'

  return (
    <ApiContext.Provider value={getApi}>
    <TextEntryContext.Provider value={textEntry}>
    <Frame
      title={title}
      subtitle={screenTitle(screen)}
      hints={help ? ['? close help'] : screenHints(screen)}
      size={size}
    >
      {help ? (
        <Box flexDirection="column">
          <Text bold>Keys</Text>
          {HELP.map(([k, d]) => (
            <Text key={k}>
              <Text color="cyan">{k!.padEnd(12)}</Text>
              {d}
            </Text>
          ))}
        </Box>
      ) : screen.name === 'home' ? (
        <Home ctx={ctx} active />
      ) : (
        renderScreen(screen, ctx)
      )}
    </Frame>
    </TextEntryContext.Provider>
    </ApiContext.Provider>
  )
}
