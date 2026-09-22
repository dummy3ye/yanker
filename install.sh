#!/usr/bin/env bash
set -euo pipefail

# yanker installer
# looks great with gum (charm.sh/gum), works fine without

PKG="@dummy3ye/yanker"
NODE_MIN=22
YTDLP_HOME="$HOME/.yanker/bin"

# ── args ─────────────────────────────────────────
YES=0; CHECK=0; DRY=0; PM_FORCE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)     YES=1; shift ;;
    -c|--check)   CHECK=1; shift ;;
    --dry-run)    DRY=1; shift ;;
    --pm)         PM_FORCE="${2:-}"; shift 2 ;;
    --pm=*)       PM_FORCE="${1#--pm=}"; shift ;;
    -h|--help)
      cat <<'HELP'
yanker installer

  ./install.sh            interactive setup (install gum for the full experience)
  ./install.sh -y         auto-install everything that's missing
  ./install.sh -c         just check what's installed
  ./install.sh --dry-run  preview without touching anything
  ./install.sh --pm paru  force a specific package manager
HELP
      exit 0 ;;
    *) printf 'unknown: %s\n' "$1" >&2; exit 1 ;;
  esac
done

has() { command -v "$1" &>/dev/null; }

as_root() {
  [[ $DRY -eq 1 ]] && { echo "[dry] sudo $*"; return 0; }
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then "$@"
  elif has sudo; then sudo "$@"
  else "$@"; fi
}

# expose helpers to the bash -c subshells spin() runs
export -f has as_root

# npm global root that actually contains yanker (e.g. /usr/lib, ~/.local/lib), or ""
# yanker may live outside the user's npm prefix (e.g. sudo-installed to /usr), so a
# plain `npm uninstall -g` can silently no-op — resolve the real install location.
yanker_npm_root() {
  has yanker || return 1
  local real
  real="$(readlink -f "$(command -v yanker)" 2>/dev/null || command -v yanker)"
  case "$real" in
    */node_modules/*) echo "${real%/node_modules/*}" ;;
    *) return 1 ;;
  esac
}

# ── npm helpers (work across distros / npm configs) ─
npm_gprefix() {   # npm's effective global prefix, or ""
  local p
  p="$(npm config get prefix 2>/dev/null || true)"
  [[ -z "$p" || "$p" == "undefined" ]] && p="$(npm prefix -g 2>/dev/null || true)"
  echo "$p"
}

npm_shimbin() {   # where a prefix puts CLI shims (prefix dir itself on Windows)
  local prefix="$1"
  [[ -n "$prefix" ]] || return 0
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) echo "$prefix" ;;
    *) echo "$prefix/bin" ;;
  esac
}

npm_allow() {     # npm ≥12 gates postinstall scripts behind an allow-list
  local m="${NPM_MAJOR:-0}"
  [[ "$m" =~ ^[0-9]+$ ]] && (( m >= 12 )) && echo "--allow-scripts='$PKG,ffmpeg-static'"
}

# ── package manager ──────────────────────────────
detect_pm() {
  for c in paru yay pacman apt-get dnf yum zypper apk emerge nix-env snap brew winget; do
    if has "$c"; then [[ "$c" == "apt-get" ]] && echo apt || echo "$c"; return; fi
  done
  echo none
}
PM="${PM_FORCE:-$(detect_pm)}"

# ── gum + ansi ───────────────────────────────────
G=0; has gum && G=1

# gum's capability probes can leave DECRPM responses (like ^[[?2026;2$y)
# sitting in the tty input buffer; if they land while echo is on, the terminal
# spits them onto the screen. Quietly swallow stragglers after any interactive
# gum call returns — always against /dev/tty: callers may run with stdin
# redirected (e.g. an actions loop fed by a here-string), where fd 0 is a pipe
# and `stty` on it fails with ENOTTY.
drain_stray() {
  [[ -t 0 || -t /dev/tty ]] || return 0
  local st=""
  st="$(stty -g </dev/tty 2>/dev/null)" || return 0
  # hold echo off and keep draining for a short window so late replies
  # (DECRPM/kitty handshakes) can't get splashed onto the screen
  stty -echo -icanon min 0 time 0 </dev/tty 2>/dev/null || true
  local i
  for i in 1 2 3 4 5 6; do
    dd if=/dev/tty bs=1 count=64 of=/dev/null 2>/dev/null || true
    sleep 0.05
  done
  stty "$st" </dev/tty 2>/dev/null || true
}

spin() {
  local title="$1" cmd="$2"
  if [[ $DRY -eq 1 ]]; then
    echo "  [dry] $cmd"
    return 0
  fi
  if [[ $G -eq 1 ]]; then
    # gum spin probes the terminal for synchronized output (`\e[?2026$p...`);
    # its DECRQM answer arrives as input while gum never touches echo, so it
    # would get splashed onto the screen. Keep echo off for the spinner's
    # whole run, swallow whatever straggled in (still echo-off), then restore.
    # Everything targets /dev/tty explicitly: inside the actions loop stdin is
    # a here-string pipe, so `stty` on fd 0 fails with ENOTTY — which is
    # exactly how the echo-off used to get skipped and the answer splashed.
    local _sp_st=""
    _sp_st="$(stty -g </dev/tty 2>/dev/null || true)"
    stty -echo </dev/tty 2>/dev/null || true
    gum spin --spinner dot --spinner.foreground 220 --title "$title" -- bash -c "$cmd"
    drain_stray
    [[ -n "$_sp_st" ]] && stty "$_sp_st" </dev/tty 2>/dev/null || true
  else
    printf '  %s … ' "$title"
    if bash -c "$cmd" >/dev/null 2>&1; then echo "done"
    else echo "failed"; return 1; fi
  fi
}

# ── multi-select chooser ─────────────────────────
# drop-in for gum's `choose` that we fully own: renders the same list plus a
# bottom hint ending in 'ctrl+c exits'. x/X/tab/space toggle, arrow keys
# navigate, enter confirms, ctrl+a selects all, ctrl+c cancels (rc 130, like
# gum). UI is drawn to the tty; only the selection reaches stdout. Preselects
# the missing installs from $PRESEL.
pick_choose() {
  local items=("$@")
  local -a sel=()
  local i p cur=0 printed=0 key k2 k3 rc=0 row

  for i in "${!items[@]}"; do
    for p in "${PRESEL[@]}"; do
      [[ "${items[$i]}" == "$p" ]] && { sel[$i]=1; break; }
    done
  done

  _pick_st="$(stty -g 2>/dev/null || true)"
  [[ -n "$_pick_st" ]] && stty raw -echo 2>/dev/null || true
  trap 'stty "${_pick_st:-}" 2>/dev/null || true
        printf "\033[?25h" > /dev/tty 2>/dev/null || true' RETURN
  ui() {
    local s
    printf -v s '%b' "$1"
    printf '%s' "${s//$'\n'/$'\r\n'}" > /dev/tty 2>/dev/null || true
  }
  ui '\033[?25l'

  # repainting relies on the frame occupying exactly printed rows, so no line
  # may ever wrap. only the hint is wide enough to — cap it to the terminal
  # width (minus 2) so the row count stays valid on narrow terminals.
  _pc_cols="${COLUMNS:-$(tput cols 2>/dev/null || echo 80)}"
  _pc_cols=$((_pc_cols - 2))
  [[ $_pc_cols -lt 10 ]] && _pc_cols=10

  while :; do
    # redraw the frame from its first row. the render advances exactly
    # printed-1 rows (header + items + blank end with \r\n; the hint does
    # not), so moving up printed-1 puts the cursor back on the header row.
    [[ $printed -gt 0 ]] && printf '\033[%dA\r' "$((printed-1))" > /dev/tty || true
    printed=0
    ui "\033[2K${_d}pick what to set up  (x/tab toggles)${_n}\n"
    printed=$((printed+1))
    for i in "${!items[@]}"; do
      if [[ $i -eq $cur ]]; then
        if [[ ${sel[i]:-0} -eq 1 ]]; then row="> ${_g}✓${_n} ${items[$i]}"
        else row="> ${_y}•${_n} ${items[$i]}"; fi
      else
        if [[ ${sel[i]:-0} -eq 1 ]]; then row="  ${_g}✓${_n} ${items[$i]}"
        else row="  · ${items[$i]}"; fi
      fi
      ui "\033[2K${row}\n"
      printed=$((printed+1))
    done
    ui '\033[2K\n'
    printed=$((printed+1))
    hint="x toggle · tab toggle · enter confirms · ctrl+a select all · ctrl+c exits"
    [[ ${#hint} -gt $_pc_cols ]] && hint="${hint:0:$_pc_cols}"
    ui "\033[2K${_d}${hint}${_n}"
    printed=$((printed+1))

    # read the next key as a raw byte. bash's read builtin is unusable here:
    # it translates terminal CR to LF and returns ~130 on a ctrl+c byte even
    # in raw mode — dd+od bypass it and deliver the exact byte.
    key="$(dd bs=1 count=1 2>/dev/null | od -An -tu1 | tr -d ' \n')" || true
    [[ -n "$key" ]] || { rc=1; break; }   # stdin closed → treat as abort
    case "$key" in
      27)  # ESC: arrow key
        read -r -t 0.2 -N1 k2 || k2=""
        read -r -t 0.2 -N1 k3 || k3=""
        case "$k2$k3" in
          '[A'|'[D') if ((cur>0)); then cur=$((cur-1)); fi ;;
          '[B'|'[C') if ((cur<${#items[@]}-1)); then cur=$((cur+1)); fi ;;
        esac ;;
      120|88|9|32) (( sel[cur]=1-sel[cur] )) || true ;;  # x/X/tab/space toggle
      1) for i in "${!items[@]}"; do sel[$i]=1; done ;;   # ctrl+a select all
      13|10) rc=0; break ;;                               # enter (CR or LF)
      3) rc=130; break ;;                                 # ctrl+c cancel
    esac
  done

  # clear the frame and park the cursor where the list began
  [[ $printed -gt 0 ]] && printf '\033[%dA\r' "$((printed-1))" > /dev/tty || true
  for ((i=0; i<printed; i++)); do printf '\033[2K\r\033[B' > /dev/tty || true; done
  printf '\033[2K\r\033[%dA' "$printed" > /dev/tty || true
  ui '\033[?25h'
  [[ -n "$_pick_st" ]] && stty "$_pick_st" 2>/dev/null || true

  [[ $rc -ne 0 ]] && return "$rc"
  local out=""
  for i in "${!items[@]}"; do
    [[ ${sel[i]:-0} -eq 1 ]] && out+="${items[$i]}"$'\n'
  done
  printf '%s' "$out"
  return 0
}

if [[ -t 1 ]]; then
  _y=$'\033[38;5;220m' _g=$'\033[32m' _r=$'\033[31m'
  _d=$'\033[90m' _b=$'\033[1m' _n=$'\033[0m'
else
  _y='' _g='' _r='' _d='' _b='' _n=''
fi

# ── banner ───────────────────────────────────────
print_logo() {
  cat <<'LOGO'
 _  _ __ _ _ _ | |_____ _ _
| || / _` | ' \| / / -_) '_|
 \_, \__,_|_||_|_\_\___|_|
 |__/
LOGO
}

banner() {
  echo
  if [[ $G -eq 1 ]]; then
    print_logo | gum style --foreground 220 --bold
    printf '  %sinstaller%s  %s%s · %s%s\n' "$_b" "$_n" "$_d" "$(uname -sm)" "$PM" "$_n"
  else
    printf '%s%s' "$_y" "$_b"
    print_logo
    printf '%s' "$_n"
    printf '  %sinstaller%s  %s%s · %s%s\n' "$_b" "$_n" "$_d" "$(uname -sm)" "$PM" "$_n"
  fi
  echo
}

# ── scan ─────────────────────────────────────────
NODE_ST="" NODE_V=""
NPM_ST=""  NPM_V="" NPM_MAJOR=""
YNK_ST=""  YNK_V=""
YT_ST=""   YT_V="" YT_W=""
FF_ST=""   FF_V=""
CL_ST=""   CL_V=""
PO_ST=""   PO_V=""
PO_PLUGDIR="$HOME/.config/yt-dlp/plugins"
PO_SRVDIR="$HOME/.yanker/pot-provider"

scan() {
  if has node; then
    NODE_V="$(node -v 2>/dev/null || echo '?')"
    local m="${NODE_V#v}"; m="${m%%.*}"
    if [[ "${m:-0}" =~ ^[0-9]+$ ]] && (( m >= NODE_MIN )); then
      NODE_ST=ok
    else
      NODE_ST=old
    fi
  else NODE_ST=miss; NODE_V="—"; fi

  if has npm; then NPM_ST=ok; NPM_V="v$(npm -v 2>/dev/null)"
    NPM_MAJOR="$(npm -v 2>/dev/null | cut -d. -f1)"
  else NPM_ST=miss; NPM_V="—"; fi

  if has yanker; then YNK_ST=ok; YNK_V="v$(yanker -v 2>/dev/null)"
  else YNK_ST=miss; YNK_V="—"; fi

  if has yt-dlp; then
    YT_ST=ok; YT_V="$(yt-dlp --version 2>/dev/null | head -1)"; YT_W="system"
  elif [[ -x "$YTDLP_HOME/yt-dlp" ]]; then
    YT_ST=ok; YT_V="$("$YTDLP_HOME/yt-dlp" --version 2>/dev/null | head -1)"; YT_W="standalone"
  else YT_ST=miss; YT_V="—"; YT_W=""; fi

  if has ffmpeg; then FF_ST=ok; FF_V="$(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"
  else FF_ST=miss; FF_V="—"; fi

  CL_V=""
  case "$(uname -s)" in
    Darwin) has pbpaste && CL_V=pbpaste ;;
    MINGW*|MSYS*|CYGWIN*) CL_V=Get-Clipboard ;;
    *) for c in wl-paste xclip xsel; do has "$c" && { CL_V="$c"; break; }; done ;;
  esac
  [[ -n "$CL_V" ]] && CL_ST=ok || { CL_ST=miss; CL_V="—"; }

  scan_pot
}

# PO token provider: plugin extracted into the yt-dlp plugins dir, and the
# local server cloned + built. Partial states show up as ⚠.
scan_pot() {
  PO_ST=miss; PO_V="—"
  local plugin=0 server=0 srv="$PO_SRVDIR"

  [[ -d "$PO_PLUGDIR/yt_dlp_plugins" ]] && plugin=1
  if [[ -d "$srv/server" ]] && { [[ -d "$srv/server/node_modules" ]] \
    || [[ -d "$srv/server/build" ]] \
    || [[ -d "$srv/server/dist" ]] \
    || [[ -d "$srv/server/out" ]]; }; then
    server=1
  fi

  if [[ $plugin -eq 1 && $server -eq 1 ]]; then PO_ST=ok; PO_V="plugin + server"
  elif [[ $plugin -eq 1 ]]; then PO_ST=old; PO_V="plugin only"
  elif [[ $server -eq 1 ]]; then PO_ST=old; PO_V="server only"
  fi
}

# ── status display ───────────────────────────────
_row() {
  local st="$1" name="$2" detail="$3"
  local ic
  case "$st" in
    ok)   ic="${_g}✓${_n}" ;;
    miss) ic="${_r}✗${_n}" ;;
    old)  ic="${_y}⚠${_n}" ;;
  esac
  printf '  %b  %-12s %s%s%s\n' "$ic" "$name" "$_d" "$detail" "$_n"
}

show_status() {
  local nd="$NODE_V"
  [[ "$NODE_ST" != ok ]] && nd="$NODE_V (need ≥$NODE_MIN)"
  _row "$NODE_ST" "node"      "$nd"
  _row "$NPM_ST"  "npm"       "$NPM_V"
  _row "$YNK_ST"  "yanker"    "$YNK_V"
  _row "$YT_ST"   "yt-dlp"    "$YT_V${YT_W:+ ($YT_W)}"
  _row "$PO_ST"   "po-token"  "$PO_V"
  _row "$FF_ST"   "ffmpeg"    "$FF_V"
  _row "$CL_ST"   "clipboard" "$CL_V"
  echo
}

# ── install actions ──────────────────────────────
do_yanker() {
  if [[ "$NODE_ST" != ok || "$NPM_ST" != ok ]]; then
    printf '  %s✗ need node ≥%s and npm first%s\n' "$_r" "$NODE_MIN" "$_n" >&2
    return 1
  fi

  local prefix nmroot cmd title bdir allow
  title="grabbing $PKG"
  if nmroot="$(yanker_npm_root)"; then
    # yanker already on the box — update it where it actually lives
    title="updating $PKG"
    prefix="$(dirname "$nmroot")"
    nmroot="$nmroot/node_modules"
  else
    # fresh install — use npm's own global prefix
    prefix="$(npm_gprefix)"
    nmroot="$(npm root -g 2>/dev/null || echo "$prefix/lib/node_modules")"
  fi

  allow="$(npm_allow)"
  if [[ -n "$prefix" && -n "$nmroot" ]]; then
    if [[ -w "$nmroot" ]]; then cmd="npm"
    else cmd="as_root npm"; fi
    spin "$title" "$cmd install -g --prefix '$prefix' ${allow:+$allow }'$PKG@latest'"
  else
    spin "$title" "npm install -g ${allow:+$allow }'$PKG@latest'"
  fi

  # warn if the CLI shims land somewhere that isn't on PATH
  if [[ -n "$prefix" ]]; then
    bdir="$(npm_shimbin "$prefix")"
    if [[ ":$PATH:" != *":$bdir:"* ]]; then
      printf '  %s⚠ yanker installs to %s — not on your PATH%s\n' "$_y" "$bdir" "$_n"
      printf '  %s  add it:  export PATH="%s:$PATH"%s\n' "$_d" "$bdir" "$_n"
    fi
  fi
}

do_uninstall() {
  [[ "$NPM_ST" != ok ]] && { echo "  need npm to uninstall" >&2; return 1; }
  local nm_root cmd
  if nm_root="$(yanker_npm_root)"; then
    if [[ -w "$nm_root/node_modules" ]]; then
      cmd="npm uninstall -g --prefix '$(dirname "$nm_root")'"
    else
      cmd="as_root npm uninstall -g --prefix '$(dirname "$nm_root")'"
    fi
  else
    cmd="npm uninstall -g"
  fi
  spin "removing $PKG" "$cmd '$PKG'"
}

do_ytdlp() {
  case "$PM" in
    paru|yay)  spin "installing yt-dlp via $PM" "$PM -S --needed --noconfirm yt-dlp" ;;
    pacman)    spin "installing yt-dlp" "as_root pacman -S --needed --noconfirm yt-dlp" ;;
    apt)       spin "installing yt-dlp" "as_root apt-get update -qq && as_root apt-get install -yqq yt-dlp" ;;
    dnf|yum)   spin "installing yt-dlp" "as_root $PM install -y yt-dlp" ;;
    zypper)    spin "installing yt-dlp" "as_root zypper install -y yt-dlp" ;;
    apk)       spin "installing yt-dlp" "as_root apk add yt-dlp" ;;
    emerge)    spin "installing yt-dlp" "as_root emerge yt-dlp" ;;
    nix-env)   spin "installing yt-dlp" "nix-env -iA nixpkgs.yt-dlp" ;;
    brew)      spin "installing yt-dlp" "brew install yt-dlp" ;;
    winget)    spin "installing yt-dlp" "winget install yt-dlp.yt-dlp" ;;
    *)
      mkdir -p "$YTDLP_HOME"
      spin "fetching standalone yt-dlp" \
        "curl -fsSL 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp' -o '$YTDLP_HOME/yt-dlp' && chmod +x '$YTDLP_HOME/yt-dlp'"
      ;;
  esac
}

do_ffmpeg() {
  case "$PM" in
    paru|yay)  spin "installing ffmpeg via $PM" "$PM -S --needed --noconfirm ffmpeg" ;;
    pacman)    spin "installing ffmpeg" "as_root pacman -S --needed --noconfirm ffmpeg" ;;
    apt)       spin "installing ffmpeg" "as_root apt-get update -qq && as_root apt-get install -yqq ffmpeg" ;;
    dnf|yum)   spin "installing ffmpeg" "as_root $PM install -y ffmpeg" ;;
    zypper)    spin "installing ffmpeg" "as_root zypper install -y ffmpeg" ;;
    apk)       spin "installing ffmpeg" "as_root apk add ffmpeg" ;;
    emerge)    spin "installing ffmpeg" "as_root emerge ffmpeg" ;;
    nix-env)   spin "installing ffmpeg" "nix-env -iA nixpkgs.ffmpeg" ;;
    snap)      spin "installing ffmpeg" "as_root snap install ffmpeg" ;;
    brew)      spin "installing ffmpeg" "brew install ffmpeg" ;;
    winget)    spin "installing ffmpeg" "winget install Gyan.FFmpeg" ;;
    *)         echo "  install ffmpeg manually for your platform" ;;
  esac
}

do_clip() {
  case "$PM" in
    paru|yay)    spin "installing clipboard tools" "$PM -S --needed --noconfirm wl-clipboard xclip" ;;
    pacman)      spin "installing clipboard tools" "as_root pacman -S --needed --noconfirm wl-clipboard xclip" ;;
    apt)         spin "installing clipboard tools" "as_root apt-get install -yqq wl-clipboard xclip" ;;
    dnf|yum)     spin "installing clipboard tools" "as_root $PM install -y wl-clipboard xclip" ;;
    zypper)      spin "installing clipboard tools" "as_root zypper install -y wl-clipboard xclip" ;;
    apk)         spin "installing clipboard tools" "as_root apk add wl-clipboard xclip" ;;
    nix-env)     spin "installing clipboard tools" "nix-env -iA nixpkgs.wl-clipboard nixpkgs.xclip" ;;
    *)           echo "  install wl-clipboard or xclip manually" ;;
  esac
}

do_pot() {
  has git   || { echo "  need git for PO token setup" >&2; return 1; }
  has unzip || { echo "  need unzip for PO token setup" >&2; return 1; }

  local plugdir="$PO_PLUGDIR"
  local srvdir="$PO_SRVDIR"
  local zip="$plugdir/pot-provider.zip"
  mkdir -p "$plugdir"

  if [[ -d "$plugdir/yt_dlp_plugins" ]]; then
    echo "  plugin already installed — skipping"
  else
    spin "downloading PO token plugin" \
      "curl -fsSL 'https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip' -o '$zip'"

    spin "extracting plugin" "unzip -o '$zip' -d '$plugdir' && rm -f '$zip'"
  fi

  if [[ ! -d "$srvdir" ]]; then
    spin "cloning PO server" \
      "git clone --single-branch --branch 2.0.0 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git '$srvdir'"
  fi

  spin "building PO server" "cd '$srvdir/server' && npm ci && npx tsc"
}

# ── main ─────────────────────────────────────────
scan
banner
show_status

[[ $CHECK -eq 1 ]] && exit 0

# PO provider label reflects whether it's already set up
POT_ITEM="Setup PO token provider"
[[ "$PO_ST" == ok || "$PO_ST" == old ]] && POT_ITEM="Re-setup PO token provider"

# build the menu
ITEMS=()
PRESEL=()

[[ "$YNK_ST" == miss ]] \
  && { ITEMS+=("Install yanker"); PRESEL+=("Install yanker"); } \
  || ITEMS+=("Update yanker")

[[ "$YT_ST" == miss ]] \
  && { ITEMS+=("Install yt-dlp"); PRESEL+=("Install yt-dlp"); } \
  || ITEMS+=("Update yt-dlp")

[[ "$FF_ST" == miss ]] \
  && { ITEMS+=("Install ffmpeg"); PRESEL+=("Install ffmpeg"); } \
  || ITEMS+=("Reinstall ffmpeg")

if [[ "$CL_ST" == miss && "$(uname -s)" == Linux ]]; then
  ITEMS+=("Install clipboard tools")
  PRESEL+=("Install clipboard tools")
fi

ITEMS+=("$POT_ITEM")
ITEMS+=("Uninstall yanker")

# pick actions
CHOSEN=""

# fallback prompts (no interactive tty): missing stuff defaults to yes,
# extras like uninstall / PO token default to no
ask_plain() {
  local c=""
  for item in "${PRESEL[@]}"; do
    local ans=""
    read -rp "  $item? [Y/n] " ans < /dev/tty || continue
    [[ ! "$ans" =~ ^[Nn] ]] && c+="$item"$'\n'
  done
  for extra in "$POT_ITEM" "Uninstall yanker"; do
    local ans=""
    read -rp "  $extra? [y/N] " ans < /dev/tty || continue
    [[ "$ans" =~ ^[Yy] ]] && c+="$extra"$'\n'
  done
  CHOSEN="$c"
}

if [[ $YES -eq 1 ]]; then
  # auto: grab everything that's missing
  [[ "$YNK_ST" != ok ]] && CHOSEN+="Install yanker"$'\n'
  [[ "$YT_ST"  != ok ]] && CHOSEN+="Install yt-dlp"$'\n'
  [[ "$FF_ST"  != ok ]] && CHOSEN+="Install ffmpeg"$'\n'
  [[ "$CL_ST"  != ok && "$(uname -s)" == Linux ]] && CHOSEN+="Install clipboard tools"$'\n'

else
  if [[ -t 0 && -t 1 ]]; then
    pick_rc=0
    CHOSEN="$(pick_choose "${ITEMS[@]}")" || pick_rc=$?
    if [[ $pick_rc -eq 0 ]]; then
      : # menu ran — CHOSEN holds the selection
    elif [[ $pick_rc -eq 130 ]]; then
      # ctrl+c — user called it quits, bow out cleanly
      echo
      printf '  %scancelled%s\n' "$_y" "$_n"
      exit 0
    else
      # read failed / no interactive tty — plain prompts
      ask_plain
    fi
  else
    ask_plain
  fi
fi

cleaned="$(echo "$CHOSEN" | tr -d '[:space:]')"
if [[ -z "$cleaned" ]]; then
  echo "  nothing selected — all good"
  exit 0
fi

echo

# cache sudo before spinners swallow the password prompt
case "$PM" in
  pacman|apt|dnf|yum|zypper|apk|emerge)
    if [[ "${EUID:-$(id -u)}" -ne 0 ]] && has sudo && [[ $DRY -eq 0 ]]; then
      sudo -v 2>/dev/null || true
    fi ;;
esac

# ...and for uninstalling a root-owned (system-wide) yanker install
if [[ $DRY -eq 0 ]] && [[ "${EUID:-$(id -u)}" -ne 0 ]] && has sudo \
   && [[ "$cleaned" == *Uninstallyanker* ]] \
   && nm_root="$(yanker_npm_root)" && [[ -n "$nm_root" ]] && [[ ! -w "$nm_root/node_modules" ]]; then
  sudo -v 2>/dev/null || true
fi

# go — iterate over an array, NOT via `<<<`: a here-string redirects the
# loop's stdin to a pipe, which breaks stty/`-t 0`/`dd if=/dev/tty` inside the
# actions (spin()'s echo-off would silently fail and gum's DECRQM answer would
# splash onto the screen). readarray keeps fd 0 as the original tty.
readarray -t _acts <<< "$CHOSEN"
for sel in "${_acts[@]}"; do
  [[ -z "$sel" ]] && continue
  case "$sel" in
    "Install yanker"|"Update yanker")     do_yanker    || true ;;
    "Uninstall yanker")                    do_uninstall || true ;;
    "Install yt-dlp"|"Update yt-dlp")     do_ytdlp     || true ;;
    "Install ffmpeg"|"Reinstall ffmpeg")   do_ffmpeg    || true ;;
    "Install clipboard tools")             do_clip      || true ;;
    "Setup PO token provider"|"Re-setup PO token provider") do_pot || true ;;
  esac
done

# final check
echo
scan
show_status

if [[ $G -eq 1 ]]; then
  gum style --foreground 220 --bold "all set — go yank some videos ↯"
else
  printf '%s%sall set — go yank some videos ↯%s\n' "$_y" "$_b" "$_n"
fi

if has yanker; then
  printf '  %stry:%s yanker https://youtu.be/dQw4w9WgXcQ\n' "$_d" "$_n"
fi
echo
