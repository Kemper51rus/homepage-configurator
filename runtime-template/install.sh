#!/usr/bin/env bash
set -Eeuo pipefail

ARCHIVE_URL="${HOMEPAGE_TEMPLATE_ARCHIVE_URL:-https://raw.githubusercontent.com/Kemper51rus/homepage-configurator/main/runtime-template/homepage-template.tar.gz}"
ARCHIVE_SHA256="${HOMEPAGE_TEMPLATE_SHA256:-905cd9ccfcbe90e68e90c68caae4922fdd326b3f93ca5c443b11e9b739d57a15}"

TARGET="${HOMEPAGE_TARGET_DIR:-}"
CONFIG_DIR="${HOMEPAGE_CONFIG_DIR:-}"
IMAGES_DIR="${HOMEPAGE_IMAGES_DIR:-${IMAGES_REAL_DIR:-}}"
ENV_FILE="${HOMEPAGE_ENV_FILE:-}"
INSTALL_ENV=0
DO_RESTART=0
DO_DELETE=0
DO_BACKUP=1
TMP_DIR=""

usage() {
  cat <<EOF
Homepage runtime template installer

Usage:
  bash install.sh [options]

Options:
  --target PATH       Homepage app directory, usually /opt/homepage
  --config-dir PATH   Homepage config directory
  --images-dir PATH   Directory served by Homepage as /images
  --env-file PATH     Environment file target for --install-env
  --install-env       Install env/homepage.env too
  --restart           Restart homepage.service after install
  --delete            Delete destination files missing from the template
  --no-backup         Do not create timestamped backups
  -h, --help          Show this help

Defaults are detected from /etc/default/homepage, /opt/homepage, and /srv/homepage-*.

Archive URL:
  $ARCHIVE_URL
EOF
}

log() {
  printf '[homepage-runtime-template] %s\n' "$*"
}

die() {
  printf '[homepage-runtime-template] ERROR: %s\n' "$*" >&2
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
      --env-file)
        [[ $# -ge 2 ]] || die "--env-file requires a path"
        ENV_FILE="$2"
        shift 2
        ;;
      --install-env)
        INSTALL_ENV=1
        shift
        ;;
      --restart)
        DO_RESTART=1
        shift
        ;;
      --delete)
        DO_DELETE=1
        shift
        ;;
      --no-backup)
        DO_BACKUP=0
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

systemd_workdir() {
  command -v systemctl >/dev/null 2>&1 || return 0
  systemctl show homepage.service -p WorkingDirectory --value 2>/dev/null || true
}

find_target() {
  local candidate=""

  if [[ -n "$TARGET" ]]; then
    printf '%s\n' "$(normalize_path "$TARGET")"
    return 0
  fi

  candidate="$(systemd_workdir)"
  if [[ -n "$candidate" && "$candidate" != "/" ]]; then
    if [[ "$candidate" == */.next/standalone ]]; then
      candidate="${candidate%/.next/standalone}"
    fi
    printf '%s\n' "$candidate"
    return 0
  fi

  if [[ -d "/opt/homepage" ]]; then
    printf '%s\n' "/opt/homepage"
    return 0
  fi

  return 1
}

find_config_dir() {
  local candidate=""
  local file=""

  if [[ -n "$CONFIG_DIR" ]]; then
    printf '%s\n' "$(normalize_path "$CONFIG_DIR")"
    return 0
  fi

  for file in "/etc/default/homepage" "$TARGET/.env.local" "$TARGET/.env"; do
    if candidate="$(env_file_value "$file" "CONFIG_REAL_DIR")"; then
      printf '%s\n' "$(normalize_path "$candidate")"
      return 0
    fi
    if candidate="$(env_file_value "$file" "HOMEPAGE_CONFIG_DIR")"; then
      printf '%s\n' "$(normalize_path "$candidate")"
      return 0
    fi
  done

  if [[ -n "$TARGET" && -e "$TARGET/config" ]]; then
    readlink -f "$TARGET/config" 2>/dev/null || printf '%s\n' "$TARGET/config"
    return 0
  fi

  if [[ -d "/srv/homepage-config" ]]; then
    printf '%s\n' "/srv/homepage-config"
    return 0
  fi

  return 1
}

find_images_dir() {
  local candidate=""
  local file=""

  if [[ -n "$IMAGES_DIR" ]]; then
    printf '%s\n' "$(normalize_path "$IMAGES_DIR")"
    return 0
  fi

  for file in "/etc/default/homepage" "$TARGET/.env.local" "$TARGET/.env"; do
    if candidate="$(env_file_value "$file" "IMAGES_REAL_DIR")"; then
      printf '%s\n' "$(normalize_path "$candidate")"
      return 0
    fi
    if candidate="$(env_file_value "$file" "HOMEPAGE_IMAGES_DIR")"; then
      printf '%s\n' "$(normalize_path "$candidate")"
      return 0
    fi
  done

  if [[ -d "/srv/homepage-images" ]]; then
    printf '%s\n' "/srv/homepage-images"
    return 0
  fi

  if [[ -n "$TARGET" && -d "$TARGET/public" ]]; then
    printf '%s\n' "$TARGET/public/images"
    return 0
  fi

  return 1
}

find_env_file() {
  if [[ -n "$ENV_FILE" ]]; then
    printf '%s\n' "$(normalize_path "$ENV_FILE")"
    return 0
  fi

  if [[ -f "/etc/default/homepage" ]]; then
    printf '%s\n' "/etc/default/homepage"
    return 0
  fi

  if [[ -n "$TARGET" && -f "$TARGET/.env" ]]; then
    printf '%s\n' "$TARGET/.env"
    return 0
  fi

  if [[ -n "$TARGET" ]]; then
    printf '%s\n' "$TARGET/.env.local"
    return 0
  fi

  return 1
}

backup_path() {
  local path="$1"

  [[ "$DO_BACKUP" -eq 1 && -e "$path" ]] || return 0

  local backup=""
  backup="${path}.backup-$(date +%Y%m%d-%H%M%S)"
  cp -a "$path" "$backup"
  log "Backup created: $backup"
}

copy_tree() {
  local source="$1"
  local target="$2"

  mkdir -p "$target"
  backup_path "$target"

  if [[ "$DO_DELETE" -eq 1 ]]; then
    command -v rsync >/dev/null 2>&1 || die "rsync is required with --delete"
    rsync -a --delete "$source/" "$target/"
    return 0
  fi

  cp -a "$source/." "$target/"
}

download_template() {
  command -v curl >/dev/null 2>&1 || die "curl is required"
  command -v tar >/dev/null 2>&1 || die "tar is required"

  TMP_DIR="$(mktemp -d)"
  local archive="$TMP_DIR/homepage-template.tar.gz"
  local source_dir="$TMP_DIR/source"

  log "Downloading template archive" >&2
  curl -fsSL "$ARCHIVE_URL" -o "$archive"

  if [[ -n "$ARCHIVE_SHA256" && "$(command -v sha256sum || true)" ]]; then
    printf '%s  %s\n' "$ARCHIVE_SHA256" "$archive" | sha256sum -c >/dev/null
  fi

  mkdir -p "$source_dir"
  tar -xzf "$archive" -C "$source_dir"

  [[ -d "$source_dir/config" ]] || die "Template archive is missing config/"
  [[ -d "$source_dir/images" ]] || die "Template archive is missing images/"

  printf '%s\n' "$source_dir"
}

sync_standalone_images() {
  [[ -n "$TARGET" && -d "$TARGET/.next/standalone" ]] || return 0

  local standalone_images="$TARGET/.next/standalone/public/images"
  log "Syncing standalone public images"
  mkdir -p "$(dirname "$standalone_images")"
  rm -rf -- "$standalone_images"
  cp -a "$IMAGES_DIR" "$standalone_images"
}

restart_service() {
  [[ "$DO_RESTART" -eq 1 ]] || return 0
  command -v systemctl >/dev/null 2>&1 || return 0

  if systemctl list-unit-files homepage.service >/dev/null 2>&1; then
    log "Restarting homepage.service"
    systemctl restart homepage.service
  fi
}

main() {
  parse_args "$@"

  TARGET="$(find_target)" || die "Homepage target was not found. Pass --target /opt/homepage."
  CONFIG_DIR="$(find_config_dir)" || die "Config directory was not found. Pass --config-dir /path/to/config."
  IMAGES_DIR="$(find_images_dir)" || die "Images directory was not found. Pass --images-dir /path/to/images."

  local source_dir=""
  source_dir="$(download_template)"

  log "Using Homepage target: $TARGET"
  log "Using config dir: $CONFIG_DIR"
  log "Using images dir: $IMAGES_DIR"

  copy_tree "$source_dir/config" "$CONFIG_DIR"
  copy_tree "$source_dir/images" "$IMAGES_DIR"

  if [[ "$INSTALL_ENV" -eq 1 ]]; then
    ENV_FILE="$(find_env_file)" || die "Env file target was not found. Pass --env-file /path/to/env."
    mkdir -p "$(dirname "$ENV_FILE")"
    backup_path "$ENV_FILE"
    cp -a "$source_dir/env/homepage.env" "$ENV_FILE"
    log "Installed env file: $ENV_FILE"
  fi

  sync_standalone_images
  restart_service

  log "Done"
}

main "$@"
