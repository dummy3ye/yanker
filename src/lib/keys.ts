import { useEffect } from 'react'
import { useStdin } from 'ink'

let lastRawKey = ''

/** Raw char from the last keypress, before Ink normalizes it. */
export function getLastRawKey(): string {
  return lastRawKey
}

/**
 * Tracks the raw stdin byte. Ink's useInput collapses both ctrl+h (0x08)
 * and backspace (0x7f) into `backspace: true` with `input: ''`, so the raw
 * byte is the only way to tell them apart. `prependListener` makes sure
 * this is read before Ink's own stdin handler runs on the same chunk.
 */
export function useRawKeyMonitor(): void {
  const { stdin, isRawModeSupported } = useStdin()
  useEffect(() => {
    if (!stdin || !isRawModeSupported) {
      return
    }
    const onData = (chunk: Buffer) => {
      const bytes = chunk as Buffer
      lastRawKey = String.fromCharCode(bytes[bytes.length - 1])
    }
    stdin.prependListener('data', onData)
    return () => {
      stdin.removeListener('data', onData)
      lastRawKey = ''
    }
  }, [stdin, isRawModeSupported])
}
