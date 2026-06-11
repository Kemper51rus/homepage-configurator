#!/usr/bin/env bash
set -Eeuo pipefail

REMOTE="${HOMEPAGE_RUNTIME_REMOTE:-}"
SOURCE="${HOMEPAGE_BUILD_DIR:-}"
APP_DIR="${HOMEPAGE_RUNTIME_DIR:-/opt/homepage}"
CONFIG_DIR="${HOMEPAGE_CONFIG_DIR:-}"
IMAGES_DIR="${HOMEPAGE_IMAGES_DIR:-}"
SERVICE_NAME="${HOMEPAGE_SERVICE_NAME:-homepage.service}"
APPLY=0
RESTART=0
INSTALL_SERVICE=0

usage() {
  cat <<'EOF'
Deploy a minimal Homepage runtime tree to the runtime server.

Usage:
  scripts/deploy-runtime.sh --source .runtime-build --remote root@host [--apply] [--install-service] [--restart]

By default this is a dry-run. Pass --apply to copy files.
Pass --restart to also restart homepage.service after a successful apply.
Pass --install-service to rewrite homepage.service for standalone runtime.

The source must be a built gethomepage/homepage checkout with:
  .next/standalone/server.js
  .next/static
  public
EOF
}

die() {
  printf '[deploy-runtime] ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[deploy-runtime] %s\n' "$*"
}

validate_absolute_path() {
  local name="$1"
  local value="$2"

  [[ -n "$value" ]] || die "$name must not be empty"
  [[ "$value" == /* ]] || die "$name must be an absolute path: $value"

  case "$value" in
    /|/bin|/boot|/dev|/etc|/home|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var)
      die "$name is too broad for deploy operations: $value"
      ;;
  esac
}

validate_service_name() {
  [[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] || die "Invalid systemd service name: $SERVICE_NAME"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      [[ $# -ge 2 ]] || die "--source requires a path"
      SOURCE="$2"
      shift 2
      ;;
    --remote)
      [[ $# -ge 2 ]] || die "--remote requires user@host"
      REMOTE="$2"
      shift 2
      ;;
    --app-dir)
      [[ $# -ge 2 ]] || die "--app-dir requires a path"
      APP_DIR="$2"
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
    --service)
      [[ $# -ge 2 ]] || die "--service requires a systemd unit name"
      SERVICE_NAME="$2"
      shift 2
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    --restart)
      RESTART=1
      shift
      ;;
    --install-service)
      INSTALL_SERVICE=1
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

[[ -n "$SOURCE" ]] || die "Pass --source .runtime-build or set HOMEPAGE_BUILD_DIR"
[[ -n "$REMOTE" ]] || die "Pass --remote user@host or set HOMEPAGE_RUNTIME_REMOTE"
[[ -d "$SOURCE" ]] || die "Source does not exist: $SOURCE"
[[ -f "$SOURCE/.next/standalone/server.js" ]] || die "Missing standalone server: $SOURCE/.next/standalone/server.js"
[[ -d "$SOURCE/.next/static" ]] || die "Missing build static assets: $SOURCE/.next/static"
[[ -d "$SOURCE/public" ]] || die "Missing public directory: $SOURCE/public"
command -v rsync >/dev/null 2>&1 || die "rsync is required"
CONFIG_DIR="${CONFIG_DIR:-$APP_DIR/config}"
IMAGES_DIR="${IMAGES_DIR:-$APP_DIR/public/images}"
validate_absolute_path "APP_DIR" "$APP_DIR"
validate_absolute_path "CONFIG_DIR" "$CONFIG_DIR"
validate_absolute_path "IMAGES_DIR" "$IMAGES_DIR"
validate_service_name

if [[ ! -f "$SOURCE/config/settings.yaml" ]]; then
  log "WARNING: $SOURCE/config/settings.yaml not found. Homepage prerenders / at build time; build with live config before deploying or title/background/tabs can be stale."
fi

RSYNC_MODE=(-an --delete --itemize-changes)
if [[ "$APPLY" -eq 1 ]]; then
  RSYNC_MODE=(-a --delete --itemize-changes)
fi
STANDALONE_RSYNC_MODE=("${RSYNC_MODE[@]}" --exclude=/config --exclude=/public/images)
NEXT_RSYNC_MODE=("${RSYNC_MODE[@]}" --exclude=/cache --exclude=/standalone)
PUBLIC_RSYNC_MODE=("${RSYNC_MODE[@]}" --exclude=/images --exclude='/images.backup-*')

log "Remote: $REMOTE"
log "Source: $SOURCE"
log "Target: $APP_DIR"
[[ "$APPLY" -eq 1 ]] || log "Dry-run mode; pass --apply to copy files"

if [[ "$APPLY" -eq 1 ]]; then
  ssh "$REMOTE" bash -s -- "$APP_DIR" "$CONFIG_DIR" "$IMAGES_DIR" <<'REMOTE_SCRIPT'
set -eu
app_dir="$1"
config_dir="$2"
images_dir="$3"
if [ "$config_dir" = "$app_dir/config" ] && [ -L "$app_dir/config" ]; then
  rm -f -- "$app_dir/config"
fi
if [ "$images_dir" = "$app_dir/public/images" ] && [ -L "$app_dir/public/images" ]; then
  rm -f -- "$app_dir/public/images"
fi
mkdir -p "$app_dir/.next" "$app_dir/public" "$config_dir" "$images_dir"
REMOTE_SCRIPT
fi

rsync "${NEXT_RSYNC_MODE[@]}" "$SOURCE/.next/" "$REMOTE:$APP_DIR/.next/"
rsync "${STANDALONE_RSYNC_MODE[@]}" "$SOURCE/.next/standalone/" "$REMOTE:$APP_DIR/.next/standalone/"
rsync "${RSYNC_MODE[@]}" "$SOURCE/.next/static/" "$REMOTE:$APP_DIR/.next/static/"
rsync "${RSYNC_MODE[@]}" "$SOURCE/.next/static/" "$REMOTE:$APP_DIR/.next/standalone/.next/static/"
rsync "${PUBLIC_RSYNC_MODE[@]}" "$SOURCE/public/" "$REMOTE:$APP_DIR/public/"
rsync "${PUBLIC_RSYNC_MODE[@]}" "$SOURCE/public/" "$REMOTE:$APP_DIR/.next/standalone/public/"
rsync "${RSYNC_MODE[@]}" "$SOURCE/package.json" "$REMOTE:$APP_DIR/package.json"

if [[ -f "$SOURCE/next.config.js" ]]; then
  rsync "${RSYNC_MODE[@]}" "$SOURCE/next.config.js" "$REMOTE:$APP_DIR/next.config.js"
fi

if [[ -f "$SOURCE/next-i18next.config.js" ]]; then
  rsync "${RSYNC_MODE[@]}" "$SOURCE/next-i18next.config.js" "$REMOTE:$APP_DIR/next-i18next.config.js"
fi

if [[ "$APPLY" -eq 1 ]]; then
  ssh "$REMOTE" bash -s -- "$APP_DIR" "$CONFIG_DIR" "$IMAGES_DIR" <<'REMOTE_SCRIPT'
set -eu
app_dir="$1"
config_dir="$2"
images_dir="$3"
mkdir -p "$images_dir/icons"
chown homepage:homepage "$images_dir" "$images_dir/icons" 2>/dev/null || true
if [ "$config_dir" != "$app_dir/config" ]; then
  rm -rf -- "$app_dir/config"
  ln -sfn "$config_dir" "$app_dir/config"
elif [ -L "$app_dir/config" ]; then
  rm -f -- "$app_dir/config"
  mkdir -p "$app_dir/config"
fi
rm -rf -- "$app_dir/.next/standalone/config" "$app_dir/.next/standalone/public/images"
ln -sfn "$config_dir" "$app_dir/.next/standalone/config"
mkdir -p "$app_dir/public"
if [ "$images_dir" != "$app_dir/public/images" ]; then
  rm -rf -- "$app_dir/public/images"
  ln -sfn "$images_dir" "$app_dir/public/images"
elif [ -L "$app_dir/public/images" ]; then
  rm -f -- "$app_dir/public/images"
  mkdir -p "$app_dir/public/images"
fi
mkdir -p "$app_dir/.next/standalone/public"
ln -sfn "$images_dir" "$app_dir/.next/standalone/public/images"
chown -h homepage:homepage "$app_dir/config" "$app_dir/.next/standalone/config" "$app_dir/public/images" "$app_dir/.next/standalone/public/images" 2>/dev/null || true
REMOTE_SCRIPT

  if [[ "$INSTALL_SERVICE" -eq 1 ]]; then
    ssh "$REMOTE" bash -s -- "$APP_DIR" "$SERVICE_NAME" <<'REMOTE_SCRIPT'
set -eu
app_dir="$1"
service_name="$2"
node_path="$(command -v node)"
cat > "/etc/systemd/system/$service_name" <<EOF
[Unit]
Description=Homepage Dashboard
After=network.target

[Service]
Type=simple
User=homepage
Group=homepage
WorkingDirectory=$app_dir/.next/standalone
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
EnvironmentFile=/etc/default/homepage
ExecStart=${node_path} server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$service_name"
REMOTE_SCRIPT
  fi

  if [[ "$RESTART" -eq 1 ]]; then
    ssh "$REMOTE" bash -s -- "$SERVICE_NAME" <<'REMOTE_SCRIPT'
set -eu
service_name="$1"
systemctl restart "$service_name"
systemctl is-active "$service_name"
if command -v curl >/dev/null 2>&1; then
  attempt=1
  while [ "$attempt" -le 30 ]; do
    if curl -fsS -o /dev/null http://127.0.0.1:3000/ >/dev/null 2>&1; then
      exit 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "$service_name restarted, but http://127.0.0.1:3000/ did not become ready" >&2
  exit 1
fi
REMOTE_SCRIPT
  else
    log "Files copied. Restart skipped; pass --restart to restart $SERVICE_NAME."
  fi
fi
