import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { formatBytes } from './format.js'

const YANKER_DIR = path.join(os.homedir(), '.yanker', 'bin')
const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

function ytDlpAssetName(): string {
  if (process.platform === 'win32') return 'yt-dlp.exe'
  if (process.platform === 'darwin') return 'yt-dlp_macos'
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
}

function commandWorks(cmd: string, args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    let child: ChildProcess
    try {
      child = spawn(cmd, args, { stdio: 'ignore', timeout: 10_000 })
    } catch {
      resolve(false)
      return
    }
    child.on('error', () => resolve(false))
    child.on('close', code => resolve(code === 0))
  })
}

/** System yt-dlp first, then a previously downloaded copy, then fetch the standalone binary. */
export async function ensureYtDlp(
  onStatus: (message: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (await commandWorks('yt-dlp', ['--version'])) return 'yt-dlp'

  const local = path.join(YANKER_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  if (await commandWorks(local, ['--version'])) return local

  onStatus('first run: fetching yt-dlp…')
  await fs.mkdir(YANKER_DIR, { recursive: true })

  const url = `${RELEASE_BASE}/${ytDlpAssetName()}`
  const response = await fetch(url, { signal })
  if (!response.ok || !response.body) {
    throw new Error(`Could not download yt-dlp (${response.status}). Check your connection.`)
  }

  const tmp = `${local}.download`
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tmp), { signal })
  await fs.chmod(tmp, 0o755)
  await fs.rename(tmp, local)
  return local
}

/** System ffmpeg first (return undefined so yt-dlp uses it from PATH), ffmpeg-static as fallback. */
export async function findFfmpeg(): Promise<string | undefined> {
  if (await commandWorks('ffmpeg', ['-version'])) return undefined
  try {
    const mod = await import('ffmpeg-static')
    const ffmpegPath = (mod.default ?? mod) as unknown as string | null
    if (ffmpegPath && (await commandWorks(ffmpegPath, ['-version']))) return ffmpegPath
  } catch {
    // ffmpeg-static not installed or unsupported platform
  }
  return undefined
}

export type VideoInfo = {
  title: string
  uploader?: string
  duration?: number
  view_count?: number
  extractor_key?: string
  formats?: RawFormat[]
  _type?: string
  playlist_count?: number
  entries?: Array<{ id?: string; url?: string; title?: string }>
}

export type PlaylistMeta = {
  title: string
  count: number
  firstUrl?: string
}

export type RawFormat = {
  format_id: string
  ext?: string
  vcodec?: string
  acodec?: string
  height?: number
  width?: number
  fps?: number
  abr?: number
  tbr?: number
  format_note?: string
  resolution?: string
  filesize?: number
  filesize_approx?: number
  protocol?: string
}

function estimatedSize(format: RawFormat, duration: number | undefined): number | undefined {
  const direct = format.filesize ?? format.filesize_approx
  if (direct) return direct
  const tbr = format.tbr ?? format.abr
  if (tbr && duration) return (tbr / 8) * duration
  return undefined
}

export type ProbeResult = {
  info: VideoInfo
  infoJsonPath: string
  playlist?: PlaylistMeta
}

export type ProbeOptions = {
  /** Detect playlists (flat entries) instead of stripping them. */
  flatPlaylist?: boolean
}

export async function probe(
  ytdlp: string,
  url: string,
  signal?: AbortSignal,
  opts?: ProbeOptions,
): Promise<ProbeResult> {
  const args = ['-J', '--no-warnings']
  if (opts?.flatPlaylist) {
    args.push('--flat-playlist')
  } else {
    args.push('--no-playlist')
  }
  args.push(url)
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(ytdlp, args, { signal })
    let out = ''
    let stderr = ''
    child.stdout.on('data', chunk => (out += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(cleanYtDlpError(stderr) || `yt-dlp exited with code ${code}`))
      } else {
        resolve(out)
      }
    })
  })

  let info: VideoInfo
  try {
    info = JSON.parse(stdout) as VideoInfo
  } catch {
    throw new Error('Could not parse video info from yt-dlp.')
  }

  const infoJsonPath = path.join(os.tmpdir(), `yanker-info-${process.pid}-${Date.now()}.json`)
  await fs.writeFile(infoJsonPath, stdout)

  if (info._type === 'playlist') {
    const entries = info.entries ?? []
    const first = entries[0]
    const firstUrl =
      first?.url || (first?.id ? `https://www.youtube.com/watch?v=${first.id}` : undefined)
    return {
      info,
      infoJsonPath,
      playlist: {
        title: info.title ?? 'playlist',
        count: info.playlist_count ?? entries.length,
        firstUrl,
      },
    }
  }

  return { info, infoJsonPath }
}

export type DownloadChoice = {
  label: string
  /** Compact detail shown to the right of the label. */
  detail: string
  kind: 'video' | 'audio'
  args: string[]
}

const isUsable = (f: RawFormat) => f.protocol !== 'mhtml' && f.vcodec !== 'images'
const isVideoOnly = (f: RawFormat) =>
  isUsable(f) && !!f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none')
const isAudioOnly = (f: RawFormat) =>
  isUsable(f) && (!f.vcodec || f.vcodec === 'none') && !!f.acodec && f.acodec !== 'none'
const isCombined = (f: RawFormat) =>
  isUsable(f) && !!f.vcodec && f.vcodec !== 'none' && !!f.acodec && f.acodec !== 'none'

const sortByQual = (a: RawFormat, b: RawFormat) =>
  (b.height ?? 0) - (a.height ?? 0) || (b.tbr ?? b.abr ?? 0) - (a.tbr ?? a.abr ?? 0)

function shortCodec(f: RawFormat): string {
  if (f.vcodec && f.vcodec !== 'none') return String(f.vcodec).split('.')[0] ?? '?'
  if (f.acodec && f.acodec !== 'none') return String(f.acodec).split('.')[0] ?? '?'
  return '-'
}

/**
 * Builds a download menu with EVERY available format — combined streams,
 * every video stream (merged with the best audio), and every audio stream —
 * each with an estimated size.
 */
export function buildChoices(info: VideoInfo, outDir?: string): DownloadChoice[] {
  const formats = (info.formats ?? []).filter(isUsable)
  const duration = info.duration
  const audioOnly = formats
    .filter(isAudioOnly)
    .sort((a, b) => (b.tbr ?? b.abr ?? 0) - (a.tbr ?? a.abr ?? 0))
  const bestAudio = audioOnly[0]
  const bestVideo = formats.filter(isVideoOnly).sort(sortByQual)[0]

  const mergedSize = (video: RawFormat, audio: RawFormat | undefined): number | undefined => {
    const v = estimatedSize(video, duration)
    const a = audio ? estimatedSize(audio, duration) : 0
    if (v) return v + (a ?? 0)
    return a || undefined
  }
  const sizeLabel = (size: number | undefined) => (size ? ` · ~${formatBytes(size)}` : '')

  const choices: DownloadChoice[] = []

  // automatic best
  if (bestVideo || bestAudio) {
    const size = bestVideo ? mergedSize(bestVideo, bestAudio) : estimatedSize(bestAudio!, duration)
    choices.push({
      kind: 'video',
      detail: `best available${sizeLabel(size)}`,
      label: `★ best quality (auto-merge)`,
      args: ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'],
    })
  }

  if (bestAudio) {
    const size = estimatedSize(bestAudio, duration)
    choices.push({
      kind: 'audio',
      detail: `best audio · mp3${sizeLabel(size)}`,
      label: `audio only → mp3`,
      args: ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'],
    })
  }

  const combined = formats.filter(isCombined).sort(sortByQual)

  const videos = formats.filter(isVideoOnly).sort(sortByQual)
  for (const f of videos) {
    const size = mergedSize(f, bestAudio)
    const hz = f.height ? `${f.height}p` : f.resolution
    const ext = f.ext ? ` · ${f.ext}` : ''
    const codec = shortCodec(f)
    const fps = f.fps ? ` · ${f.fps}fps` : ''
    const format = bestAudio ? `${f.format_id}+${bestAudio.format_id}` : f.format_id
    choices.push({
      kind: 'video',
      detail: `merged mp4${sizeLabel(size)}`,
      label: `${hz}${ext} · ${codec}${fps}`,
      args: ['-f', format, '--merge-output-format', 'mp4'],
    })
  }

  for (const f of combined) {
    const size = estimatedSize(f, duration)
    const hz = f.height ? `${f.height}p` : f.resolution === 'audio only' ? 'audio' : f.resolution
    const ext = f.ext ? ` · ${f.ext}` : ''
    const codec = shortCodec(f)
    const fps = f.fps ? ` · ${f.fps}fps` : ''
    choices.push({
      kind: 'video',
      detail: `already muxed${sizeLabel(size)}`,
      label: `${hz}${ext} · ${codec}${fps}`,
      args: ['-f', f.format_id],
    })
  }

  for (const f of audioOnly) {
    const size = estimatedSize(f, duration)
    const abr = f.abr ? ` · ${Math.round(f.abr)}k` : f.tbr ? ` · ${Math.round(f.tbr)}k` : ''
    const codec = shortCodec(f)
    choices.push({
      kind: 'audio',
      detail: `audio stream${sizeLabel(size)}`,
      label: `${codec}${abr}${f.ext ? ` · ${f.ext}` : ''}`,
      args: ['-f', f.format_id],
    })
  }

  return choices
}

/** True when passing cookies from the named browser (returns false if it's not installed). */
async function browserHasCookies(name: 'chrome' | 'firefox'): Promise<boolean> {
  const dir = name === 'chrome' ? 'google-chrome' : 'firefox'
  try {
    await fs.access(path.join(os.homedir(), '.config', dir))
    return true
  } catch {
    return false
  }
}

export type DownloadProgress = {
  downloadedBytes: number
  totalBytes?: number
  speed?: number
  eta?: number
  part: number
  totalParts: number
}

export type DownloadHandlers = {
  onProgress: (progress: DownloadProgress) => void
  onProcessing: () => void
}

const PROGRESS_PREFIX = 'YANK|'
const PROGRESS_TEMPLATE = `${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`

let activeChild: ChildProcess | undefined
process.on('exit', () => activeChild?.kill('SIGTERM'))

function resolveFfmpeg(ffmpegLocation: string | undefined): string[] {
  return ffmpegLocation ? ['--ffmpeg-location', ffmpegLocation] : []
}

function playlistFlag(opt: { yesPlaylist?: boolean }): string[] {
  return opt.yesPlaylist ? ['--yes-playlist'] : ['--no-playlist']
}

/**
 * Runs yt-dlp, streaming progress. If the stream is blocked (HTTP 403 —
 * common on throttled CGNAT/shared IPs), it retries with baked-in
 * `--cookies-from-browser` so an authenticated session gets the streams
 * through. Returns the final downloaded filepath.
 */
export function download(
  opts: {
    ytdlp: string
    ffmpegLocation?: string
    url: string
    infoJsonPath?: string
    choice: DownloadChoice
    outDir: string
    /** Download the whole playlist instead of a single video. */
    yesPlaylist?: boolean
  },
  handlers: DownloadHandlers,
  signal?: AbortSignal,
): Promise<string> {
  const attempts: Array<{ infoJson?: string; choice: DownloadChoice }> = [
    { infoJson: opts.infoJsonPath, choice: opts.choice },
    { choice: opts.choice },
  ]
  if (opts.ffmpegLocation === undefined) {
    // merge-capable config exists on disk, but yt-dlp may already have used the
    // probed URLs — a fresh extraction with cookies is the strongest retry
  }

  async function runAttempt(index: number): Promise<string> {
    const attempt = attempts[index]
    const args = [
      ...(attempt.infoJson ? ['--load-info-json', attempt.infoJson] : [opts.url]),
      ...playlistFlag(opts),
      ...attempt.choice.args,
      '--no-warnings',
      '--newline',
      '--no-quiet',
      '--progress',
      '--progress-template',
      `download:${PROGRESS_TEMPLATE}`,
      '--print',
      'after_move:filepath',
      '--no-simulate',
      ...resolveFfmpeg(opts.ffmpegLocation),
      '-o',
      path.join(opts.outDir, '%(title).90s.%(ext)s'),
    ]

    const result = await new Promise<{ filepath?: string; error?: string }>(resolvePromise => {
      const child = spawn(opts.ytdlp, args, { signal })
      activeChild = child

      let stderr = ''
      let filepath = ''
      let part = 0
      let totalParts = 1
      let lastDownloaded = 0
      let buffer = ''
      const destinations: string[] = []

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line) continue
          if (line.startsWith(PROGRESS_PREFIX)) {
            const [downloaded, total, totalEstimate, speed, eta] = line
              .slice(PROGRESS_PREFIX.length)
              .split('|')
            const downloadedBytes = toNumber(downloaded) ?? 0
            if (downloadedBytes < lastDownloaded) part++
            lastDownloaded = downloadedBytes
            handlers.onProgress({
              downloadedBytes,
              totalBytes: toNumber(total) ?? toNumber(totalEstimate),
              speed: toNumber(speed),
              eta: toNumber(eta),
              part,
              totalParts,
            })
          } else if (line.includes('Downloading 1 format(s):')) {
            totalParts = (line.split('format(s):')[1] ?? '').trim().split('+').length
          } else if (line.startsWith('[download] Destination: ')) {
            destinations.push(line.slice('[download] Destination: '.length))
          } else if (line.includes('[Merger]') || line.includes('[ExtractAudio]')) {
            const merging = /^\[Merger\] Merging formats into "(.+)"$/.exec(line)?.[1]
            const extracting = /^\[ExtractAudio\] Destination: (.+)$/.exec(line)?.[1]
            if (merging ?? extracting) destinations.push((merging ?? extracting)!)
            if (extracting) filepath = extracting
            else if (merging) filepath = merging
            handlers.onProcessing()
          } else if (path.isAbsolute(line) && !line.startsWith('/tmp/')) {
            filepath = line
          }
        }
      })
      child.stderr.on('data', chunk => (stderr += chunk))
      child.on('error', reject_resolve)
      child.on('close', code => {
        activeChild = undefined
        if (signal?.aborted) {
          void removePartials(destinations)
          reject_resolve(new Error('Download cancelled.'))
          return
        }
        if (code === 0 && filepath) {
          resolvePromise({ filepath })
        } else {
          resolvePromise({ error: cleanYtDlpError(stderr) || `yt-dlp exited with code ${code}` })
        }
      })

      function reject_resolve(error: Error) {
        resolvePromise({ error: error.message })
      }
    })

    if (result.filepath) return result.filepath

    // a transient block? only worth the cookies retry when it smells like one
    const text = result.error ?? ''
    const looksBlocked = /403|Forbidden|Requested format is not available/i.test(text)
    if (!looksBlocked) throw new Error(text)

    if (index === 0) {
      for (const browser of ['chrome', 'firefox'] as const) {
        if (!(await browserHasCookies(browser))) continue
        const withCookies: Array<{ infoJson?: string; choice: DownloadChoice }> = [
          { infoJson: opts.infoJsonPath, choice: opts.choice },
          { choice: opts.choice },
        ].map(a => ({
          ...a,
          args: ['--cookies-from-browser', browser, ...a.choice.args],
        }))
        attempts.splice(1, 0, ...withCookies)
      }
    }

    if (index < attempts.length - 1) return runAttempt(index + 1)

    // nothing worked — last resort: same choice, but with chrome cookies forced
    const fallback: DownloadChoice = {
      ...opts.choice,
      args: ['--cookies-from-browser', 'chrome', ...opts.choice.args],
    }
    const { filepath: fp, error } = await until_chrome_fallback(opts, fallback, handlers, signal)
    if (fp) return fp
    throw new Error((error ?? '') + (text ? `\n${text}` : ''))
  }

  return runAttempt(0)
}

async function until_chrome_fallback(
  opts: DownloadOpts,
  choice: DownloadChoice,
  handlers: DownloadHandlers,
  signal?: AbortSignal,
): Promise<{ filepath?: string; error?: string }> {
  if (!(await browserHasCookies('chrome'))) {
    return { error: 'Download failed — YouTube is blocking this connection.' }
  }
  const args = [
    opts.url,
    ...playlistFlag(opts),
    ...choice.args,
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '--no-quiet',
    '--progress',
    '--progress-template',
    `download:${PROGRESS_TEMPLATE}`,
    '--print',
    'after_move:filepath',
    '--no-simulate',
    ...resolveFfmpeg(opts.ffmpegLocation),
    '-o',
    path.join(opts.outDir, '%(title).90s.%(ext)s'),
  ]
  return new Promise(resolve => {
    const child = spawn(opts.ytdlp, args, { signal })
    activeChild = child
    let stderr = ''
    let filepath = ''
    child.stdout.on('data', chunk => (filepath += chunk.toString()))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', e => resolve({ error: e.message }))
    child.on('close', code => {
      activeChild = undefined
      if (code === 0)
        resolve({
          filepath: filepath
            .split('\n')
            .map(l => l.trim())
            .find(p => path.isAbsolute(p)),
        })
      else resolve({ error: cleanYtDlpError(stderr) || `yt-dlp exited with code ${code}` })
    })
  })
}

type DownloadOpts = Parameters<typeof download>[0]

function removePartials(destinations: string[]): Promise<unknown> {
  return Promise.allSettled(
    destinations
      .flatMap(dest => [dest, `${dest}.part`, `${dest}.ytdl`])
      .map(file => fs.rm(file, { force: true })),
  )
}

function toNumber(value: string | undefined): number | undefined {
  if (!value || value === 'NA' || value === 'None') return undefined
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : undefined
}

export function cleanYtDlpError(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('ERROR:'))
  const last = lines.at(-1)
  return last ? last.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '') : ''
}
