#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${HOMEPAGE_EDITOR_REPO:-https://github.com/Kemper51rus/homepage-configurator.git}"
BRANCH="${HOMEPAGE_EDITOR_BRANCH:-main}"
SERVICE_NAME="${HOMEPAGE_SERVICE_NAME:-homepage.service}"

ACTION=""
MODE="${HOMEPAGE_EDITOR_MODE:-auto}"
TARGET="${HOMEPAGE_TARGET_DIR:-}"
CONFIG_DIR="${HOMEPAGE_CONFIG_DIR:-}"
IMAGES_DIR="${HOMEPAGE_IMAGES_DIR:-${IMAGES_REAL_DIR:-}}"
CUSTOM_INSTALL="${HOMEPAGE_EDITOR_CUSTOM_INSTALL:-all}"
CUSTOM_CLEAN="${HOMEPAGE_EDITOR_CLEAN_CUSTOM:-prompt}"
DO_BUILD=1
DO_RESTART=1
TMP_DIR=""
MOD_DIR="${HOMEPAGE_EDITOR_MOD_DIR:-}"
MOD_SOURCE_MODE="auto"
RADIO_ASSETS_INSTALLED=0
CUSTOM_CLEAN_CHECKED=0

usage() {
  cat <<'EOF'
Установщик Homepage configurator

Использование:
  bash install.sh [options]

После запуска скрипт спросит, что сделать.

Параметры:
  --action NAME      install, update, update-target, uninstall или status
  --target PATH       путь к checkout gethomepage/homepage
  --config-dir PATH   путь к внешней папке config Homepage
  --images-dir PATH   путь к папке, которая отдается Homepage как /images
  --custom MODE       что ставить после install/update: all или skip
  --clean-custom MODE что делать с содержимым вне managed-блоков: prompt, keep или delete
  --mode MODE         auto, local или docker
  --repo URL          git-репозиторий мода
  --branch NAME       ветка мода
  --no-build          не запускать сборку после установки/обновления/удаления
  --no-restart        не перезапускать homepage.service после установки/обновления/удаления
  -h, --help          показать эту справку

Переменные окружения:
  HOMEPAGE_TARGET_DIR       то же самое, что --target
  HOMEPAGE_CONFIG_DIR       то же самое, что --config-dir
  HOMEPAGE_IMAGES_DIR       то же самое, что --images-dir; можно также задать IMAGES_REAL_DIR
  HOMEPAGE_EDITOR_CUSTOM_INSTALL
                            all или skip для custom.css/custom.js дополнений
  HOMEPAGE_EDITOR_CLEAN_CUSTOM
                            prompt, keep или delete для содержимого вне managed-блоков
  HOMEPAGE_EDITOR_MOD_DIR   использовать уже скачанную директорию мода
  HOMEPAGE_SERVICE_NAME     имя systemd-сервиса, по умолчанию homepage.service
EOF
}

log() {
  printf '[homepage-configurator] %s\n' "$*"
}

wait_for_homepage() {
  command -v curl >/dev/null 2>&1 || return 0

  local port="${HOMEPAGE_PORT:-3000}"
  local url="http://127.0.0.1:${port}/"
  local attempt=1

  while [[ "$attempt" -le 30 ]]; do
    if curl -fsS -o /dev/null "$url" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  die "$SERVICE_NAME restarted, but $url did not become ready"
}

die() {
  printf '[homepage-configurator] ERROR: %s\n' "$*" >&2
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
        [[ $# -ge 2 ]] || die "--action requires install, update, update-target, uninstall, or status"
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
      --images-dir)
        [[ $# -ge 2 ]] || die "--images-dir requires a path"
        IMAGES_DIR="$2"
        shift 2
        ;;
      --custom)
        [[ $# -ge 2 ]] || die "--custom requires all or skip"
        CUSTOM_INSTALL="$2"
        shift 2
        ;;
      --clean-custom)
        [[ $# -ge 2 ]] || die "--clean-custom requires prompt, keep, or delete"
        CUSTOM_CLEAN="$2"
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
    update|update-mod) ACTION="update-mod" ;;
  esac

  case "$ACTION" in
    ""|install|update-mod|update-target|uninstall|status) ;;
    *) die "--action must be install, update, update-target, uninstall, or status" ;;
  esac

  case "$CUSTOM_INSTALL" in
    skip|none|all) ;;
    prompt|cards|extras|radio|particles)
      die "--custom $CUSTOM_INSTALL больше не поддерживается. Используйте --custom all или --custom skip."
      ;;
    *) die "--custom must be all or skip" ;;
  esac

  case "$CUSTOM_CLEAN" in
    prompt|keep|delete) ;;
    *) die "--clean-custom must be prompt, keep, or delete" ;;
  esac
}

prompt_action() {
  [[ -z "$ACTION" ]] || return 0

  local choice=""
  cat <<'EOF'
Homepage configurator

Выберите действие:
  1) Установить
  2) Обновить мод из GitHub
  3) Обновить интеграцию в target из текущего каталога
  4) Удалить
  5) Проверить статус
  6) Отмена
EOF

  while true; do
    if [[ -t 0 ]]; then
      read -r -p "Введите 1-6: " choice
    else
      read -r -p "Введите 1-6: " choice || die "Не выбрано действие."
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
        ACTION="uninstall"
        return 0
        ;;
      5)
        ACTION="status"
        return 0
        ;;
      6)
        log "Отменено"
        exit 0
        ;;
      *)
        printf 'Введите число от 1 до 6.\n' >&2
        ;;
    esac
  done
}

is_homepage_target() {
  local candidate="$1"
  [[ -n "$candidate" ]] || return 1
  [[ -f "$candidate/package.json" && -d "$candidate/src" ]] || return 1
  [[ -f "$candidate/next.config.js" ]] || return 1
  [[ -f "$candidate/src/pages/index.jsx" ]] || return 1
  [[ -f "$candidate/src/components/services/group.jsx" ]] || return 1
  [[ -f "$candidate/src/components/bookmarks/group.jsx" ]] || return 1
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
  elif [[ "$candidate" == \~/* ]]; then
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
      q|Q|quit|exit)
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

env_file_value() {
  local file="$1"
  local key="$2"
  local value=""

  [[ -f "$file" ]] || return 1

  value="$(grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true)"
  [[ -n "$value" ]] || return 1

  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"

  printf '%s\n' "$value"
}

find_images_dir() {
  local candidate=""
  local file=""
  local key=""

  if [[ -n "$IMAGES_DIR" ]]; then
    IMAGES_DIR="$(normalize_path "$IMAGES_DIR")"
    printf '%s\n' "$IMAGES_DIR"
    return 0
  fi

  for file in "$TARGET/.env.local" "$TARGET/.env" "/etc/default/homepage"; do
    for key in "IMAGES_REAL_DIR" "HOMEPAGE_IMAGES_DIR"; do
      if candidate="$(env_file_value "$file" "$key")"; then
        printf '%s\n' "$(normalize_path "$candidate")"
        return 0
      fi
    done
  done

  if [[ -n "$CONFIG_DIR" ]]; then
    candidate="$(dirname "$CONFIG_DIR")/homepage-images"
    if [[ "$(basename "$CONFIG_DIR")" == "homepage-config" && -d "$(dirname "$CONFIG_DIR")" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  if [[ -n "$TARGET" ]]; then
    if [[ -d "$TARGET/public" ]]; then
      printf '%s\n' "$TARGET/public/images"
      return 0
    fi

    if [[ -d "$TARGET/.next/standalone/public" ]]; then
      printf '%s\n' "$TARGET/.next/standalone/public/images"
      return 0
    fi
  fi

  if [[ -d "/srv/homepage-images" ]]; then
    printf '%s\n' "/srv/homepage-images"
    return 0
  fi

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
      q|Q|quit|exit)
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
  MOD_DIR="$TMP_DIR/homepage-configurator"

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
  curl -fsSL "https://github.com/Kemper51rus/homepage-configurator/archive/refs/heads/${BRANCH}.tar.gz" \
    | tar -xz -C "$MOD_DIR" --strip-components=1
  log "Using mod source: $MOD_DIR (downloaded from GitHub tarball)"
}

require_node() {
  command -v node >/dev/null 2>&1 || die "node is required to run the mod installer"
}

require_git() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi

  if [[ "$(id -u)" -eq 0 && "$(command -v apt-get || true)" ]]; then
    log "Installing git for core patch support"
    DEBIAN_FRONTEND=noninteractive apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y git
  fi

  command -v git >/dev/null 2>&1 || die "git is required to apply or revert the core patch. Install git or run install.sh as root on a Debian/Ubuntu-based LXC."
}

run_mod_installer() {
  require_node
  if [[ "$1" == "install" || "$1" == "uninstall" ]]; then
    require_git
  fi
  node "$MOD_DIR/install.mjs" "$@" --target "$TARGET"
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

fix_radio_assets_ownership() {
  local images_dir="$1"
  local owner=""
  local group=""
  local real_images_dir=""

  [[ "$(id -u)" -eq 0 ]] || return 0

  real_images_dir="$(readlink -f "$images_dir" 2>/dev/null || true)"
  [[ -n "$real_images_dir" && -d "$real_images_dir" ]] || return 0

  owner="$(stat -Lc "%U" "$real_images_dir")"
  group="$(stat -Lc "%G" "$real_images_dir")"

  [[ -n "$owner" && "$owner" != "root" ]] || return 0
  [[ -n "$group" ]] || group="$owner"

  chown -R "$owner:$group" "$real_images_dir/radio"
}

install_radio_assets() {
  [[ "$RADIO_ASSETS_INSTALLED" -eq 0 ]] || return 0

  local source_dir="$MOD_DIR/custom-config/radio/assets/radio"
  local images_dir=""
  local radio_dir=""

  [[ -d "$source_dir" ]] || die "Radio assets are missing: $source_dir"

  if ! images_dir="$(find_images_dir)"; then
    die "Homepage images directory was not found. Pass --images-dir /path/to/images or set HOMEPAGE_IMAGES_DIR/IMAGES_REAL_DIR."
  fi

  mkdir -p "$images_dir/radio"
  radio_dir="$(readlink -f "$images_dir/radio" 2>/dev/null || printf '%s\n' "$images_dir/radio")"

  cp -f "$source_dir"/* "$radio_dir/"
  chmod 0644 "$radio_dir"/*
  fix_radio_assets_ownership "$images_dir"

  RADIO_ASSETS_INSTALLED=1
  log "Radio assets installed into $radio_dir"
}

custom_file_has_unmanaged_content() {
  local file="$1"

  [[ -f "$file" ]] || return 1

  awk '
    /HOMEPAGE-EDITOR .* START/ {
      skip = 1
      next
    }
    /HOMEPAGE-EDITOR .* END/ {
      skip = 0
      next
    }
    !skip && $0 !~ /^[[:space:]]*$/ {
      found = 1
      exit
    }
    END {
      exit found ? 0 : 1
    }
  ' "$file"
}

print_unmanaged_preview() {
  local file="$1"

  awk '
    /HOMEPAGE-EDITOR .* START/ {
      skip = 1
      next
    }
    /HOMEPAGE-EDITOR .* END/ {
      skip = 0
      next
    }
    !skip && $0 !~ /^[[:space:]]*$/ {
      line = $0
      if (length(line) > 120) {
        line = substr(line, 1, 117) "..."
      }
      printf "      %d: %s\n", NR, line
      count += 1
      if (count >= 8) {
        exit
      }
    }
  ' "$file"
}

backup_file_for_cleanup() {
  local target="$1"
  local backup=""

  [[ -f "$target" ]] || return 0

  backup="${target}.cleanup-$(date +%Y%m%d-%H%M%S).bak"
  cp -f "$target" "$backup"
  log "Backup created: $backup"
}

delete_unmanaged_custom_files() {
  local file=""

  for file in "$@"; do
    backup_file_for_cleanup "$file"
    rm -f "$file"
    log "Removed custom file with unmanaged content: $file"
  done
}

prompt_clean_unmanaged_custom_files() {
  [[ "$CUSTOM_CLEAN_CHECKED" -eq 0 ]] || return 0
  CUSTOM_CLEAN_CHECKED=1

  local files=()
  local file=""
  local answer=""

  for file in "$CONFIG_DIR/custom.css" "$CONFIG_DIR/custom.js"; do
    if custom_file_has_unmanaged_content "$file"; then
      files+=("$file")
    fi
  done

  [[ "${#files[@]}" -gt 0 ]] || return 0

  case "$CUSTOM_CLEAN" in
    delete)
      log "Found unmanaged custom content; deleting selected custom files after backup"
      delete_unmanaged_custom_files "${files[@]}"
      return 0
      ;;
    keep)
      log "Keeping unmanaged custom content outside managed blocks"
      return 0
      ;;
  esac

  if [[ ! -t 0 ]]; then
    log "Keeping unmanaged custom content outside managed blocks (non-interactive run)"
    return 0
  fi

  cat >&2 <<'EOF'

Найдены строки вне HOMEPAGE-EDITOR managed-блоков.
Они не обновляются автоматически и могут дублировать текущие presets.
EOF

  for file in "${files[@]}"; do
    printf '  - %s\n' "$file" >&2
    print_unmanaged_preview "$file" >&2
  done

  cat >&2 <<'EOF'

Удалить эти custom.css/custom.js перед установкой полного managed-набора?
Будет создан .cleanup-*.bak backup. После удаления install.sh пересоздаст managed-блоки.
EOF

  read -r -p "Удалить custom-файлы с содержимым вне managed-блоков? [y/N]: " answer
  case "$answer" in
    y|Y|yes|YES)
      delete_unmanaged_custom_files "${files[@]}"
      ;;
    *)
      log "Keeping unmanaged custom content outside managed blocks"
      ;;
  esac
}

get_fragment_markers() {
  local source="$1"
  local start_marker end_marker

  start_marker="$(grep -m1 'HOMEPAGE-EDITOR .* START' "$source" || true)"
  end_marker="$(grep -m1 'HOMEPAGE-EDITOR .* END' "$source" || true)"

  [[ -n "$start_marker" && -n "$end_marker" ]] || die "Managed block markers are missing in $source"
  printf '%s\n%s\n' "$start_marker" "$end_marker"
}

backup_file_once() {
  local target="$1"

  [[ -f "$target" ]] || return 0

  if [[ -e "${target}.bak" ]]; then
    log "Backup already exists, keeping: ${target}.bak"
    return 0
  fi

  cp -f "$target" "${target}.bak"
  log "Backup created: ${target}.bak"
}

remove_legacy_color_cards_css() {
  local target="$1"
  local tmp=""

  [[ -f "$target" ]] || return 0
  grep -Fq "HOMEPAGE-EDITOR COLOR CARDS CSS START" "$target" && return 0
  grep -q '^\[id\^="color-' "$target" || return 0
  grep -q '^\.service-card,[[:space:]]*$' "$target" || return 0

  tmp="$(mktemp)"

  if awk '
    BEGIN {
      skip = 0
      removed = 0
    }
    !skip && $0 ~ /^\.service-card,[[:space:]]*$/ {
      skip = 1
      removed = 1
      next
    }
    skip && $0 ~ /^\/\* --- STATUS & PING BADGE POSITIONING --- \*\// {
      skip = 0
      print
      next
    }
    !skip {
      print
    }
    END {
      if (skip || !removed) {
        exit 1
      }
    }
  ' "$target" > "$tmp"; then
    backup_file_once "$target"
    cp -f "$tmp" "$target"
    log "Legacy unmarked color-card CSS block migrated in $target"
  fi

  rm -f "$tmp"
}

remove_legacy_custom_extras_css() {
  local target="$1"
  local tmp=""

  [[ -f "$target" ]] || return 0
  grep -Fq "HOMEPAGE-EDITOR CUSTOM EXTRAS CSS START" "$target" && return 0
  grep -q '^/\* --- TAB NAVIGATION --- \*/' "$target" || return 0

  tmp="$(mktemp)"

  if awk '
    BEGIN {
      skip = 0
      removed = 0
    }
    !skip && $0 ~ /^\/\* --- TAB NAVIGATION --- \*\// {
      skip = 1
      removed = 1
      next
    }
    skip && $0 ~ /^\/\* >>> HOMEPAGE-EDITOR COLOR CARDS CSS START >>> \*\// {
      skip = 0
      print
      next
    }
    !skip {
      print
    }
    END {
      if (!removed) {
        exit 1
      }
    }
  ' "$target" > "$tmp"; then
    backup_file_once "$target"
    cp -f "$tmp" "$target"
    log "Legacy unmarked custom extras CSS block migrated in $target"
  fi

  rm -f "$tmp"
}

remove_legacy_particles_fragment() {
  local target="$1"
  local tmp=""

  [[ -f "$target" ]] || return 0
  grep -Fq "HOMEPAGE-EDITOR PARTICLES" "$target" && return 0
  grep -Fq "START OF OLD /srv/start TRANSFER: INTERACTIVE BACKGROUND + FPS BUTTON" "$target" || return 0

  tmp="$(mktemp)"

  if awk '
    BEGIN {
      skip = 0
      removed = 0
    }
    !skip && $0 ~ /START OF OLD \/srv\/start TRANSFER: INTERACTIVE BACKGROUND \+ FPS BUTTON/ {
      skip = 1
      removed = 1
      next
    }
    skip && $0 ~ /END OF OLD \/srv\/start TRANSFER: INTERACTIVE BACKGROUND \+ FPS BUTTON/ {
      skip = 0
      next
    }
    !skip {
      print
    }
    END {
      if (skip || !removed) {
        exit 1
      }
    }
  ' "$target" > "$tmp"; then
    backup_file_once "$target"
    cp -f "$tmp" "$target"
    log "Legacy unmarked particles/FPS block migrated in $target"
  fi

  rm -f "$tmp"
}

remove_legacy_radio_js() {
  local target="$1"
  local tmp=""

  [[ -f "$target" ]] || return 0
  head -n 1 "$target" | grep -Fq "(function homepageRadioWidget() {" || return 0

  tmp="$(mktemp)"

  if awk '
    BEGIN {
      skip = 0
      removed = 0
    }
    NR == 1 && $0 ~ /^\(function homepageRadioWidget\(\) \{/ {
      skip = 1
      removed = 1
      next
    }
    skip && $0 == "})();" {
      skip = 0
      next
    }
    !skip {
      print
    }
    END {
      if (skip || !removed) {
        exit 1
      }
    }
  ' "$target" > "$tmp"; then
    backup_file_once "$target"
    cp -f "$tmp" "$target"
    log "Legacy unmarked radio JS block migrated in $target"
  fi

  rm -f "$tmp"
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
    backup_file_once "$target"
  fi

  cp -f "$tmp" "$target"
  rm -f "$tmp"
}

install_custom_fragment_set() {
  local preset="$1"
  local source_dir="$MOD_DIR/custom-config/$preset"
  local installed=0

  [[ -d "$source_dir" ]] || die "Custom preset is missing: $source_dir"
  [[ -f "$source_dir/custom.js" || -f "$source_dir/custom.css" ]] \
    || die "Custom files are missing in $source_dir"

  mkdir -p "$CONFIG_DIR"

  if [[ -f "$source_dir/custom.js" ]]; then
    if [[ "$preset" == "particles" ]]; then
      remove_legacy_particles_fragment "$CONFIG_DIR/custom.js"
    elif [[ "$preset" == "radio" ]]; then
      remove_legacy_radio_js "$CONFIG_DIR/custom.js"
    fi
    upsert_fragment "$source_dir/custom.js" "$CONFIG_DIR/custom.js"
    installed=1
  fi

  if [[ -f "$source_dir/custom.css" ]]; then
    if [[ "$preset" == "cards" ]]; then
      remove_legacy_color_cards_css "$CONFIG_DIR/custom.css"
    elif [[ "$preset" == "extras" ]]; then
      remove_legacy_custom_extras_css "$CONFIG_DIR/custom.css"
    elif [[ "$preset" == "particles" ]]; then
      remove_legacy_particles_fragment "$CONFIG_DIR/custom.css"
    fi
    upsert_fragment "$source_dir/custom.css" "$CONFIG_DIR/custom.css"
    installed=1
  fi

  [[ "$installed" -eq 1 ]] || die "Custom preset '$preset' has no installable files"

  if [[ "$preset" == "radio" || "$preset" == "particles" ]]; then
    install_radio_assets
  fi

  fix_config_ownership
  log "Custom preset '$preset' installed into $CONFIG_DIR"
}

install_custom_presets() {
  local preset=""

  prompt_clean_unmanaged_custom_files

  for preset in "$@"; do
    install_custom_fragment_set "$preset"
  done
}

ensure_config_dir() {
  local detected_config=""

  if detected_config="$(find_config_dir)"; then
    CONFIG_DIR="$detected_config"
    log "Using Homepage config dir: $CONFIG_DIR"
  elif prompt_config_dir; then
    log "Using Homepage config dir: $CONFIG_DIR"
  else
    die "Homepage config directory was not found. Pass --config-dir /path/to/config or set HOMEPAGE_CONFIG_DIR."
  fi
}

install_requested_custom() {
  case "$CUSTOM_INSTALL" in
    all)
      ensure_config_dir
      install_custom_presets cards extras radio particles
      ;;
    skip|none)
      log "Custom additions skipped"
      ;;
  esac
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
    "$TARGET/.env"
    "$TARGET/.env.local"
    "$TARGET/.next"
    "$TARGET/package.json"
    "$TARGET/pnpm-lock.yaml"
    "$TARGET/package-lock.json"
    "$TARGET/yarn.lock"
    "$TARGET/src/mods/browser-editor"
    "$TARGET/src/pages/api/config/background.js"
    "$TARGET/src/pages/api/config/editor.js"
    "$TARGET/src/pages/api/config/icon"
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

ensure_target_dependencies() {
  [[ "$ACTION" == "install" || "$ACTION" == "update-mod" || "$ACTION" == "update-target" ]] || return 0
  [[ -f "$TARGET/package.json" ]] || return 0
  local dependency="" missing=0

  for dependency in prismjs react-simple-code-editor; do
    grep -Fq "\"$dependency\"" "$TARGET/package.json" || continue
    if ! run_in_target node -e "require.resolve('$dependency/package.json')" >/dev/null 2>&1; then
      missing=1
      break
    fi
  done

  [[ "$missing" -eq 1 ]] || return 0

  log "Installing missing target dependencies in $TARGET"

  if [[ -f "$TARGET/pnpm-lock.yaml" && "$(command -v pnpm || true)" ]]; then
    run_in_target pnpm install --no-frozen-lockfile
    return 0
  fi

  if [[ -f "$TARGET/package-lock.json" && "$(command -v npm || true)" ]]; then
    run_in_target npm install
    return 0
  fi

  if [[ -f "$TARGET/yarn.lock" && "$(command -v yarn || true)" ]]; then
    run_in_target yarn install
    return 0
  fi

  if command -v pnpm >/dev/null 2>&1; then
    run_in_target pnpm install --no-frozen-lockfile
    return 0
  fi

  if command -v npm >/dev/null 2>&1; then
    run_in_target npm install
    return 0
  fi

  die "No supported package manager found to install missing target dependencies."
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

sync_standalone_assets() {
  [[ -n "$TARGET" && -d "$TARGET/.next/standalone" ]] || return 0

  local standalone="$TARGET/.next/standalone"
  local owner=""
  local group=""
  local chown_paths=()

  log "Syncing standalone runtime assets"

  if [[ -d "$TARGET/.next/static" ]]; then
    mkdir -p "$standalone/.next"
    rm -rf -- "$standalone/.next/static"
    cp -a "$TARGET/.next/static" "$standalone/.next/static"
    chown_paths+=("$standalone/.next/static")
  fi

  if [[ -d "$TARGET/public" ]]; then
    rm -rf -- "$standalone/public"
    cp -a "$TARGET/public" "$standalone/public"
    chown_paths+=("$standalone/public")
  fi

  if [[ "$(id -u)" -eq 0 && "${#chown_paths[@]}" -gt 0 ]]; then
    owner="$(target_owner)"
    group="$(target_group)"
    [[ -n "$group" ]] || group="$owner"
    chown -R "$owner:$group" "${chown_paths[@]}" 2>/dev/null || true
  fi
}

action_restarts_service() {
  case "$ACTION" in
    install|update-mod|update-target|uninstall)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

restart_target() {
  [[ "$DO_RESTART" -eq 1 ]] || return 0
  action_restarts_service || return 0
  command -v systemctl >/dev/null 2>&1 || return 0

  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    log "Restarting $SERVICE_NAME"
    systemctl restart "$SERVICE_NAME"
    wait_for_homepage
  fi
}

run_update() {
  log "Updating browser editor in $TARGET"
  run_mod_installer install
  run_mod_installer enable
}

explain_docker_limit() {
  local containers="$1"

  cat >&2 <<EOF
[homepage-configurator] Detected Docker Homepage container:
$containers

[homepage-configurator] Standard gethomepage/homepage Docker containers do not contain a persistent writable source checkout.
[homepage-configurator] This mod patches Homepage source files, so install it into a local gethomepage/homepage checkout or custom image source:

  HOMEPAGE_TARGET_DIR=/path/to/homepage bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-configurator/main/install.sh)

[homepage-configurator] After that, rebuild/restart your custom Docker image/container.
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
    status)
      run_mod_installer status
      ;;
  esac

  if [[ "$ACTION" == "install" || "$ACTION" == "update-mod" || "$ACTION" == "update-target" || "$ACTION" == "uninstall" ]]; then
    fix_target_ownership
  fi
  ensure_target_dependencies

  if [[ "$ACTION" == "install" || "$ACTION" == "update-mod" || "$ACTION" == "update-target" ]]; then
    install_requested_custom
  fi

  build_target
  sync_standalone_assets
  if [[ "$ACTION" == "install" || "$ACTION" == "update-mod" || "$ACTION" == "update-target" || "$ACTION" == "uninstall" ]]; then
    fix_target_ownership
  fi

  restart_target
  log "Done"
}

main "$@"
