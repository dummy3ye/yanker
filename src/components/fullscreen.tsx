import React, { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Box, useStdout } from 'ink'

export function FullScreen({ children }: { children: ReactNode }) {
  const { stdout } = useStdout()
  const dimensions = useCallback(
    () => ({
      columns: stdout?.columns && stdout.columns > 0 ? stdout.columns : 80,
      rows: stdout?.rows && stdout.rows > 1 ? stdout.rows : 24,
    }),
    [stdout],
  )
  const [size, setSize] = useState(dimensions)

  useEffect(() => {
    if (!stdout) return
    const onResize = () => setSize(dimensions())
    stdout.on('resize', onResize)
    // Initial sync in case we mounted after a resize
    setSize(dimensions())
    return () => {
      stdout.off('resize', onResize)
    }
  }, [stdout, dimensions])

  // Guard against zero/negative dimensions which can break Ink layout
  const safeWidth = Math.max(1, size.columns)
  const safeHeight = Math.max(1, size.rows - 1)

  return (
    <Box
      width={safeWidth}
      height={safeHeight}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <Box flexDirection="column" alignItems="center" flexShrink={0}>
        {children}
      </Box>
    </Box>
  )
}
