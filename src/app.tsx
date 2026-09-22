import React, { useEffect, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { Picker } from './components/picker.js'
import Spinner from 'ink-spinner'
import os from 'node:os'
import path from 'node:path'
import { ProgressBar } from './components/progress-bar.js'
import { FullScreen } from './components/fullscreen.js'
import { Logo } from './components/logo.js'
import { TextInput } from './components/text-input.js'
import {
  formatBytes,
  formatDuration,
  formatEta,
  formatSpeed,
  shortenPath,
  truncate,
} from './lib/format.js'
import { detectClipboardUrl } from './lib/clipboard.js'
import {
  buildChoices,
  download,
  ensureYtDlp,
  findFfmpeg,
  probe,
  type DownloadChoice,
  type DownloadProgress,
  type PlaylistMeta,
  type VideoInfo,
} from './lib/ytdlp.js'
import { getTheme, nextThemeMode, type Theme, type ThemeMode } from './theme.js'
import { getLastRawKey, useRawKeyMonitor } from './lib/keys.js'
import { completePath, resolveOutputPath, saveConfig, shortenForDisplay } from './lib/config.js'
import fs from 'node:fs/promises'

export type AppProps = {
  initialUrl?: string
  initialThemeMode?: ThemeMode
  outDir: string
  /** Netscape-format cookies file (`--cookies`) used for probing + downloads. */
  cookiesFile?: string
  onOutcome: (filepath: string) => void
}

type Phase =
  | { name: 'input' }
  | { name: 'probing'; status: string }
  | { name: 'picking' }
  | { name: 'playlist'; meta: PlaylistMeta }
  | {
      name: 'downloading'
      choice: DownloadChoice
      progress?: DownloadProgress
      processing: boolean
    }
  | { name: 'done'; filepath: string }
  | { name: 'output'; draft: string; error?: string }
  | { name: 'help' }
  | { name: 'error'; message: string }

const PLAYLIST_BEST: DownloadChoice = {
  kind: 'video',
  label: 'best quality (auto-merge)',
  detail: 'whole playlist · merged mp4',
  args: ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'],
}

const PLAYLIST_MP3: DownloadChoice = {
  kind: 'audio',
  label: 'audio only',
  detail: 'whole playlist · mp3',
  args: ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'],
}

const PLAYLIST_ITEMS = [
  { value: 'best' as const, label: '▶ grab all — best quality (merged mp4)' },
  { value: 'mp3' as const, label: '♪ grab all — audio only (mp3)' },
  { value: 'first' as const, label: '▶ first video only — open the format picker' },
]

export function App(props: AppProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(props.initialThemeMode ?? 'auto')
  const [outDir, setOutDir] = useState(props.outDir)
  const [url, setUrl] = useState(props.initialUrl ?? '')
  const [urlInput, setUrlInput] = useState('')
  const [clipboardUrl, setClipboardUrl] = useState<string | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>(
    props.initialUrl ? { name: 'probing', status: 'warming up…' } : { name: 'input' },
  )
  const { exit } = useApp()
  useRawKeyMonitor()
  const abortRef = useRef<AbortController | undefined>(undefined)
  const ytdlpRef = useRef('')
  const infoJsonRef = useRef<string | undefined>(undefined)
  const chooseRef = useRef(0)
  const infoRef = useRef<VideoInfo>({ title: '' })
  const choicesRef = useRef<DownloadChoice[]>([])
  const previousPhaseRef = useRef<Phase | undefined>(undefined)

  const theme = getTheme(themeMode)
  const cycleTheme = () => setThemeMode(m => nextThemeMode(m))

  const openOutput = () => {
    previousPhaseRef.current = phase
    setPhase({ name: 'output', draft: outDir })
  }
  const submitOutput = async (raw: string) => {
    const trimmed = raw.trim() || outDir
    let resolved: string
    try {
      resolved = resolveOutputPath(trimmed)
      await fs.mkdir(resolved, { recursive: true })
    } catch (e) {
      setPhase({ name: 'output', draft: raw, error: e instanceof Error ? e.message : String(e) })
      return
    }
    setOutDir(resolved)
    void saveConfig({ lastOutDir: resolved }).catch(() => {})
    setPhase(previousPhaseRef.current ?? { name: 'input' })
  }
  const completeOutputDraft = (draft: string) => {
    const completed = completePath(draft)
    if (completed !== draft) setPhase({ name: 'output', draft: completed })
  }

  const reset = () => {
    setUrl('')
    setUrlInput('')
    setPhase({ name: 'input' })
  }

  const cancel = () => {
    abortRef.current?.abort()
    reset()
  }

  const startProbe = async (target: string) => {
    const controller = new AbortController()
    abortRef.current = controller
    setPhase({ name: 'probing', status: 'warming up…' })
    try {
      const ytdlp =
        ytdlpRef.current ||
        (await ensureYtDlp(s => setPhase({ name: 'probing', status: s }), controller.signal))
      ytdlpRef.current = ytdlp
      if (controller.signal.aborted) return
      setPhase({ name: 'probing', status: 'fetching video info…' })
      const { info, infoJsonPath, playlist } = await probe(ytdlp, target, controller.signal, {
        flatPlaylist: true,
        cookiesFile: props.cookiesFile,
      })
      if (controller.signal.aborted) return
      infoJsonRef.current = infoJsonPath
      infoRef.current = info
      if (playlist) {
        setPhase({ name: 'playlist', meta: playlist })
        return
      }
      choicesRef.current = buildChoices(info, outDir)
      chooseRef.current = 0
      setPhase({ name: 'picking' })
    } catch (error) {
      if (controller.signal.aborted) return
      setPhase({ name: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  useEffect(() => {
    if (props.initialUrl) void startProbe(props.initialUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePasteFromClipboard = () => {
    void detectClipboardUrl().then(url => {
      if (url) {
        setClipboardUrl(url)
        setUrlInput(url)
      }
    })
  }

  const startDownload = (choice: DownloadChoice, yesPlaylist = false) => {
    const controller = new AbortController()
    abortRef.current = controller
    setPhase({ name: 'downloading', choice, processing: false })

    const handlers = {
      onProgress: (progress: DownloadProgress) =>
        setPhase(prev =>
          prev.name === 'downloading' ? { ...prev, progress, processing: false } : prev,
        ),
      onProcessing: () =>
        setPhase(prev => (prev.name === 'downloading' ? { ...prev, processing: true } : prev)),
    }

    void (async () => {
      try {
        const ffmpegLocation = await findFfmpeg()
        const filepath = await download(
          {
            ytdlp: ytdlpRef.current,
            ffmpegLocation,
            url,
            infoJsonPath: yesPlaylist ? undefined : infoJsonRef.current,
            choice,
            outDir: outDir,
            yesPlaylist,
            cookiesFile: props.cookiesFile,
          },
          handlers,
          controller.signal,
        )
        await new Promise(resolve => setTimeout(resolve, 400))
        const reported = yesPlaylist ? outDir : filepath
        props.onOutcome(reported)
        setPhase({ name: 'done', filepath: reported })
      } catch (error) {
        if (controller.signal.aborted) return
        setPhase({ name: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    })()
  }

  const probeFirstVideo = async (firstUrl?: string) => {
    const controller = new AbortController()
    abortRef.current = controller
    setPhase({ name: 'probing', status: 'fetching first video…' })
    try {
      const { info, infoJsonPath } = await probe(
        ytdlpRef.current,
        firstUrl ?? '',
        controller.signal,
        { cookiesFile: props.cookiesFile },
      )
      if (controller.signal.aborted) return
      setUrl(firstUrl ?? '')
      infoJsonRef.current = infoJsonPath
      infoRef.current = info
      choicesRef.current = buildChoices(info, outDir)
      chooseRef.current = 0
      setPhase({ name: 'picking' })
    } catch (error) {
      if (controller.signal.aborted) return
      setPhase({ name: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const onPlaylistSelect = (meta: PlaylistMeta) => (item: (typeof PLAYLIST_ITEMS)[number]) => {
    if (item.value === 'best') startDownload(PLAYLIST_BEST, true)
    else if (item.value === 'mp3') startDownload(PLAYLIST_MP3, true)
    else void probeFirstVideo(meta.firstUrl)
  }

  useInput(
    (input, key) => {
      if (phase.name === 'output') {
        if (key.escape) {
          setPhase(previousPhaseRef.current ?? { name: 'input' })
          return
        }
        if (key.tab) {
          const draft = (phase as { draft: string }).draft
          completeOutputDraft(draft)
          return
        }
        return
      }
      if (key.ctrl && input === 'o') {
        openOutput()
        return
      }
      if (input === 'o' && phase.name !== 'input' && phase.name !== 'probing' && phase.name !== 'downloading') {
        openOutput()
        return
      }
      if (key.ctrl && input === 't') {
        cycleTheme()
        return
      }
      if (phase.name === 'help') {
        if (key.escape || (key.backspace && getLastRawKey() === '\b')) {
          setPhase(previousPhaseRef.current ?? { name: 'input' })
        }
        return
      }
      if (
        key.backspace &&
        getLastRawKey() === '\b' &&
        phase.name !== 'probing' &&
        phase.name !== 'downloading'
      ) {
        previousPhaseRef.current = phase
        setPhase({ name: 'help' })
        return
      }
      if (
        key.escape &&
        (phase.name === 'picking' || phase.name === 'playlist' || phase.name === 'done')
      )
        reset()
      if (key.escape && (phase.name === 'probing' || phase.name === 'downloading')) cancel()
      if (key.return && phase.name === 'error') reset()
    },
    { isActive: Boolean(process.stdin.isTTY) && (phase.name === 'output' || !['input', 'probing'].includes(phase.name)) },
  )

  const handleUrlSubmit = (value: string) => {
    const trimmed = value.trim()
    setUrl(trimmed)
    void startProbe(trimmed)
  }

  const info = infoRef.current
  const choices = choicesRef.current
  const themeProxy = getTheme(themeMode)

  return (
    <FullScreen>
      <Box flexDirection="column" alignItems="center">
        <Logo themeMode={themeMode} />
        <Text>
          <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
            a better video{' '}
          </Text>
          <Text color="#fbbf24" bold>
            Yoinker
          </Text>
        </Text>
        <Box marginTop={1} />

        {phase.name === 'input' && (
          <>
            <Box
              flexDirection="column"
              alignItems="center"
              borderStyle="round"
              borderColor="#4b5563"
              paddingX={2}
              paddingY={1}
            >
              <Text color={themeProxy.gray}>Paste a link</Text>
              <TextInput
                value={urlInput}
                onChange={v => {
                  setUrlInput(v)
                  if (v !== clipboardUrl) setClipboardUrl(undefined)
                }}
                onSubmit={handleUrlSubmit}
                onEmptyKey={input => {
                  if (input === 'o') openOutput()
                  else exit()
                }}
                onCtrlH={() => {
                  previousPhaseRef.current = phase
                  setPhase({ name: 'help' })
                }}
                onTab={handlePasteFromClipboard}
                onCtrlO={openOutput}
                placeholder="https://youtube.com/watch?v=…"
                width={44}
              />
              {clipboardUrl ? <Text color={themeProxy.primary}>pasted from clipboard</Text> : null}
              <Box marginTop={1}>
                <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                  saving to <Text color={themeProxy.primary}>{shortenForDisplay(outDir)}</Text>
                </Text>
              </Box>
            </Box>
            <Shortcuts
              theme={themeProxy}
              items={
                urlInput === ''
                  ? [
                      ['↵', 'download'],
                      ['⇥', 'paste'],
                      ['^o', 'output'],
                      ['q', 'quit'],
                      ['^h', 'help'],
                    ]
                  : [
                      ['↵', 'download'],
                      ['⇥', 'paste'],
                      ['^o', 'output'],
                      ['^c', 'quit'],
                      ['^h', 'help'],
                    ]
              }
            />
          </>
        )}

        {phase.name === 'probing' && (
          <>
            <Box>
              <Text color={themeProxy.primary}>
                <Spinner type="dots" />
              </Text>
              <Text color={themeProxy.gray}> {phase.status}</Text>
            </Box>
            <Shortcuts
              theme={themeProxy}
              items={[
                ['esc', 'cancel'],
                ['^c', 'quit'],
              ]}
            />
          </>
        )}

        {phase.name === 'playlist' && (
          <>
            <Box width={64}>
              <Box flexDirection="column">
                <Text>
                  <Text color="#fbbf24" bold>
                    ↯{' '}
                  </Text>
                  <Text bold color={themeProxy.primary}>
                    {truncate(phase.meta.title, 56)}
                  </Text>
                </Text>
                <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                  {phase.meta.count} videos
                </Text>
                <Box marginTop={1} />
                <Picker items={PLAYLIST_ITEMS} onSelect={onPlaylistSelect(phase.meta)} limit={3} />
              </Box>
            </Box>
            <Shortcuts
              theme={themeProxy}
              items={[
                ['↑↓', 'choose'],
                ['↵', 'grab'],
                ['^o', 'output'],
                ['esc', 'back'],
                ['^h', 'help'],
                ['^c', 'quit'],
              ]}
            />
          </>
        )}

        {phase.name === 'picking' && (
          <>
            <Box width={Math.min(96, process.stdout.columns > 0 ? process.stdout.columns : 80)}>
              <Box flexDirection="column" flexGrow={0} width={44} paddingRight={2}>
                <Text bold color={themeProxy.primary}>
                  {truncate(info.title, 44)}
                </Text>
                <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                  {formatDuration(info.duration)}
                  {info.uploader ? ` · ${truncate(info.uploader, 30)}` : ''}
                </Text>
                <Box marginTop={1} />
                <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                  {choices.filter(c => c.kind === 'video').length} video ·{' '}
                  {choices.filter(c => c.kind === 'audio').length} audio
                </Text>
                <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                  saving to {shortenForDisplay(outDir)}
                </Text>
                <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                  sizes are estimates from yt-dlp
                </Text>
              </Box>
              <Box width={52} borderStyle="round" borderColor="#4b5563" paddingX={1} paddingY={1}>
                <Picker
                  items={choices.map((choice, index) => ({
                    key: String(index),
                    label: choiceLabel(choice),
                    value: index,
                  }))}
                  onSelect={() => {
                    const choice = choicesRef.current[chooseRef.current]
                    if (choice) startDownload(choice)
                  }}
                  onHighlight={item => (chooseRef.current = item.value)}
                  limit={7}
                />
              </Box>
            </Box>
            <Shortcuts
              theme={themeProxy}
              items={[
                ['↑↓', 'choose'],
                ['↵', 'download'],
                ['^o', 'output'],
                ['esc', 'back'],
                ['^h', 'help'],
                ['^t', 'theme'],
                ['^c', 'quit'],
              ]}
            />
          </>
        )}

        {phase.name === 'downloading' && (
          <>
            <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
              {info.title ? `${truncate(info.title, 40)} · ` : ''}
              {phase.choice.label.replace(/\n\s+/g, ' ')}
            </Text>
            <Box marginTop={1} />
            {phase.processing ? (
              <>
                <ProgressBar percent={1} />
                <Box marginTop={1} />
                <Text>
                  <Text color={themeProxy.primary}>
                    <Spinner type="dots" />
                  </Text>
                  <Text color={themeProxy.gray}> processing…</Text>
                </Text>
              </>
            ) : phase.progress?.totalBytes ? (
              <>
                <ProgressBar percent={phase.progress.downloadedBytes / phase.progress.totalBytes} />
                <Box marginTop={1} />
                <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                  {downloadMeta(phase.progress)}
                </Text>
              </>
            ) : phase.progress ? (
              <>
                <Text>
                  <Text color={themeProxy.primary}>
                    <Spinner type="dots" />
                  </Text>
                  <Text color={themeProxy.gray}>
                    {' '}
                    downloading… {formatBytes(phase.progress.downloadedBytes)}{' '}
                    {formatSpeed(phase.progress.speed)}
                  </Text>
                </Text>
                <Box marginTop={1} />
              </>
            ) : (
              <>
                <ProgressBar percent={0} />
                <Box marginTop={1} />
                <Text>
                  <Text color={themeProxy.primary}>
                    <Spinner type="dots" />
                  </Text>
                  <Text color={themeProxy.gray}> starting download…</Text>
                </Text>
              </>
            )}
            <Shortcuts
              theme={themeProxy}
              items={[
                ['esc', 'cancel'],
                ['^c', 'quit'],
              ]}
            />
          </>
        )}

        {phase.name === 'done' && (
          <>
            <Text>
              <Text bold color="#22c55e">
                ✓ yanked!
              </Text>
            </Text>
            <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
              {shortenPath(phase.filepath, os.homedir(), 60)}
            </Text>
            <Shortcuts
              theme={themeProxy}
              items={[
                ['esc', 'another'],
                ['^o', 'output'],
                ['^h', 'help'],
                ['^c', 'quit'],
              ]}
            />
          </>
        )}

        {phase.name === 'help' && (
          <>
            <Box
              width={76}
              flexDirection="column"
              borderStyle="round"
              borderColor="#4b5563"
              paddingX={2}
              paddingY={1}
            >
              <Text bold color={themeProxy.primary}>
                how to download
              </Text>
              <Box marginTop={1} />
              <Text color={themeProxy.gray}>
                paste a link, pick a format, grab it. files land in{' '}
              </Text>
              <Text color={themeProxy.gray}>
                <Text bold>~/Videos</Text> · <Text bold>-o {'<dir>'}</Text> to change
              </Text>
              <Box marginTop={1} />
              <Box width={64}>
                <Box width={31} flexDirection="column">
                  <Text color={themeProxy.primary}>★ best quality</Text>
                  <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                    best video + audio merged mp4
                  </Text>
                  <Box marginTop={1} />
                  <Text color={themeProxy.primary}>♪ audio only</Text>
                  <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                    highest bitrate audio → mp3
                  </Text>
                  <Box marginTop={1} />
                  <Text color={themeProxy.primary}>▶ resolutions</Text>
                  <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                    every quality, merged w/ best audio
                  </Text>
                </Box>
                <Box width={33} flexDirection="column">
                  <Text color={themeProxy.primary}>playlists</Text>
                  <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                    “grab all” or “first video only”
                  </Text>
                  <Box marginTop={1} />
                  <Text color={themeProxy.primary}>--list</Text>
                  <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                    every format + size, no download
                  </Text>
                  <Box marginTop={1} />
                  <Text color={themeProxy.primary}>--best / --mp3</Text>
                  <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                    skip the picker, grab fast
                  </Text>
                  <Box marginTop={1} />
                  <Text color={themeProxy.primary}>--update-yt-dlp</Text>
                  <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                    keep the standalone binary fresh
                  </Text>
                </Box>
              </Box>
              <Box marginTop={1} />
              <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                sizes are estimates from yt-dlp · powered by yt-dlp + ffmpeg
              </Text>
            </Box>
            <Shortcuts
              theme={themeProxy}
              items={[
                ['esc', 'back'],
                ['^c', 'quit'],
              ]}
            />
          </>
        )}

{phase.name === 'output' && (
          <>
            <Box
              flexDirection="column"
              alignItems="center"
              borderStyle="round"
              borderColor="#4b5563"
              paddingX={2}
              paddingY={1}
              width={64}
            >
              <Text bold color={themeProxy.primary}>output folder</Text>
              <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                where videos will be saved — tab completes, enter saves
              </Text>
              <Box marginTop={1} />
              <TextInput
                value={(phase as { draft: string }).draft}
                onChange={v => setPhase({ name: 'output', draft: v })}
                onSubmit={v => void submitOutput(v)}
                onTab={() => completeOutputDraft((phase as { draft: string }).draft)}
                onCtrlO={() => {}}
                placeholder={outDir}
                width={52}
              />
              {(phase as { error?: string }).error ? (
                <Box marginTop={1}>
                  <Text color="#f87171">{(phase as { error?: string }).error}</Text>
                </Box>
              ) : null}
              <Box marginTop={1}>
                <Text color={themeProxy.gray} dimColor={themeProxy.dim}>
                  current: {shortenForDisplay(outDir)}
                </Text>
              </Box>
            </Box>
            <Shortcuts
              theme={themeProxy}
              items={[
                ['↵', 'save'],
                ['⇥', 'complete'],
                ['esc', 'cancel'],
                ['^c', 'quit'],
              ]}
            />
          </>
        )}

        {phase.name === 'error' && (
          <>
            <Text bold color="#f87171">
              ✗ {phase.message}
            </Text>
            <Shortcuts
              theme={themeProxy}
              items={[
                ['↵', 'try again'],
                ['^c', 'quit'],
              ]}
            />
          </>
        )}
      </Box>
    </FullScreen>
  )
}

const choiceLabel = (choice: DownloadChoice) => {
  const icon = choice.kind === 'audio' ? '♪ ' : '▶ '
  const detail = choice.detail ? `\n        ${choice.detail}` : ''
  return `${icon}${choice.label}${detail}`
}

function downloadMeta(progress: DownloadProgress): string {
  const part = progress.totalParts > 1 ? `part ${progress.part + 1}/${progress.totalParts} · ` : ''
  const speed = progress.speed ? formatSpeed(progress.speed) : ''
  const eta = progress.eta ? `${formatEta(progress.eta)} left` : ''
  return `${part}${speed.padStart(10)}  ${eta.padEnd(12)}${formatBytes(progress.totalBytes)}`
}

function Shortcuts({ items, theme }: { items: Array<[key: string, label: string]>; theme: Theme }) {
  return (
    <Text>
      {items.map(([key, label], index) => (
        <Text key={`${key}-${label}`}>
          {index > 0 ? (
            <Text color={theme.gray} dimColor={theme.dim}>
              {'  ·  '}
            </Text>
          ) : null}
          <Text color={theme.primary}>{key}</Text>
          <Text color={theme.gray} dimColor={theme.dim}>
            {' '}
            {label}
          </Text>
        </Text>
      ))}
    </Text>
  )
}
