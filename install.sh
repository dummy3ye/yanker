#!/usr/bin/env bash
# yanker installer — preflight check + interactive global install/update.
#
# Usage:
#   ./install.sh                 # check tools, then pick what to install/update
#   ./install.sh --check         # only print the status table, no changes
#   ./install.sh --yes           # non-interactive: install/update everything missing
#   ./install.sh --dry-run       # print what would run, change nothing
#   ./install.sh --pm yay        # force a package manager (see list below)
#   ./install.sh --help          # this help
#
# Nothing is installed without asking first (unless --yes is given).
# System packages use your native package manager and may prompt for sudo.
# Supported: paru, yay, pacman, apt, dnf, yum, zypper, apk, emerge,
#            nix-env, snap, brew, winget, flatpak (see note), or a manual
#            fallback when none of those fit.
# NOTE on flatpak: it ships desktop apps, not CLI tools — it cannot provide
# `yt-dlp`/`ffmpeg` on PATH, so when flatpak is all there is, the script
# falls back to a standalone yt-dlp binary and the bundled ffmpeg-static.
# Node itself is never auto-upgraded — the script prints how to do that
# manually when needed.
set -euo pipefail

PKG_NAME="@dummy3ye/yanker"
BIN_NAME="yanker"
REQUIRED_NODE_MAJOR=22
STANDALONE_YTDLP="$HOME/.yanker/bin/yt-dlp"
LOCAL_BIN="$HOME/.local/bin"

NONINTERACTIVE=0
CHECK_ONLY=0
DRY_RUN=0
PM_OVERRIDE=""

usage() {
  sed -n '2,20p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) NONINTERACTIVE=1; shift ;;
    --check|-c) CHECK_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --pm) PM_OVERRIDE="${2:-}"; shift 2 ;;
    --pm=*) PM_OVERRIDE="${1#--pm=}"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

# ---------- helpers ----------

have() { command -v "$1" >/dev/null 2>&1; }

# print $1 in green/red
ok()   { printf '\e[32m%s\e[0m' "$1"; }
bad()  { printf '\e[31m%s\e[0m' "$1"; }
dim()  { printf '\e[2m%s\e[0m' "$1"; }

confirm() {
  # confirm "prompt" — arrow-key Yes/No picker. Auto-yes with --yes.
  # Returns 0 on Yes, 1 on No/quit.
  if [[ "$NONINTERACTIVE" -eq 1 ]]; then return 0; fi
  arrow_menu "$1" "Yes" "No" || return 1
  [[ "$PICK" == "0" ]]
}

cursor_hide() { tput civis 2>/dev/null || printf '\e[?25l'; }
cursor_show() { tput cnorm 2>/dev/null || printf '\e[?25h'; }

PICK=-1 # index chosen by arrow_menu, -1 = quit/cancelled

arrow_menu() {
  # arrow_menu "prompt" opt1 opt2 ... — full-screen-less arrow picker.
  # ↑/↓ or j/k move, Enter selects, 1-9 jumps, q/Esc quits.
  # Sets PICK (0-based), returns 0 on selection, 1 on quit.
  local prompt="$1"; shift
  local -a opts=("$@")
  local n=$# cur=0 i key rest
  PICK=-1
  cursor_hide
  while true; do
    printf '%s\n' "$prompt"
    for i in "${!opts[@]}"; do
      if (( i == cur )); then
        printf '  \e[7m▸ %s\e[0m\n' "${opts[$i]}"
      else
        printf '    %s\n' "${opts[$i]}"
      fi
    done
    IFS= read -rsn1 key || { cursor_show; return 1; }
    # move cursor back up over the menu before redrawing
    printf '\e[%dA' "$((n + 1))"
    if [[ "$key" == $'\e' ]]; then
      rest=""
      IFS= read -rsn2 -t 0.5 rest || true
      case "$rest" in
        "[A"|"OA") cur=$(( (cur - 1 + n) % n )) ;;
        "[B"|"OB") cur=$(( (cur + 1) % n )) ;;
        "") cursor_show; return 1 ;; # Esc alone = quit
      esac
    elif [[ -z "$key" ]]; then # Enter
      PICK=$cur; cursor_show; return 0
    elif [[ "$key" == "q" || "$key" == "Q" ]]; then
      cursor_show; return 1
    elif [[ "$key" == "j" ]]; then
      cur=$(( (cur + 1) % n ))
    elif [[ "$key" == "k" ]]; then
      cur=$(( (cur - 1 + n) % n ))
    elif [[ "$key" =~ ^[1-9]$ ]] && (( 10#$key <= n )); then
      PICK=$((10#$key - 1)); cursor_show; return 0
    fi
    # clear the old menu lines before redrawing
    for ((i = 0; i <= n; i++)); do printf '\e[K\n'; done
    printf '\e[%dA' "$((n + 1))"
  done
}

run_sudo_if_needed() {
  # run_sudo_if_needed cmd... — prefix sudo when not root and sudo exists.
  # With --dry-run, just print the command.
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "$(dim "[dry-run]") $*"
    return 0
  fi
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  elif have sudo; then
    sudo "$@"
  else
    "$@" # may fail with permission error; let the user see it
  fi
}

# ---------- package managers ----------

# All managers we know, in preference order. AUR helpers come before pacman
# because they cover the official repos too (plus the AUR when needed).
# NOTE: paru/yay must never run as root — they re-escalate internally.
PM_CANDIDATES=(paru yay pacman apt-get dnf yum zypper apk emerge nix-env snap brew winget flatpak)

detect_pms() {
  # echo every supported manager present on PATH, in preference order
  local c bin found=()
  for c in "${PM_CANDIDATES[@]}"; do
    bin="$c"; [[ "$c" == "apt-get" ]] && bin="apt-get"
    if have "$bin"; then
      [[ "$c" == "apt-get" ]] && found+=(apt) || found+=("$c")
    fi
  done
  echo "${found[@]}"
}

PM_LIST="$(detect_pms)"
PM="${PM_LIST%% *}" # best available, may be empty
if [[ -n "$PM_OVERRIDE" ]]; then
  if [[ " $PM_LIST " == *" $PM_OVERRIDE "* ]]; then
    PM="$PM_OVERRIDE"
  else
    echo "error: --pm $PM_OVERRIDE not found (available: ${PM_LIST:-none})" >&2
    exit 1
  fi
fi
[[ -z "$PM" ]] && PM="none"

OS_LABEL="$(uname -s)"
if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  OS_LABEL="$(source /etc/os-release && echo "${PRETTY_NAME:-$NAME} ($(uname -m))")"
fi

# ---------- detection (globals set by check_all) ----------

NODE_STATUS="";  NODE_VER="";  NODE_MAJOR=0
NPM_STATUS="";   NPM_VER=""
YANKER_STATUS=""; YANKER_VER=""
YTDLP_STATUS=""; YTDLP_VER=""; YTDLP_WHERE=""
FFMPEG_STATUS=""; FFMPEG_VER=""
CLIP_STATUS="";  CLIP_WITH=""

check_all() {
  # node
  if have node; then
    NODE_VER="$(node --version 2>/dev/null || echo "?")"
    NODE_MAJOR="${NODE_VER#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
    if [[ "${NODE_MAJOR:-0}" =~ ^[0-9]+$ ]] && (( NODE_MAJOR >= REQUIRED_NODE_MAJOR )); then
      NODE_STATUS="ok"
    else
      NODE_STATUS="old"
    fi
  else
    NODE_STATUS="missing"; NODE_VER="—"
  fi

  # npm
  if have npm; then NPM_STATUS="ok"; NPM_VER="$(npm --version 2>/dev/null || echo "?")"
  else NPM_STATUS="missing"; NPM_VER="—"; fi

  # yanker (PATH binary, plus global npm record)
  if have "$BIN_NAME"; then
    YANKER_STATUS="ok"
    YANKER_VER="$("$BIN_NAME" --version 2>/dev/null || echo "?")"
  elif have npm && npm ls -g --depth=0 2>/dev/null | grep -q "$PKG_NAME"; then
    YANKER_STATUS="ok"
    YANKER_VER="(global pkg, bin not on PATH)"
  else
    YANKER_STATUS="missing"; YANKER_VER="—"
  fi

  # yt-dlp: system PATH first, then yanker's standalone fallback
  if have yt-dlp; then
    YTDLP_STATUS="ok"
    YTDLP_VER="$(yt-dlp --version 2>/dev/null | head -n1 || echo "?")"
    YTDLP_WHERE="system ($(command -v yt-dlp))"
  elif [[ -x "$STANDALONE_YTDLP" ]]; then
    YTDLP_STATUS="ok"
    YTDLP_VER="$("$STANDALONE_YTDLP" --version 2>/dev/null | head -n1 || echo "?")"
    YTDLP_WHERE="standalone ($STANDALONE_YTDLP)"
  else
    YTDLP_STATUS="missing"; YTDLP_VER="—"; YTDLP_WHERE="yanker auto-fetches on first run"
  fi

  # ffmpeg (system; npm's ffmpeg-static is a silent fallback at runtime)
  if have ffmpeg; then
    FFMPEG_STATUS="ok"
    FFMPEG_VER="$(ffmpeg -version 2>/dev/null | head -n1 | awk '{print $3}' || echo "?")"
  else
    FFMPEG_STATUS="missing"; FFMPEG_VER="— (ffmpeg-static fallback applies)"
  fi

  # clipboard helper (paste-on-Tab / auto-suggest needs one of these)
  CLIP_WITH=""
  case "$(uname -s)" in
    Darwin) have pbpaste && CLIP_WITH="pbpaste (built-in)" ;;
    MINGW*|MSYS*|CYGWIN*) CLIP_WITH="Get-Clipboard (built-in)" ;;
    *)
      for c in wl-paste xclip xsel; do
        if have "$c"; then CLIP_WITH="$c"; break; fi
      done
      ;;
  esac
  if [[ -n "$CLIP_WITH" ]]; then CLIP_STATUS="ok"; else CLIP_STATUS="missing"; CLIP_WITH="—"; fi
}

status_cell() {
  case "$1" in
    ok) ok "OK" ;;
    old) bad "TOO OLD" ;;
    *) bad "MISSING" ;;
  esac
}

print_status() {
  echo
  echo "yanker preflight — $OS_LABEL | managers: ${PM_LIST:-none} (using $PM)"
  printf '  %-10s %-9s %s\n' "TOOL" "STATUS" "DETAIL"
  printf '  %-10s %-9b %s\n' "node"     "$(status_cell "$NODE_STATUS")"   "$NODE_VER (need >= $REQUIRED_NODE_MAJOR)"
  printf '  %-10s %-9b %s\n' "npm"      "$(status_cell "$NPM_STATUS")"    "v$NPM_VER"
  printf '  %-10s %-9b %s\n' "yanker"   "$(status_cell "$YANKER_STATUS")" "$YANKER_VER"
  printf '  %-10s %-9b %s %s\n' "yt-dlp" "$(status_cell "$YTDLP_STATUS")" "$YTDLP_VER" "$(dim "$YTDLP_WHERE")"
  printf '  %-10s %-9b %s\n' "ffmpeg"   "$(status_cell "$FFMPEG_STATUS")" "$FFMPEG_VER"
  printf '  %-10s %-9b %s\n' "clipboard" "$(status_cell "$CLIP_STATUS")" "$CLIP_WITH"
  echo
  if ! have "$BIN_NAME" && [[ "$YANKER_STATUS" == "ok" ]]; then
    echo "  Note: yanker is installed globally but its bin dir is not on your PATH."
    echo "  Add \"$(npm root -g 2>/dev/null)/../bin\" to PATH, or reinstall with npm."
    echo
  fi
}

# ---------- installers ----------

in_repo() {
  # true when run from the yanker source checkout (has matching package.json)
  [[ -f "$SCRIPT_DIR/package.json" ]] && \
    grep -q '"name": *"@dummy3ye/yanker"' "$SCRIPT_DIR/package.json" 2>/dev/null
}

install_yanker() {
  if [[ "$NPM_STATUS" != "ok" ]]; then
    echo "$(bad 'npm is missing — install Node 22+ first (see "Node.js" item).')"
    return 1
  fi
  if [[ "$NODE_STATUS" != "ok" ]]; then
    echo "$(bad "node $NODE_VER is too old — yanker needs >= $REQUIRED_NODE_MAJOR. Upgrade first (see \"Node.js\" item).")"
    return 1
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "$(dim "[dry-run] npm install -g $PKG_NAME@latest")"
    return 0
  fi
  if [[ "$YANKER_STATUS" == "ok" ]]; then
    echo "Updating $PKG_NAME globally…"
    npm install -g "$PKG_NAME@latest"
  elif in_repo && confirm "Install from this source checkout (build + global install)? (No = use npm registry)"; then
    echo "Building from source…"
    (cd "$SCRIPT_DIR" && npm install && npm run build)
    npm install -g "$SCRIPT_DIR"
  else
    echo "Installing $PKG_NAME globally…"
    npm install -g "$PKG_NAME"
  fi
  echo "$(ok 'done.') Try: $BIN_NAME --help"
}

# Per-manager package names. Empty output = manager can't provide it.
pkg_ytdlp() {
  case "$PM" in
    emerge) echo "net-misc/yt-dlp" ;;
    nix-env) echo "nixpkgs.yt-dlp" ;;
    winget) echo "yt-dlp.yt-dlp" ;;
    snap) echo "yt-dlp" ;;
    flatpak|none) echo "" ;;
    *) echo "yt-dlp" ;; # paru yay pacman apt dnf yum zypper apk nix-env brew
  esac
}

pkg_ffmpeg() {
  case "$PM" in
    emerge) echo "media-video/ffmpeg" ;;
    nix-env) echo "nixpkgs.ffmpeg" ;;
    winget) echo "Gyan.FFmpeg" ;;
    snap) echo "ffmpeg" ;;
    flatpak|none) echo "" ;;
    *) echo "ffmpeg" ;;
  esac
}

pkg_clip() {
  case "$PM" in
    emerge) echo "gui-apps/wl-clipboard x11-misc/xclip" ;;
    nix-env) echo "nixpkgs.wl-clipboard nixpkgs.xclip" ;;
    snap|flatpak|none|winget) echo "" ;;
    *) echo "wl-clipboard xclip" ;; # paru yay pacman apt dnf yum zypper apk nix-env brew
  esac
}

sys_install() {
  # sys_install <pkgs...> — install via $PM. Never sudo paru/yay (they refuse root).
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "$(dim "[dry-run] ($PM) install $*")"
    return 0
  fi
  # shellcheck disable=SC2086
  case "$PM" in
    paru|yay) $PM -S --needed --noconfirm $* ;;
    pacman) run_sudo_if_needed pacman -S --needed --noconfirm "$@" ;;
    apt) run_sudo_if_needed apt-get update && run_sudo_if_needed apt-get install -y "$@" ;;
    dnf|yum) run_sudo_if_needed "$PM" install -y "$@" ;;
    zypper) run_sudo_if_needed zypper install -y "$@" ;;
    apk) run_sudo_if_needed apk add "$@" ;;
    emerge) run_sudo_if_needed emerge "$@";;
    nix-env) nix-env -iA "$@" ;; # attrs: nix-env -iA nixpkgs.yt-dlp — caller passes nixpkgs.* names
    snap) run_sudo_if_needed snap install "$@" ;;
    brew) brew install "$@" ;;
    winget) winget install "$@" ;;
    *) echo "$(bad 'no system package manager for CLI tools — use the manual fallback below.')"; return 1 ;;
  esac
}

sys_update_ytdlp() {
  # update an already-installed system yt-dlp; returns nonzero when unsupported
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "$(dim "[dry-run] ($PM) update yt-dlp")"
    return 0
  fi
  case "$PM" in
    paru|yay) "$PM" -S --noconfirm yt-dlp ;;
    pacman) run_sudo_if_needed pacman -S --noconfirm yt-dlp ;;
    apt) run_sudo_if_needed apt-get install -y --only-upgrade yt-dlp ;;
    dnf|yum) run_sudo_if_needed "$PM" upgrade -y yt-dlp ;;
    zypper) run_sudo_if_needed zypper update -y yt-dlp ;;
    apk) run_sudo_if_needed apk add -u yt-dlp ;;
    emerge) run_sudo_if_needed emerge --update --newuse net-misc/yt-dlp ;;
    nix-env) nix-env -u yt-dlp ;;
    snap) run_sudo_if_needed snap refresh yt-dlp ;;
    brew) brew upgrade yt-dlp ;;
    winget) winget upgrade yt-dlp.yt-dlp ;;
    *) return 1 ;;
  esac
}

install_ytdlp_standalone() {
  # Distro-independent fallback: fetch the standalone binary to ~/.local/bin.
  # (Same thing yanker itself does to ~/.yanker/bin on first run.)
  local asset url target="$LOCAL_BIN/yt-dlp" downloader=""
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) asset="yt-dlp_linux" ;;
    Linux-aarch64|Linux-arm64) asset="yt-dlp_linux_aarch64" ;;
    Darwin-*) asset="yt-dlp_macos" ;;
    MINGW*|MSYS*|CYGWIN*) asset="yt-dlp.exe" ;;
    *) echo "$(bad "no standalone yt-dlp build for $(uname -s)-$(uname -m) — install via your distro.")"; return 1 ;;
  esac
  if have curl; then downloader="curl -fsSL -o";
  elif have wget; then downloader="wget -qO";
  else echo "$(bad 'need curl or wget for the manual download.')"; return 1; fi
  url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/$asset"
  echo "Fetching standalone yt-dlp → $target …"
  if [[ "$DRY_RUN" -eq 1 ]]; then echo "$(dim "[dry-run] $downloader $target $url")"; return 0; fi
  mkdir -p "$LOCAL_BIN"
  # shellcheck disable=SC2086
  $downloader "$target" "$url"
  chmod +x "$target"
  case ":$PATH:" in *":$LOCAL_BIN:"*) ;;
    *) echo "$(dim "note: $LOCAL_BIN is not on PATH — add it or use the full path.")" ;;
  esac
  echo "$(ok 'done.')"
}

install_ytdlp() {
  if [[ "$YTDLP_STATUS" == "ok" && "$YTDLP_WHERE" == system* ]]; then
    echo "Updating system yt-dlp…"
    if ! sys_update_ytdlp; then
      echo "$(dim 'manager cannot update it — trying yt-dlp -U…')"
      if [[ "$DRY_RUN" -eq 1 ]]; then echo "$(dim '[dry-run] yt-dlp -U')"; else yt-dlp -U || true; fi
    fi
  elif [[ "$YTDLP_STATUS" == "ok" ]]; then
    echo "Refreshing standalone yt-dlp via yanker…"
    if [[ "$DRY_RUN" -eq 1 ]]; then echo "$(dim '[dry-run] yanker --update-yt-dlp')"; return 0; fi
    if have "$BIN_NAME"; then "$BIN_NAME" --update-yt-dlp
    else "$STANDALONE_YTDLP" -U; fi
  else
    local pkgs
    pkgs="$(pkg_ytdlp)"
    if [[ -n "$pkgs" ]]; then
      echo "Installing system yt-dlp (optional — yanker fetches its own copy on first run)…"
      # shellcheck disable=SC2086
      sys_install $pkgs
      [[ "$PM" == "dnf" || "$PM" == "yum" || "$PM" == "zypper" ]] && \
        echo "$(dim 'note: ffmpeg/yt-dlp may need RPMFusion (Fedora/RHEL) or Packman (openSUSE) enabled.')"
    else
      echo "$(dim 'flatpak/none cannot provide CLI tools — using the standalone binary instead.')"
      install_ytdlp_standalone
    fi
  fi
  echo "$(ok 'done.')"
}

install_ffmpeg() {
  if [[ "$FFMPEG_STATUS" == "ok" ]]; then
    echo "ffmpeg already present (${FFMPEG_VER}) — nothing to do."
    echo "$(dim 'The npm ffmpeg-static fallback also covers merges/converts.')"
    return 0
  fi
  local pkgs
  pkgs="$(pkg_ffmpeg)"
  if [[ -z "$pkgs" ]]; then
    echo "$(dim 'no system package for ffmpeg here — relying on the bundled ffmpeg-static fallback.')"
    echo "$(dim 'It downloads automatically with `npm install -g @dummy3ye/yanker`. For a system copy,')"
    echo "$(dim 'install ffmpeg via your distro manager or a static build from your vendor.')"
    return 0
  fi
  echo "Installing system ffmpeg (optional — npm ffmpeg-static fallback covers merges)…"
  # shellcheck disable=SC2086
  sys_install $pkgs
  [[ "$PM" == "dnf" || "$PM" == "yum" ]] && \
    echo "$(dim 'note: full ffmpeg needs RPMFusion enabled on Fedora/RHEL clones.')"
  [[ "$PM" == "zypper" ]] && \
    echo "$(dim 'note: full ffmpeg needs the Packman repo on openSUSE.')"
  echo "$(ok 'done.')"
}

install_clipboard() {
  if [[ "$CLIP_STATUS" == "ok" ]]; then
    echo "Clipboard helper already present ($CLIP_WITH) — nothing to do."
    return 0
  fi
  case "$(uname -s)" in
    Darwin|MINGW*|MSYS*|CYGWIN*)
      echo "Clipboard support is built in on this OS — nothing to install."; return 0 ;;
  esac
  local pkgs
  pkgs="$(pkg_clip)"
  if [[ -z "$pkgs" ]]; then
    echo "$(bad 'no package for clipboard helpers here — install wl-clipboard (Wayland) or xclip/xsel (X11) manually.')"
    return 1
  fi
  echo "Installing clipboard helpers (wl-clipboard for Wayland, xclip as X11 fallback)…"
  # shellcheck disable=SC2086
  sys_install $pkgs
  echo "$(ok 'done.')"
}

node_help() {
  cat <<EOF
Node.js is managed outside this script (auto-upgrading runtimes is risky).
  • need >= $REQUIRED_NODE_MAJOR, detected: $NODE_VER
  • nvm (any OS):      nvm install $REQUIRED_NODE_MAJOR && nvm use $REQUIRED_NODE_MAJOR
  • Arch/EndeavourOS:  sudo pacman -S nodejs npm        (or: yay/paru -S nodejs npm)
  • Debian/Ubuntu:     curl -fsSL https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x | sudo -E bash - && sudo apt-get install -y nodejs
  • Fedora:            sudo dnf install nodejs npm
  • openSUSE:          sudo zypper install nodejs npm
  • Alpine:            sudo apk add nodejs npm
  • macOS:             brew install node
  • Windows:           winget install OpenJS.NodeJS.LTS
Then re-run ./install.sh.
EOF
}

# ---------- menu ----------

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

yanker_label() { [[ "$YANKER_STATUS" == "ok" ]] && echo "yanker — update global install (have $YANKER_VER)" || echo "yanker — install globally from npm"; }
ytdlp_label()  { [[ "$YTDLP_STATUS" == "ok" ]] && echo "yt-dlp — update ($YTDLP_VER)" || echo "yt-dlp — install system copy (optional)"; }
ffmpeg_label() { [[ "$FFMPEG_STATUS" == "ok" ]] && echo "ffmpeg — already installed ($FFMPEG_VER)" || echo "ffmpeg — install system copy (optional)"; }
clip_label()   { [[ "$CLIP_STATUS" == "ok" ]] && echo "clipboard — already have $CLIP_WITH" || echo "clipboard — install helpers (Tab-paste)"; }
node_label()   { [[ "$NODE_STATUS" == "ok" ]] && echo "Node.js — OK ($NODE_VER, how-to)" || echo "Node.js — how to fix ($NODE_VER, need >= $REQUIRED_NODE_MAJOR)"; }

interactive_menu() {
  local -a items
  while true; do
    items=("$(yanker_label)" "$(ytdlp_label)" "$(ffmpeg_label)" "$(clip_label)" "$(node_label)" "Everything missing" "Quit")
    if ! arrow_menu "What do you want to do? (↑/↓ move · Enter select · 1-7 shortcut · q quit)" "${items[@]}"; then
      return 0
    fi
    case "$PICK" in
      0) install_yanker || true ;;
      1) install_ytdlp || true ;;
      2) install_ffmpeg || true ;;
      3) install_clipboard || true ;;
      4) node_help ;;
      5)
        install_yanker || true
        install_ytdlp || true
        install_ffmpeg || true
        install_clipboard || true
        ;;
      6) return 0 ;; # Quit
    esac
    check_all  # refresh labels (installed → update, etc.)
    print_status
  done
}

# ---------- main ----------

check_all
print_status

if [[ "$CHECK_ONLY" -eq 1 ]]; then exit 0; fi

if [[ "$NONINTERACTIVE" -eq 1 ]]; then
  [[ "$YANKER_STATUS" != "ok" ]] && install_yanker || true
  [[ "$YTDLP_STATUS" != "ok" ]] && install_ytdlp || true
  [[ "$FFMPEG_STATUS" != "ok" ]] && install_ffmpeg || true
  [[ "$CLIP_STATUS" != "ok" ]] && install_clipboard || true
  check_all; print_status
  exit 0
fi

if [[ ! -t 0 ]]; then
  # piped (curl | bash): no menu possible — just report. Use --yes to act.
  echo "$(dim 'non-interactive shell detected: re-run with --yes to install all missing, or run in a terminal for the menu.')"
  exit 0
fi

if arrow_menu "Install/update tools?" "Continue" "Quit"; then
  if [[ "$PICK" == "0" ]]; then
    interactive_menu
  fi
fi
check_all; print_status
echo "$(ok 'All set. Run `yanker --help` to start.')"
