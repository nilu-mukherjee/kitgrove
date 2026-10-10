import { Box, Text } from 'ink'
import React from 'react'

/** A scrolling table; keeps `selected` inside the visible window of `height` rows. */
export function Table({
  headers,
  rows,
  selected,
  height,
  empty = 'Nothing to show.',
}: {
  headers: string[]
  rows: string[][]
  selected: number
  height: number
  empty?: string
}) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const maxStart = Math.max(0, rows.length - height)
  const start = Math.min(Math.max(0, selected - Math.floor(height / 2)), maxStart)
  const visible = rows.slice(start, start + height)
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ')

  return (
    <Box flexDirection="column">
      <Text bold dimColor>
        {'  '}
        {line(headers)}
      </Text>
      {rows.length === 0 ? (
        <Text dimColor>{empty}</Text>
      ) : (
        visible.map((r, i) => {
          const index = start + i
          const isSel = index === selected
          return (
            <Text key={index} color={isSel ? 'cyan' : undefined} bold={isSel}>
              {isSel ? '› ' : '  '}
              {line(r)}
            </Text>
          )
        })
      )}
      {rows.length > height ? (
        <Text dimColor>
          {'  '}
          {selected + 1}/{rows.length}
        </Text>
      ) : null}
    </Box>
  )
}
