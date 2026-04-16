#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${HOMEPAGE_EDITOR_REPO:-https://github.com/Kemper51rus/homepage-editor.git}"
BRANCH="${HOMEPAGE_EDITOR_BRANCH:-main}"
SERVICE_NAME="${HOMEPAGE_SERVICE_NAME:-homepage.service}"

ACTION=""
MODE="${HOMEPAGE_EDITOR_MODE:-auto}"
TARGET="${HOMEPAGE_TARGET_DIR:-}"
DO_BUILD=1
DO_RESTART=1
TMP_DIR=""
MOD_DIR="${HOMEPAGE_EDITOR_MOD_DIR:-}"

usage() {
  cat <<'EOF'
Установщик Homepage Browser Editor Mod

Использование:
  bash install.sh [options]

После запуска скрипт спросит, что сделать.

Параметры:
  --target PATH       путь к checkout gethomepage/homepage
  --mode MODE         auto, local или docker
  --repo URL          git-репозиторий мода
  --branch NAME       ветка мода
  --no-build          не запускать сборку после установки/удаления
  --no-restart        не перезапускать homepage.service после установки/удаления
  -h, --help          показать эту справку

Переменные окружения:
  HOMEPAGE_TARGET_DIR       то же самое, что --target
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
      --target)
        [[ $# -ge 2 ]] || die "--target requires a path"
        TARGET="$2"
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
}

prompt_action() {
  [[ -z "$ACTION" ]] || return 0

  local choice=""
  cat <<'EOF'
Homepage Browser Editor Mod

Выберите действие:
  1) Установить
  2) Удалить
  3) Проверить статус
  4) Отмена
EOF

  while true; do
    if [[ -t 0 ]]; then
      read -r -p "Введите 1-4: " choice
    else
      read -r -p "Введите 1-4: " choice || die "Не выбрано действие."
    fi

    case "$choice" in
      1)
        ACTION="install"
        return 0
        ;;
      2)
        ACTION="uninstall"
        return 0
        ;;
      3)
        ACTION="status"
        return 0
        ;;
      4)
        log "Отменено"
        exit 0
        ;;
      *)
        printf 'Введите 1, 2, 3 или 4.\n' >&2
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

docker_homepage_containers() {
  command -v docker >/dev/null 2>&1 || return 0
  docker ps --format '{{.ID}} {{.Image}} {{.Names}}' 2>/dev/null | grep -Ei '(homepage|gethomepage)' || true
}

download_mod() {
  if [[ -n "$MOD_DIR" ]]; then
    [[ -f "$MOD_DIR/install.mjs" ]] || die "Mod installer is missing in $MOD_DIR"
    return 0
  fi

  if [[ -f "$PWD/install.mjs" && -f "$PWD/browser-editor.patch" && -d "$PWD/overlay" ]]; then
    MOD_DIR="$PWD"
    return 0
  fi

  TMP_DIR="$(mktemp -d)"
  MOD_DIR="$TMP_DIR/homepage-editor"

  if command -v git >/dev/null 2>&1; then
    log "Downloading mod from $REPO_URL#$BRANCH"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$MOD_DIR" >/dev/null 2>&1 && return 0
    log "git clone failed, trying tarball download"
    rm -rf "$MOD_DIR"
  fi

  command -v curl >/dev/null 2>&1 || die "curl is required when git is not available"
  command -v tar >/dev/null 2>&1 || die "tar is required when git is not available"

  mkdir -p "$MOD_DIR"
  curl -fsSL "https://github.com/Kemper51rus/homepage-editor/archive/refs/heads/${BRANCH}.tar.gz" \
    | tar -xz -C "$MOD_DIR" --strip-components=1
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

build_target() {
  [[ "$DO_BUILD" -eq 1 ]] || return 0
  [[ "$ACTION" == "install" || "$ACTION" == "uninstall" ]] || return 0

  log "Building homepage in $TARGET"

  if [[ -f "$TARGET/pnpm-lock.yaml" && "$(command -v pnpm || true)" ]]; then
    (cd "$TARGET" && pnpm build)
    return 0
  fi

  if [[ -f "$TARGET/package-lock.json" && "$(command -v npm || true)" ]]; then
    (cd "$TARGET" && npm run build)
    return 0
  fi

  if [[ -f "$TARGET/yarn.lock" && "$(command -v yarn || true)" ]]; then
    (cd "$TARGET" && yarn build)
    return 0
  fi

  if command -v pnpm >/dev/null 2>&1; then
    (cd "$TARGET" && pnpm build)
    return 0
  fi

  if command -v npm >/dev/null 2>&1; then
    (cd "$TARGET" && npm run build)
    return 0
  fi

  die "No supported package manager found. Install pnpm/npm or rerun with --no-build."
}

restart_target() {
  [[ "$DO_RESTART" -eq 1 ]] || return 0
  [[ "$ACTION" == "install" || "$ACTION" == "uninstall" || "$ACTION" == "enable" || "$ACTION" == "disable" ]] || return 0
  command -v systemctl >/dev/null 2>&1 || return 0

  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    log "Restarting $SERVICE_NAME"
    systemctl restart "$SERVICE_NAME"
  fi
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
  download_mod

  if TARGET="$(find_target)"; then
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

  build_target
  restart_target
  log "Done"
}

main "$@"
