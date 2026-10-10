import { Text, useInput } from 'ink'
import React from 'react'

/** Destructive-action confirm: only `y` confirms; `n`, Esc or Enter cancel. */
export function Confirm({
  message,
  onConfirm,
  onCancel,
}: {
  message: string
  onConfirm: () => void
  onCancel: () => void
}) {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y') onConfirm()
    else if (input === 'n' || input === 'N' || key.escape || key.return) onCancel()
  })
  return (
    <Text color="yellow">
      {message} <Text dimColor>(y/N)</Text>
    </Text>
  )
}
