import { Box, Text, useInput } from 'ink'
import React, { useState } from 'react'

export interface SelectItem<T extends string = string> {
  label: string
  value: T
  hint?: string
}

export function Select<T extends string>({
  items,
  onSelect,
  onHighlight,
  isActive = true,
  initialIndex = 0,
}: {
  items: SelectItem<T>[]
  onSelect: (value: T) => void
  onHighlight?: (value: T) => void
  isActive?: boolean
  initialIndex?: number
}) {
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(0, items.length - 1)))

  const move = (to: number) => {
    const next = Math.max(0, Math.min(items.length - 1, to))
    setIndex(next)
    if (items[next]) onHighlight?.(items[next]!.value)
  }

  useInput(
    (input, key) => {
      if (key.upArrow || input === 'k') move(index - 1)
      else if (key.downArrow || input === 'j') move(index + 1)
      else if (key.return && items[index]) onSelect(items[index]!.value)
    },
    { isActive },
  )

  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Text key={item.value} color={i === index ? 'cyan' : undefined} bold={i === index}>
          {i === index ? '› ' : '  '}
          {item.label}
          {item.hint ? <Text dimColor>  {item.hint}</Text> : null}
        </Text>
      ))}
    </Box>
  )
}
