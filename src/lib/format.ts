export function formatBytes(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return ''
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

export function formatSpeed(bytesPerSec: number | undefined): string {
  if (!bytesPerSec || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return ''
  return `${formatBytes(bytesPerSec)}/s`
}

export function formatEta(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return ''
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m ${Math.ceil(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`
}

export function truncate(text: string, width: number): string {
  if (text.length <= width) return text
  if (width <= 1) return '…'
  return `${text.slice(0, width - 1)}…`
}

export function shortenPath(filepath: string, homeDir: string, width: number): string {
  const pretty = filepath.startsWith(homeDir) ? `~${filepath.slice(homeDir.length)}` : filepath
  if (pretty.length <= width) return pretty
  const name = pretty.split('/').pop() ?? pretty
  if (name.length > width - 7) return `…/${truncate(name, width - 4)}`
  return `…/${name}`
}