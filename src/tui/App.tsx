import { Box, Text, useApp, useInput } from 'ink'
import { basename } from 'node:path'
import React, { useReducer, useState } from 'react'
import type { ProjectInfo } from '../core/project.js'
import { Frame, type Size, useSize } from './components/Frame.js'
import { Home } from './screens/Home.js'
import { type Nav, renderScreen, screenHints, screenTitle } from './screens/index.js'
import { navReducer, type Screen } from './state/nav.js'

const HELP = [
  ['↑ ↓ / j k', 'move'],
  ['Enter', 'open / confirm'],
  ['Esc', 'back'],
  ['?', 'toggle this help'],
  ['q', 'quit (from Home)'],
  ['Ctrl+C', 'quit, or stop a running process'],
]

export function App({ project, cwd, size }: { project: ProjectInfo | null; cwd: string; size?: Size }) {
  const [stack, dispatch] = useReducer(navReducer, [{ name: 'home' } as Screen])
  const [help, setHelp] = useState(false)
  const { exit } = useApp()
  const dims = useSize(size)
  const screen = stack[stack.length - 1]!

  const nav: Nav = {
    push: (s) => dispatch({ type: 'push', screen: s }),
    pop: () => dispatch({ type: 'pop' }),
    reset: (s) => dispatch({ type: 'reset', screen: s }),
  }

  useInput((input) => {
    if (input === '?') setHelp((h) => !h)
    else if (input === 'q' && screen.name === 'home' && !help) exit()
  })

  const ctx = { project, cwd, nav, size: dims }
  const title = project ? basename(project.root) : 'no project'

  return (
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
  )
}
