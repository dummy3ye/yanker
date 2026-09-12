import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { getLastRawKey } from '../lib/keys.js'

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  placeholder?: string
  width?: number
  /** pressed when the field is empty — e.g. q to quit */
  onEmptyKey?: (input: string) => void
  /** ctrl+h while the input is focused — open help without deleting a char */
  onCtrlH?: () => void
}

/** Single-line editor: type, ⌫, ←/→, ^a/^e, ^u, ↵ submits. */
export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder = '',
  width = 40,
  onEmptyKey,
  onCtrlH,
}: Props) {
  const [cursor, setCursor] = useState(value.length)

  const place = (position: number) => setCursor(Math.max(0, Math.min(value.length, position)))

  const edit = (next: string, position: number) => {
    setCursor(Math.max(0, Math.min(next.length, position)))
    onChange(next)
  }

  useInput((input, key) => {
    if (key.return) {
      onSubmit?.(value)
      return
    }
    if (key.tab || key.pageUp || key.pageDown || key.upArrow || key.downArrow) return
    if (value === '' && (input === 'q' || key.escape)) {
      onEmptyKey?.(input)
      return
    }
    if (key.escape) return

    if (key.backspace) {
      // ctrl+h == 0x08, real backspace == 0x7f; Ink collapses both to
      // backspace=true, so read the raw byte to tell them apart.
      if (onCtrlH && getLastRawKey() === '\b') {
        onCtrlH()
        return
      }
      return edit(value.slice(0, Math.max(0, cursor - 1)) + value.slice(cursor), cursor - 1)
    }
    if (key.delete) return edit(value.slice(0, cursor) + value.slice(cursor + 1), cursor)
    if (key.leftArrow) return place(cursor - 1)
    if (key.rightArrow) return place(cursor + 1)
    if (key.home) return place(0)
    if (key.end) return place(value.length)
    if (key.ctrl && input === 'a') return place(0)
    if (key.ctrl && input === 'e') return place(value.length)
    if (key.ctrl && input === 'u') return edit(value.slice(cursor), 0)

    if (!input) return
    const clean = input.replace(/[\x00-\x1f\x7f]/g, '')
    if (!clean) return
    edit(value.slice(0, cursor) + clean + value.slice(cursor), cursor + clean.length)
  })

  const span = Math.max(8, width)
  const offset = Math.min(Math.max(0, value.length + 1 - span), cursor)

  return (
    <Box width={span}>
      {value.length === 0 ? (
        <>
          <Text inverse> </Text>
          <Text color="#6b7280">{placeholder.slice(0, span - 1)}</Text>
        </>
      ) : (
        Array.from({ length: Math.min(span, value.length - offset + 1) }, (_, column) => {
          const index = offset + column
          return (
            <Text key={index} inverse={index === cursor}>
              {value[index] ?? ' '}
            </Text>
          )
        })
      )}
    </Box>
  )
}
