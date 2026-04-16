#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${HOMEPAGE_EDITOR_REPO:-https://github.com/Kemper51rus/homepage-editor.git}"
BRANCH="${HOMEPAGE_EDITOR_BRANCH:-main}"
SERVICE_NAME="${HOMEPAGE_SERVICE_NAME:-homepage.service}"

ACTION=""
MODE="${HOMEPAGE_EDITOR_MODE:-auto}"
TARGET="${HOMEPAGE_TARGET_DIR:-}"
CONFIG_DIR="${HOMEPAGE_CONFIG_DIR:-}"
DO_BUILD=1
DO_RESTART=1
TMP_DIR=""
MOD_DIR="${HOMEPAGE_EDITOR_MOD_DIR:-}"
MOD_SOURCE_MODE="auto"

usage() {
  cat <<'EOF'
Установщик Homepage Browser Editor Mod

Использование:
  bash install.sh [options]

После запуска скрипт спросит, что сделать.

Параметры:
  --action NAME      install, update-mod, update-target, install-radio, install-particles, uninstall или status
  --target PATH       путь к checkout gethomepage/homepage
  --config-dir PATH   путь к внешней папке config Homepage
  --mode MODE         auto, local или docker
  --repo URL          git-репозиторий мода
  --branch NAME       ветка мода
  --no-build          не запускать сборку после установки/обновления/удаления
  --no-restart        не перезапускать homepage.service после установки/обновления/удаления
  -h, --help          показать эту справку

Переменные окружения:
  HOMEPAGE_TARGET_DIR       то же самое, что --target
  HOMEPAGE_CONFIG_DIR       то же самое, что --config-dir
  HOMEPAGE_EDITOR_MOD_DIR   использовать уже скачанную директорию мода
  HOMEPAGE_SERVICE_NAME     имя systemd-сервиса, по умолчанию homepage.service
EOF
}

log() {
  printf '[homepage-editor] %s\n' "$*"
}

die() {
  printf '[homepage-editor] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --action)
        [[ $# -ge 2 ]] || die "--action requires install, update-mod, update-target, install-radio, install-particles, uninstall, or status"
        ACTION="$2"
        shift 2
        ;;
      --target)
        [[ $# -ge 2 ]] || die "--target requires a path"
        TARGET="$2"
        shift 2
        ;;
      --config-dir)
        [[ $# -ge 2 ]] || die "--config-dir requires a path"
        CONFIG_DIR="$2"
        shift 2
        ;;
      --mode)
        [[ $# -ge 2 ]] || die "--mode requires auto, local, or docker"
        MODE="$2"
        shift 2
        ;;
      --repo)
        [[ $# -ge 2 ]] || die "--repo requires a URL"
        REPO_URL="$2"
        shift 2
        ;;
      --branch)
        [[ $# -ge 2 ]] || die "--branch requires a branch name"
        BRANCH="$2"
        shift 2
        ;;
      --no-build)
        DO_BUILD=0
        shift
        ;;
      --no-restart)
        DO_RESTART=0
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
  done

  case "$MODE" in
    auto|local|docker) ;;
    *) die "--mode must be auto, local, or docker" ;;
  esac

  case "$ACTION" in
    update) ACTION="update-mod" ;;
  esac

  case "$ACTION" in
    ""|install|update-mod|update-target|install-radio|install-particles|uninstall|status) ;;
    *) die "--action must be install, update-mod, update-target, install-radio, install-particles, uninstall, or status" ;;
  esac
}

prompt_action() {
  [[ -z "$ACTION" ]] || return 0

  local choice=""
  cat <<'EOF'
Homepage Browser Editor Mod

Выберите действие:
  1) Установить
  2) Обновить мод из GitHub
  3) Обновить интеграцию в target из текущего каталога
  4) Установить радио (custom.css/custom.js)
  5) Установить эффекты фона particles
  6) Удалить
  7) Проверить статус
  8) Отмена
EOF

  while true; do
    if [[ -t 0 ]]; then
      read -r -p "Введите 1-8: " choice
    else
      read -r -p "Введите 1-8: " choice || die "Не выбрано действие."
    fi

    case "$choice" in
      1)
        ACTION="install"
        return 0
        ;;
      2)
        ACTION="update-mod"
        return 0
        ;;
      3)
        ACTION="update-target"
        return 0
        ;;
      4)
        ACTION="install-radio"
        return 0
        ;;
      5)
        ACTION="install-particles"
        return 0
        ;;
      6)
        ACTION="uninstall"
        return 0
        ;;
      7)
        ACTION="status"
        return 0
        ;;
      8)
        log "Отменено"
        exit 0
        ;;
      *)
        printf 'Введите 1, 2, 3, 4, 5, 6, 7 или 8.\n' >&2
        ;;
    esac
  done
}

is_homepage_target() {
  local candidate="$1"
  [[ -n "$candidate" && -f "$candidate/package.json" && -d "$candidate/src" ]]
}

systemd_workdir() {
  command -v systemctl >/dev/null 2>&1 || return 0

  local workdir=""
  workdir="$(systemctl show "$SERVICE_NAME" -p WorkingDirectory --value 2>/dev/null || true)"
  if [[ -n "$workdir" && "$workdir" != "/" ]]; then
    printf '%s\n' "$workdir"
    return 0
  fi

  systemctl cat "$SERVICE_NAME" 2>/dev/null | sed -n 's/^WorkingDirectory=//p' | tail -n 1 || true
}

find_target() {
  local candidates=()
  local workdir=""

  if [[ -n "$TARGET" ]]; then
    is_homepage_target "$TARGET" || die "$TARGET does not look like a gethomepage/homepage checkout"
    printf '%s\n' "$TARGET"
    return 0
  fi

  workdir="$(systemd_workdir)"
  candidates+=("$workdir" "/opt/homepage" "/app" "/usr/src/app" "$PWD")

  for candidate in "${candidates[@]}"; do
    if is_homepage_target "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

normalize_path() {
  local candidate="$1"

  if [[ "$candidate" == "~" ]]; then
    candidate="$HOME"
  elif [[ "$candidate" == "~/"* ]]; then
    candidate="$HOME/${candidate#~/}"
  fi

  printf '%s\n' "$candidate"
}

prompt_target() {
  local candidate=""

  cat >&2 <<'EOF'

Не удалось автоматически найти checkout Homepage.
Укажите путь к директории gethomepage/homepage, где есть package.json и src/.
Для отмены введите q.
EOF

  while true; do
    if [[ -t 0 ]]; then
      read -r -p "Путь к Homepage: " candidate
    else
      read -r -p "Путь к Homepage: " candidate || return 1
    fi

    case "$candidate" in
      4|q|Q|quit|exit)
        log "Отменено"
        exit 0
        ;;
    esac

    candidate="$(normalize_path "$candidate")"
    if is_homepage_target "$candidate"; then
      TARGET="$candidate"
      return 0
    fi

    printf 'Это не похоже на checkout Homepage: %s\n' "$candidate" >&2
  done
}

find_config_dir() {
  local candidate=""

  if [[ -n "$CONFIG_DIR" ]]; then
    CONFIG_DIR="$(normalize_path "$CONFIG_DIR")"
    printf '%s\n' "$CONFIG_DIR"
    return 0
  fi

  if [[ -n "$TARGET" && -e "$TARGET/config" ]]; then
    candidate="$(readlink -f "$TARGET/config" 2>/dev/null || true)"
    if [[ -n "$candidate" && -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi

    if [[ -d "$TARGET/config" ]]; then
      printf '%s\n' "$TARGET/config"
      return 0
    fi
  fi

  for candidate in "/srv/homepage-config" "$PWD/config"; do
    if [[ -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

prompt_config_dir() {
  local candidate=""
  local default_config_dir="/srv/homepage-config"

  cat >&2 <<'EOF'

Не удалось автоматически найти внешнюю папку config Homepage.
Укажите путь к директории, где лежат settings.yaml, services.yaml и custom.css/custom.js.
Если директории ещё нет, скрипт создаст её.
Для отмены введите q.
EOF

  while true; do
    if [[ -t 0 ]]; then
      read -r -p "Путь к config [$default_config_dir]: " candidate
    else
      read -r -p "Путь к config [$default_config_dir]: " candidate || return 1
    fi

    candidate="${candidate:-$default_config_dir}"

    case "$candidate" in
      7|q|Q|quit|exit)
        log "Отменено"
        exit 0
        ;;
    esac

    candidate="$(normalize_path "$candidate")"

    if [[ -e "$candidate" && ! -d "$candidate" ]]; then
      printf 'Это не директория: %s\n' "$candidate" >&2
      continue
    fi

    CONFIG_DIR="$candidate"
    return 0
  done
}

docker_homepage_containers() {
  command -v docker >/dev/null 2>&1 || return 0
  docker ps --format '{{.ID}} {{.Image}} {{.Names}}' 2>/dev/null | grep -Ei '(homepage|gethomepage)' || true
}

download_mod() {
  if [[ "$MOD_SOURCE_MODE" == "current" ]]; then
    if [[ -n "$MOD_DIR" ]]; then
      [[ -f "$MOD_DIR/install.mjs" && -f "$MOD_DIR/browser-editor.patch" && -d "$MOD_DIR/overlay" ]] \
        || die "Local mod checkout is missing in $MOD_DIR"
      log "Using mod source: $MOD_DIR (from HOMEPAGE_EDITOR_MOD_DIR)"
      return 0
    fi

    if [[ -f "$PWD/install.mjs" && -f "$PWD/browser-editor.patch" && -d "$PWD/overlay" ]]; then
      MOD_DIR="$PWD"
      log "Using mod source: $MOD_DIR (from current directory)"
      return 0
    fi

    die "update-target requires running from the mod repository root or setting HOMEPAGE_EDITOR_MOD_DIR"
  fi

  if [[ -n "$MOD_DIR" && "$MOD_SOURCE_MODE" != "remote" ]]; then
    [[ -f "$MOD_DIR/install.mjs" ]] || die "Mod installer is missing in $MOD_DIR"
    log "Using mod source: $MOD_DIR (from HOMEPAGE_EDITOR_MOD_DIR)"
    return 0
  fi

  if [[ "$MOD_SOURCE_MODE" != "remote" && -f "$PWD/install.mjs" && -f "$PWD/browser-editor.patch" && -d "$PWD/overlay" ]]; then
    MOD_DIR="$PWD"
    log "Using mod source: $MOD_DIR (from current directory)"
    return 0
  fi

  TMP_DIR="$(mktemp -d)"
  MOD_DIR="$TMP_DIR/homepage-editor"

  if command -v git >/dev/null 2>&1; then
    log "Downloading mod from $REPO_URL#$BRANCH"
    if git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$MOD_DIR" >/dev/null 2>&1; then
      log "Using mod source: $MOD_DIR (downloaded via git clone)"
      return 0
    fi
    log "git clone failed, trying tarball download"
    rm -rf "$MOD_DIR"
  fi

  command -v curl >/dev/null 2>&1 || die "curl is required when git is not available"
  command -v tar >/dev/null 2>&1 || die "tar is required when git is not available"

  mkdir -p "$MOD_DIR"
  curl -fsSL "https://github.com/Kemper51rus/homepage-editor/archive/refs/heads/${BRANCH}.tar.gz" \
    | tar -xz -C "$MOD_DIR" --strip-components=1
  log "Using mod source: $MOD_DIR (downloaded from GitHub tarball)"
}

require_node() {
  command -v node >/dev/null 2>&1 || die "node is required to run the mod installer"
}

require_git() {
  command -v git >/dev/null 2>&1 || die "git is required to apply or revert the core patch"
}

run_mod_installer() {
  require_node
  if [[ "$1" == "install" || "$1" == "uninstall" ]]; then
    require_git
  fi
  node "$MOD_DIR/install.mjs" "$1" --target "$TARGET"
}

config_owner() {
  stat -c "%U" "$CONFIG_DIR"
}

config_group() {
  stat -c "%G" "$CONFIG_DIR"
}

fix_config_ownership() {
  [[ "$(id -u)" -eq 0 ]] || return 0
  [[ -d "$CONFIG_DIR" ]] || return 0

  local owner group
  owner="$(config_owner)"
  group="$(config_group)"

  [[ -n "$owner" && "$owner" != "root" ]] || return 0
  [[ -n "$group" ]] || group="$owner"

  for path in "$CONFIG_DIR/custom.js" "$CONFIG_DIR/custom.css"; do
    [[ -e "$path" ]] && chown "$owner:$group" "$path"
  done
}

get_fragment_markers() {
  local source="$1"
  local start_marker end_marker

  start_marker="$(grep -m1 'HOMEPAGE-EDITOR .* START' "$source" || true)"
  end_marker="$(grep -m1 'HOMEPAGE-EDITOR .* END' "$source" || true)"

  [[ -n "$start_marker" && -n "$end_marker" ]] || die "Managed block markers are missing in $source"
  printf '%s\n%s\n' "$start_marker" "$end_marker"
}

upsert_fragment() {
  local source="$1"
  local target="$2"
  local tmp=""
  local markers=()
  local start_marker end_marker
  local target_existed=0

  mapfile -t markers < <(get_fragment_markers "$source")
  start_marker="${markers[0]}"
  end_marker="${markers[1]}"

  mkdir -p "$(dirname "$target")"
  [[ -f "$target" ]] && target_existed=1
  [[ -f "$target" ]] || : > "$target"

  tmp="$(mktemp)"

  if grep -Fqx "$start_marker" "$target" && grep -Fqx "$end_marker" "$target"; then
    awk -v start="$start_marker" -v end="$end_marker" -v replacement="$source" '
      BEGIN {
        skip = 0
        inserted = 0
      }
      $0 == start {
        if (!inserted) {
          while ((getline line < replacement) > 0) {
            print line
          }
          close(replacement)
          inserted = 1
        }
        skip = 1
        next
      }
      skip && $0 == end {
        skip = 0
        next
      }
      !skip {
        print
      }
    ' "$target" > "$tmp"
  else
    if [[ -s "$target" ]]; then
      cp -f "$target" "$tmp"
      printf '\n\n' >> "$tmp"
    fi
    cat "$source" >> "$tmp"
    printf '\n' >> "$tmp"
  fi

  if [[ "$target_existed" -eq 1 ]] && ! cmp -s "$tmp" "$target"; then
    cp -f "$target" "${target}.bak"
    log "Backup created: ${target}.bak"
  fi

  cp -f "$tmp" "$target"
  rm -f "$tmp"
}

install_custom_fragment_set() {
  local preset="$1"
  local source_dir="$MOD_DIR/custom-config/$preset"
  [[ -f "$source_dir/custom.js" && -f "$source_dir/custom.css" ]] \
    || die "Custom files are missing in $source_dir"

  mkdir -p "$CONFIG_DIR"

  upsert_fragment "$source_dir/custom.js" "$CONFIG_DIR/custom.js"
  upsert_fragment "$source_dir/custom.css" "$CONFIG_DIR/custom.css"

  fix_config_ownership
  log "Custom preset '$preset' installed into $CONFIG_DIR"
}

target_owner() {
  stat -c "%U" "$TARGET"
}

target_group() {
  stat -c "%G" "$TARGET"
}

run_in_target() {
  local owner
  owner="$(target_owner)"

  if [[ "$(id -u)" -eq 0 && "$owner" != "root" && "$(command -v sudo || true)" ]]; then
    (cd "$TARGET" && sudo -u "$owner" "$@")
    return
  fi

  (cd "$TARGET" && "$@")
}

fix_target_ownership() {
  [[ "$(id -u)" -eq 0 ]] || return 0

  local owner group path paths=()
  owner="$(target_owner)"
  group="$(target_group)"

  [[ -n "$owner" && "$owner" != "root" ]] || return 0
  [[ -n "$group" ]] || group="$owner"

  paths=(
    "$TARGET/.env.local"
    "$TARGET/.next"
    "$TARGET/src/mods/browser-editor"
    "$TARGET/src/pages/api/config/background.js"
    "$TARGET/src/pages/api/config/editor.js"
  )

  if [[ -f "$MOD_DIR/browser-editor.patch" ]] && command -v git >/dev/null 2>&1; then
    while IFS= read -r path; do
      [[ -n "$path" ]] && paths+=("$TARGET/$path")
    done < <(git apply --numstat "$MOD_DIR/browser-editor.patch" | awk -F '\t' '{print $NF}')
  fi

  for path in "${paths[@]}"; do
    if [[ -e "$path" ]]; then
      chown -R "$owner:$group" "$path"
    fi
  done
}

build_target() {
  [[ "$DO_BUILD" -eq 1 ]] || return 0
  [[ "$ACTION" == "install" || "$ACTION" == "update-mod" || "$ACTION" == "update-target" || "$ACTION" == "uninstall" ]] || return 0

  log "Building homepage in $TARGET"

  if [[ -f "$TARGET/pnpm-lock.yaml" && "$(command -v pnpm || true)" ]]; then
    run_in_target pnpm run build
    return 0
  fi

  if [[ -f "$TARGET/package-lock.json" && "$(command -v npm || true)" ]]; then
    run_in_target npm run build
    return 0
  fi

  if [[ -f "$TARGET/yarn.lock" && "$(command -v yarn || true)" ]]; then
    run_in_target yarn build
    return 0
  fi

  if command -v pnpm >/dev/null 2>&1; then
    run_in_target pnpm run build
    return 0
  fi

  if command -v npm >/dev/null 2>&1; then
    run_in_target npm run build
    return 0
  fi

  die "No supported package manager found. Install pnpm/npm or rerun with --no-build."
}

restart_target() {
  [[ "$DO_RESTART" -eq 1 ]] || return 0
  [[ "$ACTION" == "install" || "$ACTION" == "update-mod" || "$ACTION" == "update-target" || "$ACTION" == "uninstall" || "$ACTION" == "enable" || "$ACTION" == "disable" ]] || return 0
  command -v systemctl >/dev/null 2>&1 || return 0

  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    log "Restarting $SERVICE_NAME"
    systemctl restart "$SERVICE_NAME"
  fi
}

run_update() {
  log "Updating browser editor in $TARGET"
  run_mod_installer uninstall
  run_mod_installer install
  run_mod_installer enable
}

explain_docker_limit() {
  local containers="$1"

  cat >&2 <<EOF
[homepage-editor] Detected Docker Homepage container:
$containers

[homepage-editor] Standard gethomepage/homepage Docker containers do not contain a persistent writable source checkout.
[homepage-editor] This mod patches Homepage source files, so install it into a local gethomepage/homepage checkout or custom image source:

  HOMEPAGE_TARGET_DIR=/path/to/homepage bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-editor/main/install.sh)

[homepage-editor] After that, rebuild/restart your custom Docker image/container.
EOF
  exit 1
}

main() {
  parse_args "$@"
  prompt_action

  case "$ACTION" in
    update-mod)
      MOD_SOURCE_MODE="remote"
      ;;
    update-target)
      MOD_SOURCE_MODE="current"
      ;;
  esac

  download_mod

  if [[ "$ACTION" == "install-radio" || "$ACTION" == "install-particles" ]]; then
    local detected_target=""
    local detected_config=""
    local preset=""

    case "$ACTION" in
      install-radio) preset="radio" ;;
      install-particles) preset="particles" ;;
      *) die "Unknown custom preset action: $ACTION" ;;
    esac

    if detected_target="$(find_target)"; then
      TARGET="$detected_target"
      log "Using Homepage checkout: $TARGET"
    fi

    if detected_config="$(find_config_dir)"; then
      CONFIG_DIR="$detected_config"
      log "Using Homepage config dir: $CONFIG_DIR"
    elif prompt_config_dir; then
      log "Using Homepage config dir: $CONFIG_DIR"
    else
      die "Homepage config directory was not found. Pass --config-dir /path/to/config or set HOMEPAGE_CONFIG_DIR."
    fi

    install_custom_fragment_set "$preset"
    log "Done"
    return 0
  fi

  local detected_target=""
  if detected_target="$(find_target)"; then
    TARGET="$detected_target"
    log "Using Homepage checkout: $TARGET"
  elif prompt_target; then
    log "Using Homepage checkout: $TARGET"
  else
    local containers=""
    containers="$(docker_homepage_containers)"
    if [[ "$MODE" == "docker" || -n "$containers" ]]; then
      explain_docker_limit "$containers"
    fi
    die "Homepage checkout was not found. Pass --target /path/to/homepage or set HOMEPAGE_TARGET_DIR."
  fi

  case "$ACTION" in
    install)
      run_mod_installer install
      run_mod_installer enable
      ;;
    update-mod|update-target)
      run_update
      ;;
    uninstall)
      run_mod_installer uninstall
      ;;
    enable)
      run_mod_installer enable
      ;;
    disable)
      run_mod_installer disable
      ;;
    status)
      run_mod_installer status
      ;;
  esac

  if [[ "$ACTION" == "install" || "$ACTION" == "update-mod" || "$ACTION" == "update-target" || "$ACTION" == "uninstall" ]]; then
    fix_target_ownership
  fi
  build_target
  if [[ "$ACTION" == "install" || "$ACTION" == "update-mod" || "$ACTION" == "update-target" || "$ACTION" == "uninstall" ]]; then
    fix_target_ownership
  fi
  restart_target
  log "Done"
}

main "$@"
