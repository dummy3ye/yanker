import { spawn } from 'node:child_process'

function sniff(cmd: string[], timeoutMs: number): Promise<string> {
  return new Promise(resolve => {
    const child = spawn(cmd[0], cmd.slice(1), {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
      windowsHide: true,
    })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.on('error', () => resolve(''))
    child.on('close', () => resolve(out.trim()))
  })
}

function clipboardCommands(): string[][] {
  if (process.platform === 'win32') {
    return [['powershell.exe', '-NoProfile', '-Command', 'Get-Clipboard']]
  }
  if (process.platform === 'darwin') {
    return [['pbpaste']]
  }
  if (process.env.WAYLAND_DISPLAY) {
    // native Wayland clipboard first; XWayland (xclip/xsel) as fallback
    return [['wl-paste'], ['xclip', '-selection', 'clipboard', '-o'], ['xsel', '-b', '-o']]
  }
  return [
    ['xclip', '-selection', 'clipboard', '-o'],
    ['xsel', '-b', '-o'],
  ]
}

/** Returns a URL from the clipboard if it looks like a link, otherwise undefined. */
export async function detectClipboardUrl(): Promise<string | undefined> {
  for (const cmd of clipboardCommands()) {
    const value = await sniff(cmd, 800)
    if (!value) continue
    const candidate = value.split('\n')[0]?.trim() ?? ''
    if (candidate && /^https?:\/\/\S+$/i.test(candidate) && !candidate.includes(' '))
      return candidate
  }
  return undefined
}
