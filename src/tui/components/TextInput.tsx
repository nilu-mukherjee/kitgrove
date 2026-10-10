import { Text, useInput } from 'ink'
import React from 'react'

/** Single-line input; the parent owns the value. Edits happen at the end of the line. */
export function TextInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  mask,
  isActive = true,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  onCancel?: () => void
  placeholder?: string
  mask?: boolean
  isActive?: boolean
}) {
  useInput(
    (input, key) => {
      if (key.return) onSubmit?.(value)
      else if (key.escape) onCancel?.()
      else if (key.backspace || key.delete) onChange(value.slice(0, -1))
      else if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.tab) {
        onChange(value + input)
      }
    },
    { isActive },
  )

  const shown = mask ? '•'.repeat(value.length) : value
  if (!value && placeholder && isActive) {
    return (
      <Text>
        <Text inverse> </Text>
        <Text dimColor>{placeholder}</Text>
      </Text>
    )
  }
  return (
    <Text>
      {shown}
      {isActive ? <Text inverse> </Text> : null}
    </Text>
  )
}
