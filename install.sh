#!/usr/bin/env bash
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
  cat <<EOF
yanker installer

Usage:
  ./install.sh [options]

Options:
  -y, --yes      Non-interactive mode
  -c, --check    Check status only
  --dry-run      Print operations without executing
  --pm <name>    Force package manager
  -h, --help     Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes) NONINTERACTIVE=1; shift ;;
    -c|--check) CHECK_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --pm) PM_OVERRIDE="${2:-}"; shift 2 ;;
    --pm=*) PM_OVERRIDE="${1#--pm=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

have() { command -v "$1" >/dev/null 2>&1; }

run_sudo() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] sudo $*"
    return 0
  fi
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  elif have sudo; then
    sudo "$@"
  else
    "$@"
  fi
}

# --- Package Manager Detection ---

PM_CANDIDATES=(paru yay pacman apt-get dnf yum zypper apk emerge nix-env snap brew winget flatpak)

detect_pms() {
  local c bin found=()
  for c in "${PM_CANDIDATES[@]}"; do
    bin="$c"
    [[ "$c" == "apt-get" ]] && bin="apt-get"
    if have "$bin"; then
      if [[ "$c" == "apt-get" ]]; then
        found+=(apt)
      else
        found+=("$c")
      fi
    fi
  done
  echo "${found[@]}"
}

PM_LIST="$(detect_pms)"
PM="${PM_LIST%% *}"
if [[ -n "$PM_OVERRIDE" ]]; then
  if [[ " $PM_LIST " == *" $PM_OVERRIDE "* ]]; then
    PM="$PM_OVERRIDE"
  else
    echo "Error: PM '$PM_OVERRIDE' unavailable (found: ${PM_LIST:-none})" >&2
    exit 1
  fi
fi
[[ -z "$PM" ]] && PM="none"

OS_LABEL="$(uname -s)"
if [[ -f /etc/os-release ]]; then
  OS_LABEL="$(bash -c 'source /etc/os-release && echo "${PRETTY_NAME:-$NAME}"' 2>/dev/null || uname -s) ($(uname -m))"
fi

# --- Gum Detection ---

HAVE_GUM=0
have gum && HAVE_GUM=1

# --- Prompts & Feedback ---

confirm() {
  if [[ "$NONINTERACTIVE" -eq 1 ]]; then return 0; fi
  if [[ "$HAVE_GUM" -eq 1 ]]; then
    # Direct /dev/tty redirect ensures gum confirm never skips
    gum confirm "$1" < /dev/tty
    return $?
  fi
  local ans
  read -rp "$1 [y/N] " ans < /dev/tty || return 1
  [[ "$ans" =~ ^[Yy] ]]
}

run_spin() {
  local title="$1" cmd="$2"
  if [[ "$HAVE_GUM" -eq 1 ]]; then
    gum spin --title "$title" -- bash -c "$cmd"
  else
    echo "$title..."
    bash -c "$cmd"
  fi
}

print_banner() {
  local pm_info="managers: ${PM_LIST:-none} (using $PM)"
  if [[ "$HAVE_GUM" -eq 1 ]]; then
    gum style --border rounded --padding "0 1" "yanker preflight" "$OS_LABEL | $pm_info"
  else
    echo "=== yanker preflight ==="
    echo "$OS_LABEL | $pm_info"
    echo
  fi
}

# --- Status Checks ---

NODE_STATUS="";   NODE_VER=""; NODE_MAJOR=0
NPM_STATUS="";    NPM_VER=""
YANKER_STATUS=""; YANKER_VER=""
YTDLP_STATUS="";  YTDLP_VER=""; YTDLP_WHERE=""
FFMPEG_STATUS=""; FFMPEG_VER=""
CLIP_STATUS="";   CLIP_WITH=""

check_all() {
  if have node; then
    NODE_VER="$(node --version 2>/dev/null || echo "?")"
    NODE_MAJOR="${NODE_VER#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
    if [[ "${NODE_MAJOR:-0}" =~ ^[0-9]+$ ]] && (( NODE_MAJOR >= REQUIRED_NODE_MAJOR )); then
      NODE_STATUS="OK"
    else
      NODE_STATUS="OLD"
    fi
  else
    NODE_STATUS="MISSING"; NODE_VER="-"
  fi

  if have npm; then
    NPM_STATUS="OK"
    NPM_VER="$(npm --version 2>/dev/null || echo "?")"
  else
    NPM_STATUS="MISSING"
    NPM_VER="-"
  fi

  if have "$BIN_NAME"; then
    YANKER_STATUS="OK"
    YANKER_VER="$("$BIN_NAME" --version 2>/dev/null || echo "?")"
  elif have npm && npm ls -g --depth=0 2>/dev/null | grep -q "$PKG_NAME"; then
    YANKER_STATUS="OK"
    YANKER_VER="(not on PATH)"
  else
    YANKER_STATUS="MISSING"
    YANKER_VER="-"
  fi

  if have yt-dlp; then
    YTDLP_STATUS="OK"
    YTDLP_VER="$(yt-dlp --version 2>/dev/null | head -n1 || echo "?")"
    YTDLP_WHERE="system ($(command -v yt-dlp))"
  elif [[ -x "$STANDALONE_YTDLP" ]]; then
    YTDLP_STATUS="OK"
    YTDLP_VER="$("$STANDALONE_YTDLP" --version 2>/dev/null | head -n1 || echo "?")"
    YTDLP_WHERE="standalone"
  else
    YTDLP_STATUS="MISSING"
    YTDLP_VER="-"
    YTDLP_WHERE=""
  fi

  if have ffmpeg; then
    FFMPEG_STATUS="OK"
    FFMPEG_VER="$(ffmpeg -version 2>/dev/null | head -n1 | awk '{print $3}' || echo "?")"
  else
    FFMPEG_STATUS="MISSING"
    FFMPEG_VER="-"
  fi

  CLIP_WITH=""
  case "$(uname -s)" in
    Darwin) have pbpaste && CLIP_WITH="pbpaste" ;;
    MINGW*|MSYS*|CYGWIN*) CLIP_WITH="Get-Clipboard" ;;
    *)
      for c in wl-paste xclip xsel; do
        if have "$c"; then CLIP_WITH="$c"; break; fi
      done
      ;;
  esac
  if [[ -n "$CLIP_WITH" ]]; then CLIP_STATUS="OK"; else CLIP_STATUS="MISSING"; CLIP_WITH="-"; fi
}

print_status() {
  print_banner
  printf '  %-10s %-8s %s\n' "TOOL" "STATUS" "DETAIL"
  printf '  %-10s %-8s %s\n' "node"      "$NODE_STATUS"   "$NODE_VER (>= $REQUIRED_NODE_MAJOR)"
  printf '  %-10s %-8s %s\n' "npm"       "$NPM_STATUS"    "v$NPM_VER"
  printf '  %-10s %-8s %s\n' "yanker"    "$YANKER_STATUS" "$YANKER_VER"
  printf '  %-10s %-8s %s %s\n' "yt-dlp" "$YTDLP_STATUS" "$YTDLP_VER" "$YTDLP_WHERE"
  printf '  %-10s %-8s %s\n' "ffmpeg"    "$FFMPEG_STATUS" "$FFMPEG_VER"
  printf '  %-10s %-8s %s\n' "clipboard" "$CLIP_STATUS"  "$CLIP_WITH"

  local gum_disp="MISSING"
  if [[ "$HAVE_GUM" -eq 1 ]]; then gum_disp="OK"; fi
  printf '  %-10s %-8s %s\n' "gum"       "$gum_disp" ""
  echo
}

# --- Installation Actions ---

sys_install() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] ($PM) install $*"
    return 0
  fi
  case "$PM" in
    paru|yay) $PM -S --needed --noconfirm "$@" ;;
    pacman) run_sudo pacman -S --needed --noconfirm "$@" ;;
    apt) run_sudo apt-get update && run_sudo apt-get install -y "$@" ;;
    dnf|yum) run_sudo "$PM" install -y "$@" ;;
    zypper) run_sudo zypper install -y "$@" ;;
    apk) run_sudo apk add "$@" ;;
    emerge) run_sudo emerge "$@" ;;
    nix-env) nix-env -iA "$@" ;;
    snap) run_sudo snap install "$@" ;;
    brew) brew install "$@" ;;
    winget) winget install "$@" ;;
    *) echo "No package manager available for $*" >&2; return 1 ;;
  esac
}

install_yanker() {
  if [[ "$NPM_STATUS" != "OK" || "$NODE_STATUS" != "OK" ]]; then
    echo "Error: Node.js >= $REQUIRED_NODE_MAJOR and npm are required." >&2
    return 1
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] npm install -g $PKG_NAME@latest"
    return 0
  fi

  run_spin "Installing $PKG_NAME" "npm install -g '$PKG_NAME@latest'"
}

uninstall_yanker() {
  if [[ "$NPM_STATUS" != "OK" ]]; then
    echo "Error: npm is required to uninstall $PKG_NAME." >&2
    return 1
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] npm uninstall -g $PKG_NAME"
    return 0
  fi

  run_spin "Uninstalling $PKG_NAME globally" "npm uninstall -g '$PKG_NAME'"
}

install_ytdlp() {
  case "$PM" in
    paru|yay|pacman|apt|dnf|yum|zypper|apk|brew) sys_install yt-dlp ;;
    nix-env) sys_install nixpkgs.yt-dlp ;;
    winget) sys_install yt-dlp.yt-dlp ;;
    *)
      mkdir -p "$LOCAL_BIN"
      local url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
      run_spin "Fetching yt-dlp" "curl -fsSL '$url' -o '$LOCAL_BIN/yt-dlp' && chmod +x '$LOCAL_BIN/yt-dlp'"
      ;;
  esac
}

install_ffmpeg() {
  case "$PM" in
    paru|yay|pacman|apt|dnf|yum|zypper|apk|brew|snap) sys_install ffmpeg ;;
    nix-env) sys_install nixpkgs.ffmpeg ;;
    winget) sys_install Gyan.FFmpeg ;;
    *) echo "Install ffmpeg manually for your system." ;;
  esac
}

install_clipboard() {
  case "$PM" in
    paru|yay|pacman|apt|dnf|yum|zypper|apk) sys_install wl-clipboard xclip ;;
    nix-env) sys_install nixpkgs.wl-clipboard nixpkgs.xclip ;;
    *) echo "Install wl-clipboard or xclip manually." ;;
  esac
}

install_pot_provider() {
  if ! have unzip; then
    echo "Error: unzip is required." >&2
    return 1
  fi

  local plugin_dir="$HOME/.config/yt-dlp/plugins"
  local zip_file="$plugin_dir/pot-provider.zip"
  mkdir -p "$plugin_dir"

  run_spin "Downloading PO token plugin" \
    "curl -fsSL https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip -o '$zip_file'"

  run_spin "Extracting plugin" \
    "unzip -o '$zip_file' -d '$plugin_dir' && rm -f '$zip_file'"

  local server_dir="$HOME/.yanker/pot-provider"
  if [[ ! -d "$server_dir" ]]; then
    run_spin "Cloning PO server" \
      "git clone --single-branch --branch 2.0.0 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git '$server_dir'"
  fi

  run_spin "Building PO server" \
    "cd '$server_dir/server' && npm ci && npx tsc"
}

# --- Main Flow ---

check_all
print_status

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  exit 0
fi

if [[ "$NONINTERACTIVE" -eq 1 ]]; then
  [[ "$YANKER_STATUS" != "OK" ]] && install_yanker
  [[ "$YTDLP_STATUS" != "OK" ]] && install_ytdlp
  [[ "$FFMPEG_STATUS" != "OK" ]] && install_ffmpeg
  [[ "$CLIP_STATUS" != "OK" ]] && install_clipboard
  check_all
  print_status
  exit 0
fi

OPT_YANKER="yanker CLI (install/update)"
OPT_UNINSTALL="yanker CLI (uninstall global)"
OPT_YTDLP="yt-dlp"
OPT_FFMPEG="ffmpeg"
OPT_CLIP="clipboard helper"
OPT_POT="PO token provider (bgutil)"

RAW_SELECTIONS=""

if [[ "$HAVE_GUM" -eq 1 ]]; then
  gum style --foreground 212 "Select actions to perform:"
else
  echo "Select actions to perform:"
fi

# Sequential confirmations guarantee input capture
confirm "$OPT_YANKER" && RAW_SELECTIONS+="$OPT_YANKER"$'\n'
confirm "$OPT_UNINSTALL" && RAW_SELECTIONS+="$OPT_UNINSTALL"$'\n'
confirm "$OPT_YTDLP" && RAW_SELECTIONS+="$OPT_YTDLP"$'\n'
confirm "$OPT_FFMPEG" && RAW_SELECTIONS+="$OPT_FFMPEG"$'\n'
confirm "$OPT_CLIP" && RAW_SELECTIONS+="$OPT_CLIP"$'\n'
confirm "$OPT_POT" && RAW_SELECTIONS+="$OPT_POT"$'\n'

cleaned_selections=$(echo "$RAW_SELECTIONS" | tr -d '[:space:]')
if [[ -z "$cleaned_selections" ]]; then
  echo "No actions selected."
  exit 0
fi

while IFS= read -r sel; do
  [[ -z "$sel" ]] && continue
  case "$sel" in
    "$OPT_YANKER")    install_yanker || true ;;
    "$OPT_UNINSTALL") uninstall_yanker || true ;;
    "$OPT_YTDLP")     install_ytdlp || true ;;
    "$OPT_FFMPEG")    install_ffmpeg || true ;;
    "$OPT_CLIP")      install_clipboard || true ;;
    "$OPT_POT")       install_pot_provider || true ;;
  esac
done <<< "$RAW_SELECTIONS"

check_all
echo
print_status
