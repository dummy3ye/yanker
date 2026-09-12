import React from 'react'
import {Box, Text, useStdout} from 'ink'

const BAR_CHARS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█']

export function ProgressBar({percent, color = '#a78bfa'}: {percent: number; color?: string}) {
  const {stdout} = useStdout()
  const columns = stdout.columns > 0 ? stdout.columns : 80
  const width = Math.max(10, Math.min(64, columns - 6))
  const filled = Math.max(0, Math.min(1, percent)) * width
  const whole = Math.floor(filled)
  const frac = Math.round((filled - whole) * 8)

  const cells: React.ReactNode[] = []
  for (let i = 0; i < width; i++) {
    if (i < whole) cells.push('█')
    else if (i === whole && frac > 0) cells.push(BAR_CHARS[frac]!)
    else cells.push(' ')
  }

  return (
    <Box width={width + 2} borderStyle="round" borderColor="#4b5563">
      <Text color={color}>{cells}</Text>
    </Box>
  )
}