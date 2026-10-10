import { Box, Text, useStdout } from 'ink'
import React from 'react'

export const MIN_COLUMNS = 80
export const MIN_ROWS = 24

export interface Size {
  columns: number
  rows: number
}

export function useSize(override?: Size): Size {
  const { stdout } = useStdout()
  return override ?? { columns: stdout?.columns ?? MIN_COLUMNS, rows: stdout?.rows ?? MIN_ROWS }
}

/** Header, body and key hints. Below 80x24 it shows a message instead of a broken layout. */
export function Frame({
  title,
  subtitle,
  hints,
  size,
  children,
}: {
  title: string
  subtitle?: string
  hints: string[]
  size?: Size
  children?: React.ReactNode
}) {
  const s = useSize(size)
  if (s.columns < MIN_COLUMNS || s.rows < MIN_ROWS) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          Terminal too small: need {MIN_COLUMNS}x{MIN_ROWS}, have {s.columns}x{s.rows}.
        </Text>
        <Text dimColor>Resize the window, or press Ctrl+C to quit.</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" width={s.columns} height={s.rows}>
      <Box borderStyle="round" paddingX={1}>
        <Text bold color="cyan">
          kitgrove
        </Text>
        <Text> · {title}</Text>
        {subtitle ? <Text dimColor> · {subtitle}</Text> : null}
      </Box>
      <Box flexGrow={1} flexDirection="column" paddingX={1} paddingY={1}>
        {children}
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{hints.join('  ·  ')}</Text>
      </Box>
    </Box>
  )
}
