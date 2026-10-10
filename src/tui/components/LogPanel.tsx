import { Box, Text } from 'ink'
import React from 'react'

/** Shows the last `height` lines of a growing log. */
export function LogPanel({ lines, height, title }: { lines: string[]; height: number; title?: string }) {
  const shown = lines.slice(-height)
  return (
    <Box flexDirection="column">
      {title ? <Text bold>{title}</Text> : null}
      {shown.length === 0 ? <Text dimColor>(no output yet)</Text> : shown.map((l, i) => <Text key={i}>{l}</Text>)}
    </Box>
  )
}
