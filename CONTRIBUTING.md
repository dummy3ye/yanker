# Contributing to yanker

Thanks for wanting to help! This project is small and personal, so a few
guidelines keep it maintainable. Please read the whole thing (it's short)
before opening an issue or pull request.

- **[Code of Conduct](CODE_OF_CONDUCT.md)** — be decent, or else.
- **[README](README.md)** — what yanker does and how to use it.

## Issues

Before opening an issue:

1. **Search first** — both open and closed issues. Your problem may already
   have an answer.
2. **Use the templates** — there's a form for bugs and one for feature
   requests. Templates are only a skeleton; fill them out completely.

For a bug report, the most useful things you can include are:

- What you ran (the exact command).
- Your terminal emulator and whether you're running in a real TTY, a
  multiplexer (`tmux`/`screen`), or piped output.
- The version of `yanker` (`yanker --version` if available) and Node
  (`node --version`).
- Any error output, verbatim.
- What you expected vs. what happened.

## Development setup

Prerequisites: **Node 22+** and npm.

```sh
npm install
npm run dev          # rebuild on change
npm run build        # one-off bundle to dist/
```

Useful scripts:

| Command                | What it does                           |
| ---------------------- | -------------------------------------- |
| `npm run build`        | bundle with tsup to `dist/`            |
| `npm run dev`          | rebuild on change                      |
| `npm run typecheck`    | `tsc --noEmit`                         |
| `npm run lint`         | ESLint                                 |
| `npm run format`       | Prettier (writes fixes)                |
| `npm run format:check` | Prettier (checks only)                 |
| `npm run link`         | build + `npm link` for global `yanker` |
| `npm start`            | run `dist/cli.js`                      |

Try the CLI against a real URL after building — `npm run link`, then
`yanker <url> --list` for a quick smoke test.

## Before you submit

Whatever you change, make sure all of these pass:

```sh
npm run typecheck
npm run lint
npm run format:check
npm run build
```

If you changed behavior, test it manually against at least one of the supported
sites (YouTube is the easy one).

## Commit messages

**Conventional Commits are mandatory.** Releases and the changelog are
generated automatically by `semantic-release` from your commit messages — a
message in the wrong format breaks the release. Format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Common types used here:

| Type       | Meaning                                              | Appears in changelog as |
| ---------- | ---------------------------------------------------- | ----------------------- |
| `feat`     | a new feature                                        | Features                |
| `fix`      | a bug fix                                            | Bug Fixes               |
| `perf`     | a performance improvement                            | Performance             |
| `refactor` | a change that fixes neither a bug nor adds a feature | (not released)          |
| `docs`     | documentation only                                   | (not released)          |
| `style`    | formatting, whitespace, lint                         | (not released)          |
| `chore`    | tooling, deps, CI                                    | (not released)          |

Examples:

```
feat: add --no-color flag for piped output
fix(picker): keep selection when formats are re-sorted
docs: clarify Tab paste behavior in README
```

The CI pipeline (`typecheck`, `lint`, `build`) runs against every push to
`master`/PRs, and a push to `master` triggers a release — so land changes via
a pull request, not direct pushes.

## Pull requests

1. Create a branch off `master` with a short descriptive name
   (`fix/windows-paths`, `feat/sponsor-block-skip`).
2. Open a pull request using the template. Fill in the whole thing.
3. Keep PRs focused — one logical change per PR. Bigger features are fine as
   untested WIP PRs, but say so in the description.

## Structure

```
src/
  app.tsx          # top-level Ink app / screen flow
  cli.tsx          # CLI entry point, flags, non-TTY --list mode
  theme.ts         # auto/light/dark palettes
  components/      # Ink components (picker, inputs, spinners, …)
  lib/             # yt-dlp orchestration, format parsing, downloads, sizes
```

When in doubt, mirror the style of the file you're touching.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
