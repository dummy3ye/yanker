# Yanker

a better video **Yoinker**.

Stick a URL in a terminal, watch yanker show you _every_ quality the site
offers, with estimated sizes and grab the one you want. Paste. pick and yank it.

pull from YouTube, Vimeo, SoundCloud, Instagram, TikTok, X and other sites.

## Why yanker ?

- **Every format, with sizes.** Not just "best guess" you can just choose from the whole list,
  estimated file size included, sorted by quality.

![yanker and its quality](https://raw.githubusercontent.com/dummy3ye/yanker/master/assets/qua.png)

- **Keeps the terminal clean.** Alt-screen in, non-TTY-safe `--list` out.

![non-tty mode](https://raw.githubusercontent.com/dummy3ye/yanker/master/assets/nontty.png)

- **Custom output path.** Pick exactly where your downloads land with <kbd>Ctrl</kbd> + <kbd>O</kbd>.

![non-tty mode](https://raw.githubusercontent.com/dummy3ye/yanker/master/assets/outselector.gif)

- **Grab-protected streams.** If a site's CDN pushes back (403 throttling),
  yanker retries with fresh extraction and browser cookies before giving up.

## Troubleshooting

**`yanker` says yt-dlp is missing.** Install it, or let yanker fetch the
standalone build for you with `yanker --update-yt-dlp`.

**Downloads fail with a 403.** The CDN is challenging the request — retry,
or pass `--cookies cookies.txt` (see the cookies section below).

yanker re-extracts the stream with fresh browser cookies before it gives up.
That retry is bounded, so a persistently hostile CDN fails after a handful of
attempts rather than hanging — if you are scripting around a known-bad host,
prefer `--cookies` over relying on the retry.

**Nothing appears on a non-TTY terminal.** The interactive picker needs a TTY;
use `--list` or `--best` when scripting over ssh.

## How it fits together

- `src/cli.tsx` — argument parsing and the headless paths (`--list`, `--best`, `--mp3`)
- `src/app.tsx` — the interactive picker
- `src/lib/ytdlp.ts` — format probing, download, and cookie retry
- `src/lib/format.ts` — byte/duration formatting shared by both UIs
- `src/lib/config.ts` — the remembered output directory
- `src/lib/clipboard.ts` — paste and copy, with a bounded probe
- `src/theme.ts` — the three themes and terminal detection

## Themes

`--theme light` / `--theme dark` / `--theme auto` (the default). `ctrl+t` cycles
the three in the picker.

Auto-detection reads `COLORFGBG` when the terminal exports it. When it does
not, auto picks dark unless `COLORTERM=truecolor` says otherwise. If your
terminal has a light background but exports a truecolor `COLORTERM`, set
`YANKER_THEME=light` to force it.

## Configuration

yanker remembers where you last saved downloads. State lives in
`~/.yanker/config.json`:

```json
{
  "lastOutDir": "~/Videos"
}
```

That file is yours to edit or delete — removing it just resets the memory.
`YANKER_OUT` overrides it for a single run, and `-o` overrides both.

A remembered directory that has since been deleted or unmounted is ignored, so
yanker falls back to your default rather than failing the download.

## Requirements

- **Node.js ≥ 22**
- **yt-dlp** — _optional_.
- **ffmpeg** — _optional_.
  `ffmpeg-static` as a bundled fallback for merging and mp3 conversion
- **Clipboard paste** — _optional_, only for Tab-paste in the URL field:
  Linux needs `wl-paste` (Wayland) or `xclip`/`xsel` (X11), macOS uses
  `pbpaste`, Windows uses PowerShell `Get-Clipboard`.

## Installation

```sh
npm install -g @dummy3ye/yanker
```

Or try it without installing anything:

```sh
npx @dummy3ye/yanker
```

or you can just run the cool installer by:
</br>_(it looks better if you have gum by charm.sh installed)_

```sh
curl https://raw.githubusercontent.com/dummy3ye/yanker/refs/heads/master/install.sh | sh
```

Piping a script straight into a shell is convenient but means you are running
code you have not read. If you would rather look first:

```sh
curl -fsSL https://raw.githubusercontent.com/dummy3ye/yanker/refs/heads/master/install.sh -o install.sh
less install.sh
sh install.sh
```

`npx @dummy3ye/yanker` sidesteps the question entirely.

### Navigation (inside tui mode)

| Key                                                                          | Action                           |
| ---------------------------------------------------------------------------- | -------------------------------- |
| `↵`                                                                          | download / submit                |
| `↑` `↓`                                                                      | choose a format                  |
| `esc`                                                                        | back (or cancel)                 |
| `q`                                                                          | quit (when the field is empty)   |
| `^c`                                                                         | quit                             |
| `^t`                                                                         | cycle theme: auto → light → dark |
| `Ctrl+o`                                                                     | open output dir                  |
| `Tab`                                                                       | paste from clipboard             |
| `Ctrl+u`                                                                     | clear the url field              |
| The `auto` theme follows your terminal's own foreground/background, light or |
| dark, without guessing.                                                      |

The interactive TUI requires a TTY. On non-TTY terminals (scripts, ssh
pipes), pass a URL with `--best` / `--mp3` / `--list` for headless output.
**see below ↓**

Over ssh or in CI, `--list` is the safest bet: it prints every format with
its estimated size and exits, so it composes with `grep`/`head` instead of
waiting on a picker that can never be answered.

## cli usage

```sh
yanker https://youtu.be/dQw4w9WgXcQ      # straight to the format picker
yanker                                   # prompts for a link (auto-suggests a copied URL)
yanker <url> --list                      # print every format + estimated size
yanker <url> --best                      # grab the best format, no picker
yanker <url> --mp3                       # audio only, straight to mp3
yanker <url> -o ~/clips                  # save somewhere else
yanker <url> --cookies cookies.txt       # use exported browser cookies (see below)
yanker --theme light                     # force the light palette
yanker --update-yt-dlp                   # self-update the standalone yt-dlp
```

`yanker` lists **all** available formats: resolution,
codec, container, bitrate and estimated file size, best options first. Pick
one with `↑`/`↓`, hit enter, and watch it fly. Files land in `~/Videos` by
default, and the saved path is printed when you're finished.

Sizes in the list are **estimates** derived from each format's reported
bitrate and duration, so treat them as a guide rather than an exact figure —
the real size depends on the container the site serves.

### Shell completion

`yanker` has no completion script yet, but the common invocations are short
enough to alias:

```sh
alias yl='yanker --list'
alias yb='yanker --best'
```

### Cookies (bot-checks & servers)

YouTube starts answering every request with _"Sign in to confirm you're not
a bot"_ the moment it can't see your browser — which is exactly what happens
on a VPS, Docker, or any box without Chrome/Firefox on it. That's what
`--cookies` is for: hand yanker your real logged-in session and the wall
comes down.

> [!WARNING]
> this app automatically pulls cookies for YouTube from Chrome or Firefox. If you hit trouble, export a `cookies.txt` with a trusted extension or addon and use that

**Get the cookies.** In the browser you actually use for YouTube, export
them to a Netscape-format file — Chrome: _Get cookies.txt LOCALLY_
extension; Firefox: _cookies.txt_ extension. Move it over, then:

```sh
scp cookies.txt root@your-vps:/root/

yanker <url> --cookies /root/cookies.txt   # one-off
yanker --cookies /root/cookies.txt         # or set it once and use the picker
```

The cookies go to work **both** while fetching video info and while
downloading. When a file is given, it's the only cookie source — yanker
skips its automatic browser-cookie fallbacks and trusts the file.

Treat it like a password, because it is one: the file is a full login
session. Keep it private, and re-export it whenever YouTube expires the
session and the bot wall comes back.

Playlists are detected automatically — the picker offers "grab all"
(best or mp3) or "first video only" to walk through the format list of
the first entry. Press **Tab** in the URL field to paste whatever is in
your clipboard — if it looks like a link it lands right in the field.

## Development

```sh
nvm use                # switch to the pinned Node version (see .nvmrc)
npm install
npm run build          # bundle with tsup to dist/
npm run dev            # rebuild on change
npm run typecheck      # tsc --noEmit
npm run link           # rebuild + npm link for global `yanker`
npm run unlink yanker  # to unlink the global command
```

Stack: TypeScript, [Ink](https://github.com/vadimdemedes/ink) (React for
terminals), `yt-dlp`, `tsup` `ffmpeg`.

## A note on fair use

yanker is a personal-archiving tool. Downloading content may violate a
platform's terms of service — only grab what you're allowed to keep, and
support the people who make what you save.

## What cookies do and do not fix

`--cookies` sends your browser's cookies to yt-dlp. That resolves the cases
where the CDN challenges a request it would otherwise serve: age-gated videos,
members-only uploads, and anything bound to a signed-in session.

It does not help with region blocks (pass `--geo-bypass-country` for those) and
it does not bypass a takedown. If a video plays in your browser and fails in
yanker, cookies are almost always the fix.

The file is read by yt-dlp and never sent anywhere else. Netscape format, which
is what every browser extension exports.

## Ordering

`--list` and the interactive picker both read the same format table, but they do
not always present it in the same order. `--list` prints in yt-dlp's own order;
the picker sorts by height, then bitrate, then frame rate. Ties are resolved
deterministically, so the picker's order is stable run to run — just not
necessarily the same as `--list`.

Pick by the label (`1080p · avc1 · 60fps`), not by row number.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | success |
| `1` | bad usage — unknown flag, or a url yanker could not parse |
| `2` | the download itself failed (network, CDN, disk) |

Scripts can therefore distinguish "you asked for something impossible" from
"the fetch broke", without scraping stderr.

**A size looks far too small.** Sizes are estimated from the bitrate whenever
yt-dlp does not report an exact `filesize`, which is most of the time. The
estimate assumes a constant bitrate, so VBR encodes read high. Where an exact
figure exists it is used instead.

**A format shows no size at all.** The stream has no reported bitrate, or the
video has no duration (a live stream still running). Nothing can be estimated
in that case, so the label is blank rather than `0 B`.

## Finding a format id by hand

```sh
yanker --list 'https://youtu.be/VIDEO' | grep '1080p'
```

Then hand the id straight to yt-dlp when you want something the picker does not
offer:

```sh
yt-dlp -f 137+140 --merge-output-format mp4 'https://youtu.be/VIDEO'
```

## Support

If this saved you some time, an issue describing what you were trying to do is
worth more than a star — it says what is still missing.

## License

[Unlicense](LICENSE)
