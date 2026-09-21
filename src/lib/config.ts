import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const CONFIG_DIR = path.join(os.homedir(), '.yanker')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

export type YankerConfig = {
  lastOutDir?: string
}

export function expandPath(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

export function shortenForDisplay(p: string): string {
  const home = os.homedir()
  if (p === home) return '~'
  if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length)
  return p
}

export function resolveOutputPath(raw: string): string {
  const expanded = expandPath(raw.trim())
  return path.resolve(expanded)
}

export function loadConfigSync(): YankerConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    return JSON.parse(raw) as YankerConfig
  } catch {
    return {}
  }
}

export async function loadConfig(): Promise<YankerConfig> {
  try {
    const raw = await fsp.readFile(CONFIG_PATH, 'utf8')
    return JSON.parse(raw) as YankerConfig
  } catch {
    return {}
  }
}

export async function saveConfig(patch: Partial<YankerConfig>): Promise<void> {
  const current = await loadConfig()
  const next = { ...current, ...patch }
  await fsp.mkdir(CONFIG_DIR, { recursive: true })
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8')
}

export function saveConfigSync(patch: Partial<YankerConfig>): void {
  let current: YankerConfig = {}
  try {
    current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as YankerConfig
  } catch {
    // ignore
  }
  const next = { ...current, ...patch }
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8')
}

export function getInitialOutDir(cliOutDir: string, hasExplicitFlag: boolean): string {
  if (hasExplicitFlag) return cliOutDir
  if (process.env.YANKER_OUT) return cliOutDir
  const cfg = loadConfigSync()
  if (cfg.lastOutDir) {
    try {
      const st = fs.statSync(expandPath(cfg.lastOutDir))
      if (st.isDirectory()) return path.resolve(expandPath(cfg.lastOutDir))
    } catch {
      // stale entry, ignore
    }
    return path.resolve(expandPath(cfg.lastOutDir))
  }
  return cliOutDir
}

export function completePath(draft: string): string {
  const home = os.homedir()
  const expanded = draft.startsWith('~') ? draft.replace(/^~(?=\/|$)/, home) : draft
  const lastSep = expanded.lastIndexOf(path.sep)
  const dir = lastSep === -1 ? '.' : expanded.slice(0, lastSep) || path.sep
  const prefix = lastSep === -1 ? expanded : expanded.slice(lastSep + 1)
  try {
    const entries = fs.readdirSync(dir || '.', { withFileTypes: true })
    const matches = entries
      .filter(e => e.name.startsWith(prefix))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b))
    if (matches.length === 0) return draft
    const chosen = matches[0]!
    const full = path.join(dir === '.' ? '' : dir, chosen)
    const entry = entries.find(e => e.name === chosen)
    const trail = entry?.isDirectory() ? path.sep : ''
    const completedExpanded = full + trail
    if (draft.startsWith('~') && completedExpanded.startsWith(home)) {
      return '~' + completedExpanded.slice(home.length)
    }
    if (draft === '' && completedExpanded.startsWith(home)) {
      return '~' + completedExpanded.slice(home.length)
    }
    // Preserve relative '.' case: if original was relative, keep relative
    if (draft === prefix && dir === '.') return completedExpanded
    return completedExpanded
  } catch {
    return draft
  }
}
