import React from 'react'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { render } from 'ink'
import { App } from './app.js'
import {
  buildChoices,
  download,
  ensureYtDlp,
  findFfmpeg,
  probe,
  type DownloadChoice,
} from './lib/ytdlp.js'
import { formatBytes, formatDuration } from './lib/format.js'

const VERSION: string = createRequire(import.meta.url)('../package.json').version

const HELP = `
  yanker — grab any video. every quality, with estimated sizes.

  Usage
    $ yanker [url] [options]

  Examples
    $ yanker https://youtu.be/dQw4w9WgXcQ
    $ yanker https://x.com/user/status/123456
    $ yanker                        (prompts for a url)
    $ yanker <url> --list           (print every format + size, no download)
    $ yanker <url> --best           (grab the best format, no picker)
    $ yanker <url> --mp3            (audio only, straight to mp3)
    $ yanker --update-yt-dlp        (self-update the standalone yt-dlp)

  Options
    -o, --output <dir>  save files here (default ~/Videos)
    --theme <mode>      auto, light, or dark
    -b, --best          grab the best format without the picker
    -m, --mp3           audio only, straight to mp3
    -l, --list          list all formats without opening the picker
    -U, --update-yt-dlp update the standalone/self-fetched yt-dlp
    -h, --help          show this help
    -v, --version       show version

  Playlists are detected automatically — the picker offers “grab all”.
  Downloads are saved to ~/Videos by default.
  Powered by yt-dlp + ffmpeg.
`

function parseArgs(argv: string[]): {
  url?: string
  outDir: string
  theme?: 'auto' | 'light' | 'dark'
  list: boolean
  best: boolean
  mp3: boolean
  update: boolean
  help: boolean
  version: boolean
  error?: string
} {
  let outDir = process.env.YANKER_OUT || path_home('Videos')
  let theme: 'auto' | 'light' | 'dark' | undefined
  let url: string | undefined
  let list = false
  let best = false
  let mp3 = false
  let update = false
  let help = false
  let version = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '-h' || arg === '--help') {
      help = true
    } else if (arg === '-v' || arg === '--version') {
      version = true
    } else if (arg === '-l' || arg === '--list') {
      list = true
    } else if (arg === '-b' || arg === '--best') {
      best = true
    } else if (arg === '-m' || arg === '--mp3') {
      mp3 = true
    } else if (arg === '-U' || arg === '--update-yt-dlp') {
      update = true
    } else if (arg === '-o' || arg === '--output') {
      const next = argv[i + 1]
      if (!next)
        return { outDir, list, best, mp3, update, help, version, error: `missing value for ${arg}` }
      outDir = next
      i++
    } else if (arg.startsWith('-o') && arg.length > 2) {
      outDir = arg.slice(2)
    } else if (arg === '--theme') {
      const next = argv[i + 1]
      if (next !== 'light' && next !== 'dark' && next !== 'auto') {
        return {
          outDir,
          list,
          best,
          mp3,
          update,
          help,
          version,
          error: `--theme must be light, dark or auto`,
        }
      }
      theme = next
      i++
    } else if (arg.startsWith('--theme=')) {
      const value = arg.slice('--theme='.length)
      if (value !== 'light' && value !== 'dark' && value !== 'auto') {
        return {
          outDir,
          list,
          best,
          mp3,
          update,
          help,
          version,
          error: `--theme must be light, dark or auto`,
        }
      }
      theme = value
    } else if (arg === '--') {
      break
    } else if (!arg.startsWith('-')) {
      url = arg
    } else {
      return { outDir, list, best, mp3, update, help, version, error: `unknown option ${arg}` }
    }
  }

  return { url, outDir, theme, list, best, mp3, update, help, version }
}

function path_home(rel: string): string {
  return `${process.env.HOME ?? ''}/${rel}`
}

const args = parseArgs(process.argv.slice(2))

if (args.error) {
  console.error(`yanker: ${args.error}\nTry “yanker --help” for usage.`)
  process.exit(1)
}
if (args.help) {
  console.log(HELP)
  process.exit(0)
}
if (args.version) {
  console.log(VERSION)
  process.exit(0)
}

if (args.list && args.url) {
  const url = args.url
  console.log(`yanker: fetching ${url}…\n`)
  const ytdlp = await ensureYtDlp(() => {})
  const { info } = await probe(ytdlp, url)
  const choices = buildChoices(info, args.outDir)
  console.log(`${info.title}`)
  console.log(
    `${info.uploader ?? ''}${info.duration ? ` · ${formatDuration(info.duration)}` : ''}\n`,
  )

  const rows = choices.map((choice, index) => {
    const size = /~([\d.]+ [KMG]?i?B)/.exec(choice.detail)?.[1] ?? ''
    const kind = choice.kind === 'audio' ? '♪' : '▶'
    const label = choice.label.replace(/\n\s+/g, ' → ')
    return `  [${String(index).padStart(2)}] ${kind} ${label.padEnd(46)} ${size.padStart(9)}`
  })
  console.log(rows.join('\n'))
  console.log(`\n  → ${choices.length} options · run “yanker ${url}” for the interactive picker`)
  process.exit(0)
}

if (args.list && !args.url) {
  console.error('yanker: --list needs a url')
  process.exit(1)
}

const BEST_CHOICE: DownloadChoice = {
  kind: 'video',
  label: 'best quality (auto-merge)',
  detail: '',
  args: ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'],
}

const MP3_CHOICE: DownloadChoice = {
  kind: 'audio',
  label: 'audio only',
  detail: 'mp3',
  args: ['-f', 'ba/b', '-x', '--audio-format', 'mp3'],
}

async function headlessRun(cfg: { url: string; outDir: string; mp3: boolean }): Promise<void> {
  const ytdlp = await ensureYtDlp(() => {})
  const { info, playlist } = await probe(ytdlp, cfg.url, undefined, { flatPlaylist: true })

  let choice: DownloadChoice
  let yesPlaylist = false
  let title = info.title

  if (playlist) {
    yesPlaylist = true
    choice = cfg.mp3 ? MP3_CHOICE : BEST_CHOICE
    title = `${playlist.title} (${playlist.count} videos)`
  } else if (cfg.mp3) {
    const choices = buildChoices(info, cfg.outDir)
    choice = choices.find(c => c.kind === 'audio' && c.label === 'audio only → mp3') ?? MP3_CHOICE
  } else {
    const choices = buildChoices(info, cfg.outDir)
    if (!choices[0]) throw new Error('No downloadable formats found.')
    choice = choices[0]
  }

  console.log(`yanker: grabbing ${title}…`)
  const ffmpegLocation = await findFfmpeg()
  const filepath = await download(
    { ytdlp, ffmpegLocation, url: cfg.url, choice, outDir: cfg.outDir, yesPlaylist },
    { onProgress: () => {}, onProcessing: () => {} },
  )
  console.log(
    `✓ yanked${yesPlaylist ? ' whole playlist' : ''} → ${yesPlaylist ? cfg.outDir : filepath}`,
  )
}

if (args.update) {
  const ytdlp = await ensureYtDlp(() => {})
  console.log(`yanker: updating yt-dlp… (${ytdlp === 'yt-dlp' ? 'system copy' : 'standalone'})`)
  const code = await new Promise<number | null>(resolve => {
    const child = spawn(ytdlp, ['-U'], { stdio: 'inherit' })
    child.on('error', () => resolve(1))
    child.on('close', resolve)
  })
  if ((code ?? 1) !== 0 && ytdlp === 'yt-dlp') {
    console.log(
      'yanker: this yt-dlp is package-managed — update it with your package manager (e.g. pacman -Syu)',
    )
  }
  process.exit((code ?? 1) === 0 ? 0 : 1)
}

if ((args.best || args.mp3 || !process.stdout.isTTY) && args.url) {
  try {
    await headlessRun({ url: args.url, outDir: args.outDir, mp3: args.mp3 })
  } catch (error) {
    console.error(`yanker: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  process.exit(0)
}
if (args.best || args.mp3) {
  console.error('yanker: --best / --mp3 need a url')
  process.exit(1)
}

const isTTY = Boolean(process.stdout.isTTY)

const enterAltScreen = () => process.stdout.write('\x1b[?1049h\x1b[H')
const leaveAltScreen = () => process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?1049l')

if (isTTY) {
  enterAltScreen()
  process.on('exit', leaveAltScreen)
  for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
    process.on(event, (error: unknown) => {
      leaveAltScreen()
      console.error(error)
      process.exit(1)
    })
  }
}

let outcome = ''
const { waitUntilExit } = render(
  <App
    initialUrl={args.url}
    initialThemeMode={args.theme}
    outDir={args.outDir}
    onOutcome={fp => (outcome = fp)}
  />,
)

await waitUntilExit()

if (isTTY) leaveAltScreen()
if (outcome) {
  console.log(`✓ yanked → ${outcome}`)
}
