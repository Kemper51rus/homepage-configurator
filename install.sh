#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${HOMEPAGE_EDITOR_REPO:-https://github.com/Kemper51rus/homepage-configurator.git}"
BRANCH="${HOMEPAGE_EDITOR_BRANCH:-main}"
SERVICE_NAME="${HOMEPAGE_SERVICE_NAME:-homepage.service}"

ACTION=""
MODE="${HOMEPAGE_EDITOR_MODE:-auto}"
TARGET="${HOMEPAGE_TARGET_DIR:-}"
CONFIG_DIR="${HOMEPAGE_CONFIG_DIR:-}"
CUSTOM_INSTALL="${HOMEPAGE_EDITOR_CUSTOM_INSTALL:-prompt}"
DO_BUILD=1
DO_RESTART=1
TMP_DIR=""
MOD_DIR="${HOMEPAGE_EDITOR_MOD_DIR:-}"
MOD_SOURCE_MODE="auto"

usage() {
  cat <<'EOF'
Установщик Homepage configurator

Использование:
  bash install.sh [options]

После запуска скрипт спросит, что сделать.

Параметры:
  --action NAME      install, update-mod, update-target, install-cards, install-extras, install-radio, install-particles, install-custom, uninstall или status
  --target PATH       путь к checkout gethomepage/homepage
  --config-dir PATH   путь к внешней папке config Homepage
  --custom MODE       что ставить после install/update: prompt, skip, cards, extras или all
  --mode MODE         auto, local или docker
  --repo URL          git-репозиторий мода
  --branch NAME       ветка мода
  --no-build          не запускать сборку после установки/обновления/удаления
  --no-restart        не перезапускать homepage.service после установки/обновления/удаления
  -h, --help          показать эту справку

Переменные окружения:
  HOMEPAGE_TARGET_DIR       то же самое, что --target
  HOMEPAGE_CONFIG_DIR       то же самое, что --config-dir
  HOMEPAGE_EDITOR_CUSTOM_INSTALL
                            prompt, skip, cards, extras или all для custom.css/custom.js дополнений
  HOMEPAGE_EDITOR_MOD_DIR   использовать уже скачанную директорию мода
  HOMEPAGE_SERVICE_NAME     имя systemd-сервиса, по умолчанию homepage.service
EOF
}

log() {
  printf '[homepage-configurator] %s\n' "$*"
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
      --custom)
        [[ $# -ge 2 ]] || die "--custom requires prompt, skip, cards, extras, or all"
        CUSTOM_INSTALL="$2"
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
    ""|install|update-mod|update-target|install-cards|install-extras|install-radio|install-particles|install-custom|uninstall|status) ;;
    *) die "--action must be install, update-mod, update-target, install-cards, install-extras, install-radio, install-particles, install-custom, uninstall, or status" ;;
  esac

  case "$CUSTOM_INSTALL" in
    prompt|skip|none|cards|extras|all) ;;
    *) die "--custom must be prompt, skip, cards, extras, or all" ;;
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

  -----------------------------
  Через custom.css/custom.js:
  4) Установить/обновить цветные карточки
  5) Установить/обновить остальные правки custom.css
  6) Установить радио
  7) Установить эффекты фона particles
  8) Установить все дополнения custom.css/custom.js
  -----------------------------

  9) Удалить
  10) Проверить статус
  11) Отмена
EOF

  while true; do
    if [[ -t 0 ]]; then
      read -r -p "Введите 1-11: " choice
    else
      read -r -p "Введите 1-11: " choice || die "Не выбрано действие."
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
        ACTION="install-cards"
        return 0
        ;;
      5)
        ACTION="install-extras"
        return 0
        ;;
      6)
        ACTION="install-radio"
        return 0
        ;;
      7)
        ACTION="install-particles"
        return 0
        ;;
      8)
        ACTION="install-custom"
        return 0
        ;;
      9)
        ACTION="uninstall"
        return 0
        ;;
      10)
        ACTION="status"
        return 0
        ;;
      11)
        log "Отменено"
        exit 0
        ;;
      *)
        printf 'Введите число от 1 до 11.\n' >&2
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
  command -v git >/dev/null 2>&1 || die "git is required to apply or revert the core patch"
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

  fix_config_ownership
  log "Custom preset '$preset' installed into $CONFIG_DIR"
}

install_custom_presets() {
  local preset=""

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

prompt_custom_install_choice() {
  [[ "$CUSTOM_INSTALL" == "prompt" ]] || return 0
  [[ -t 0 ]] || {
    CUSTOM_INSTALL="skip"
    return 0
  }

  local choice=""
  cat <<'EOF'

Установить/обновить custom.css/custom.js дополнения?
  1) Только цветные карточки
  2) Цветные карточки + остальные правки custom.css без радио/фона
  3) Все дополнения: цветные карточки + остальные правки custom.css + радио + фон particles/FPS
  4) Пропустить
EOF

  while true; do
    read -r -p "Введите 1-4 [1]: " choice
    choice="${choice:-1}"

    case "$choice" in
      1)
        CUSTOM_INSTALL="cards"
        return 0
        ;;
      2)
        CUSTOM_INSTALL="extras"
        return 0
        ;;
      3)
        CUSTOM_INSTALL="all"
        return 0
        ;;
      4)
        CUSTOM_INSTALL="skip"
        return 0
        ;;
      *)
        printf 'Введите 1, 2, 3 или 4.\n' >&2
        ;;
    esac
  done
}

install_requested_custom() {
  case "$CUSTOM_INSTALL" in
    cards)
      ensure_config_dir
      install_custom_presets cards
      ;;
    extras)
      ensure_config_dir
      install_custom_presets cards extras
      ;;
    all)
      ensure_config_dir
      install_custom_presets cards extras radio particles
      ;;
    skip|none)
      log "Custom additions skipped"
      ;;
    prompt)
      prompt_custom_install_choice
      install_requested_custom
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
    "$TARGET/.env.local"
    "$TARGET/.next"
    "$TARGET/package.json"
    "$TARGET/pnpm-lock.yaml"
    "$TARGET/package-lock.json"
    "$TARGET/yarn.lock"
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
  run_mod_installer uninstall --force
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

  if [[ "$ACTION" == "install-cards" || "$ACTION" == "install-extras" || "$ACTION" == "install-radio" || "$ACTION" == "install-particles" || "$ACTION" == "install-custom" ]]; then
    local detected_target=""

    case "$ACTION" in
      install-cards) CUSTOM_INSTALL="cards" ;;
      install-extras) CUSTOM_INSTALL="extras" ;;
      install-radio) CUSTOM_INSTALL="radio" ;;
      install-particles) CUSTOM_INSTALL="particles" ;;
      install-custom) CUSTOM_INSTALL="all" ;;
      *) die "Unknown custom preset action: $ACTION" ;;
    esac

    if detected_target="$(find_target)"; then
      TARGET="$detected_target"
      log "Using Homepage checkout: $TARGET"
    fi

    case "$CUSTOM_INSTALL" in
      radio)
        ensure_config_dir
        install_custom_presets radio
        ;;
      particles)
        ensure_config_dir
        install_custom_presets particles
        ;;
      *)
        install_requested_custom
        ;;
    esac
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
  ensure_target_dependencies
  build_target
  if [[ "$ACTION" == "install" || "$ACTION" == "update-mod" || "$ACTION" == "update-target" || "$ACTION" == "uninstall" ]]; then
    fix_target_ownership
  fi

  if [[ "$ACTION" == "install" || "$ACTION" == "update-mod" || "$ACTION" == "update-target" ]]; then
    install_requested_custom
  fi

  restart_target
  log "Done"
}

main "$@"
