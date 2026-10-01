export type ThemeMode = 'auto' | 'light' | 'dark'

export type Theme = {
  mode: 'light' | 'dark'
  primary: string
  gray: string
  dim: boolean
}

const LIGHT: Theme = { mode: 'light', primary: '#8a5cf6', gray: '#6b6b76', dim: true }
const DARK: Theme = { mode: 'dark', primary: '#a78bfa', gray: '#9ca3af', dim: false }

function detectMode(): 'light' | 'dark' {
  const colorFgBg = process.env.COLORFGBG
  if (colorFgBg) {
    const [, bg] = colorFgBg.split(';').map(Number)
    return bg === 0 || bg === 15 ? 'dark' : 'light'
  }
  // No COLORFGBG to go on: assume light unless the terminal advertises a
  // dark background via a truecolor-capable COLORTERM or a dark-ish theme var.
  if (process.env.COLORTERM === 'truecolor' && process.env.YANKER_THEME !== 'light')
    return 'dark'
  return 'light'
}

const availableModes: ThemeMode[] = ['auto', 'light', 'dark']

/** Modes cycled by ctrl+t, in order. Exported for the help line. */
export const THEME_CYCLE: readonly ThemeMode[] = availableModes

export function nextThemeMode(current: ThemeMode): ThemeMode {
  const index = availableModes.indexOf(current)
  return availableModes[(index + 1) % availableModes.length]!
}

export function getTheme(mode: ThemeMode): Theme {
  if (mode === 'light') return LIGHT
  if (mode === 'dark') return DARK
  return detectMode() === 'light' ? LIGHT : DARK
}

// `auto` is resolved against the terminal background once and then
// treated as a concrete mode, so a mid-session background change does not
// cause a re-render storm.
