# Yanker

a better video **Yoinker**.

Stick a URL in a terminal, watch yanker show you _every_ quality the site
offer with estimated sizes and grab the one you want. Paste. pick and yank it.

pull from YouTube, Vimeo, SoundCloud, Instagram, TikTok, X and other sites.

## Why yanker ?

- **Every format, with sizes.** Not just "best guess" you can just choose from the whole list,
  estimated file size included, sorted by quality.

![yanker and its quality](https://raw.githubusercontent.com/dummy3ye/yanker/master/assets/qua.png)

- **Keeps the terminal clean.** Alt-screen in, non-TTY-safe `--list` out.

![non-tty mode](https://raw.githubusercontent.com/dummy3ye/yanker/master/assets/nontty.png)

- **Custor Output Path.** You can just set where you want all you downloaded(output) stuff to go by just <kbd>Ctrl</kbd> + <kbd>O</kbd>

![non-tty mode](https://raw.githubusercontent.com/dummy3ye/yanker/master/assets/outselector.gif)

- **Grab-protected streams.** If a site's CDN pushes back (403 throttling),
  yanker retries with fresh extraction and browser cookies before giving up.

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

```sh
curl https://raw.githubusercontent.com/dummy3ye/yanker/refs/heads/master/install.sh | sh
```

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
| The `auto` theme follows your terminal's own foreground/background, light or |
| dark, without guessing.                                                      |

The interactive TUI requires a TTY. On non-TTY terminals (scripts, ssh
pipes), pass a URL with `--best` / `--mp3` / `--list` for headless output. **look bellow ↓**

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
one with `↑`/`↓`, hit enter, and watch it fly. Files land in `~/Videos`
otherwise, and the saved path is printed when you're finished.

### Cookies (bot-checks & servers)

YouTube starts answering every request with _"Sign in to confirm you're not
a bot"_ the moment it can't see your browser — which is exactly what happens
on a VPS, Docker, or any box without Chrome/Firefox on it. That's what
`--cookies` is for: hand yanker your real logged-in session and the wall
comes down.

> [!WARNING]
> this app auto pulls cookies for youtube from chrome or firefox, if you face trouble, get cookies.txt by using trusted extention or addon and use that

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

## License

[Unlicense](LICENSE)
