# Yanker

a better video **Yoinker**.

Stick a URL in a terminal, watch yanker show you _every_ quality the site
offer with estimated sizes and grab the one you want. Paste. pick and yank it.

pull from YouTube, Vimeo, SoundCloud, Instagram, TikTok, X and other sites.

![yanker in action](https://raw.githubusercontent.com/dummy3ye/yanker/master/assets/showcase.gif)

## Install

```sh
npm install -g @dummy3ye/yanker
```

Or try it without installing anything:

```sh
npx @dummy3ye/yanker
```

Requires Node 18+. `yt-dlp` and `ffmpeg` on your system, and
yanker bundles/re-fetches its own copies when they're missing:

- `yt-dlp` — used if present, otherwise a standalone build is fetched to
  `~/.yanker/bin` (no Python needed)
- `ffmpeg` — used from your PATH, with `ffmpeg-static` as a bundled fallback
  for merging and mp3 conversion

## Usage

```sh
yanker https://youtu.be/dQw4w9WgXcQ      # straight to the format picker
yanker                                   # prompts for a link (auto-suggests a copied URL)
yanker <url> --list                      # print every format + estimated size
yanker <url> --best                      # grab the best format, no picker
yanker <url> --mp3                       # audio only, straight to mp3
yanker <url> -o ~/clips                  # save somewhere else
yanker --theme light                     # force the light palette
yanker --update-yt-dlp                   # self-update the standalone yt-dlp
```

`yanker` lists **all** available formats: resolution,
codec, container, bitrate and estimated file size, best options first. Pick
one with `↑`/`↓`, hit enter, and watch it fly. Files land in `~/Videos`
otherwise, and the saved path is printed when you're finished.

Playlists are detected automatically — the picker offers "grab all"
(best or mp3) or "first video only" to walk through the format list of
the first entry. Press **Tab** in the URL field to paste whatever is in
your clipboard — if it looks like a link it lands right in the field.

### Keys

| Key     | Action                           |
| ------- | -------------------------------- |
| `↵`     | download / submit                |
| `↑` `↓` | choose a format                  |
| `esc`   | back (or cancel)                 |
| `q`     | quit (when the field is empty)   |
| `^c`    | quit                             |
| `^t`    | cycle theme: auto → light → dark |

The `auto` theme follows your terminal's own foreground/background, light or
dark, without guessing.

## Why yanker

- **Every format, with sizes.** Not just "best guess" you can just choose from the whole list,
  estimated file size included, sorted by quality.
- **Grab-protected streams.** If a site's CDN pushes back (403 throttling),
  yanker retries with fresh extraction and browser cookies before giving up.
- **Keeps the terminal clean.** Alt-screen in, non-TTY-safe `--list` out.

## Development

```sh
npm install
npm run build        # bundle with tsup to dist/
npm run dev          # rebuild on change
npm run typecheck    # tsc --noEmit
npm run link         # rebuild + npm link for global `yanker`
```

Stack: TypeScript, [Ink](https://github.com/vadimdemedes/ink) (React for
terminals), `yt-dlp`, `tsup`.

## A note on fair use

yanker is a personal-archiving tool. Downloading content may violate a
platform's terms of service — only grab what you're allowed to keep, and
support the people who make what you save.

## License

[MIT](LICENSE)
