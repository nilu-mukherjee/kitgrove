import { Text, useInput } from 'ink'
import React, { createContext, useContext, useEffect, useRef } from 'react'

/**
 * Lets the App know when a text input is accepting typing, so global shortcuts such as `?` pause.
 * `enter()` registers one active input and returns its cleanup.
 */
export const TextEntryContext = createContext<{ enter: () => () => void } | null>(null)

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
  // Keystrokes can arrive before React re-subscribes the handler; the ref always holds the latest text.
  const latest = useRef(value)
  latest.current = value
  const entry = useContext(TextEntryContext)
  useEffect(() => (isActive ? entry?.enter() : undefined), [isActive, entry])

  useInput(
    (input, key) => {
      const change = (next: string) => {
        latest.current = next
        onChange(next)
      }
      if (key.return) onSubmit?.(latest.current)
      else if (key.escape) onCancel?.()
      else if (key.backspace || key.delete) change(latest.current.slice(0, -1))
      else if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.tab) {
        change(latest.current + input)
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
