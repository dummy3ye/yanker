import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

export type PickerItem<T> = {
  key?: string
  label: string
  value: T
}

type PickerProps<T> = {
  items: Array<PickerItem<T>>
  onSelect: (item: PickerItem<T>) => void
  onHighlight?: (item: PickerItem<T>) => void
  limit?: number
  initialIndex?: number
  isFocused?: boolean
}

/**
 * Single-column picker that stops at the first/last item instead of
 * wrapping around. Same look and key handling as ink-select-input
 * (↑/↓, j/k, 1-9 jumps to the Nth visible row, ↵ selects) minus the loop.
 */
export function Picker<T>({
  items,
  onSelect,
  onHighlight,
  limit,
  initialIndex = 0,
  isFocused = true,
}: PickerProps<T>) {
  const [selected, setSelected] = useState(() =>
    items.length === 0 ? 0 : Math.min(Math.max(initialIndex, 0), items.length - 1),
  )

  const win = limit ?? items.length
  // clamp in case the list shrank since mount; derive the window from the
  // selection so the highlight is always visible — no extra state needed
  const current = items.length === 0 ? 0 : Math.min(selected, items.length - 1)
  const maxOffset = Math.max(0, items.length - win)
  const offset = Math.min(Math.max(current - win + 1, 0), maxOffset)
  const visible = items.slice(offset, offset + win)

  const move = (next: number) => {
    if (items.length === 0) return
    const clamped = Math.min(Math.max(next, 0), items.length - 1)
    if (clamped === current) return // stop at the ends — never wrap
    setSelected(clamped)
    const item = items[clamped]
    if (item) onHighlight?.(item)
  }

  useInput(
    (input, key) => {
      if (key.upArrow || input === 'k') move(current - 1)
      else if (key.downArrow || input === 'j') move(current + 1)
      else if (/^[1-9]$/.test(input)) {
        const target = visible[Number.parseInt(input, 10) - 1]
        if (target) onSelect(target)
      } else if (key.return) {
        const item = items[current]
        if (item) onSelect(item)
      }
    },
    { isActive: isFocused },
  )

  return (
    <Box flexDirection="column">
      {visible.map((item, index) => {
        const isSelected = offset + index === current
        return (
          <Box key={item.key ?? String(offset + index)}>
            <Box marginRight={1}>
              <Text color={isSelected ? '#a78bfa' : undefined}>{isSelected ? '❯' : ' '}</Text>
            </Box>
            <Text color={isSelected ? '#a78bfa' : '#d1d5db'} bold={isSelected}>
              {item.label}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
