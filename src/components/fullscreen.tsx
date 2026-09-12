import React, { useEffect, useState, type ReactNode } from 'react'
import { Box, useStdout } from 'ink'

export function FullScreen({ children }: { children: ReactNode }) {
  const { stdout } = useStdout()
  const dimensions = () => ({
    columns: stdout?.columns && stdout.columns > 0 ? stdout.columns : 80,
    rows: stdout?.rows && stdout.rows > 1 ? stdout.rows : 24,
  })
  const [size, setSize] = useState(dimensions)

  useEffect(() => {
    if (!stdout) return
    const onResize = () => setSize(dimensions())
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
    }
  }, [stdout])

  return (
    <Box
      width={size.columns}
      height={size.rows - 1}
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
