#!/usr/bin/env bash
set -Eeuo pipefail

REMOTE="${HOMEPAGE_RUNTIME_REMOTE:-root@100.100.0.230}"
SOURCE="${HOMEPAGE_BUILD_DIR:-}"
APP_DIR="${HOMEPAGE_RUNTIME_DIR:-/opt/homepage}"
CONFIG_DIR="${HOMEPAGE_CONFIG_DIR:-/srv/homepage-config}"
IMAGES_DIR="${HOMEPAGE_IMAGES_DIR:-/srv/homepage-images}"
SERVICE_NAME="${HOMEPAGE_SERVICE_NAME:-homepage.service}"
APPLY=0
RESTART=0
INSTALL_SERVICE=0

usage() {
  cat <<'EOF'
Deploy a minimal Homepage runtime tree to the runtime server.

Usage:
  scripts/deploy-runtime.sh --source /path/to/built/homepage [--remote root@host] [--apply] [--install-service] [--restart]

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

[[ -n "$SOURCE" ]] || die "Pass --source /path/to/built/homepage or set HOMEPAGE_BUILD_DIR"
[[ -d "$SOURCE" ]] || die "Source does not exist: $SOURCE"
[[ -f "$SOURCE/.next/standalone/server.js" ]] || die "Missing standalone server: $SOURCE/.next/standalone/server.js"
[[ -d "$SOURCE/.next/static" ]] || die "Missing build static assets: $SOURCE/.next/static"
[[ -d "$SOURCE/public" ]] || die "Missing public directory: $SOURCE/public"
command -v rsync >/dev/null 2>&1 || die "rsync is required"

if [[ ! -f "$SOURCE/config/settings.yaml" ]]; then
  log "WARNING: $SOURCE/config/settings.yaml not found. Homepage prerenders / at build time; build with live config before deploying or title/background/tabs can be stale."
fi

RSYNC_MODE=(-an --delete --itemize-changes)
if [[ "$APPLY" -eq 1 ]]; then
  RSYNC_MODE=(-a --delete --itemize-changes)
fi
STANDALONE_RSYNC_MODE=("${RSYNC_MODE[@]}" --exclude=/config --exclude=/public/images)
PUBLIC_RSYNC_MODE=("${RSYNC_MODE[@]}" --exclude=/images)

log "Remote: $REMOTE"
log "Source: $SOURCE"
log "Target: $APP_DIR"
[[ "$APPLY" -eq 1 ]] || log "Dry-run mode; pass --apply to copy files"

if [[ "$APPLY" -eq 1 ]]; then
  ssh "$REMOTE" "mkdir -p '$APP_DIR/.next' '$CONFIG_DIR' '$IMAGES_DIR'"
fi

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
  ssh "$REMOTE" "
    set -eu
    rm -rf '$APP_DIR/config' '$APP_DIR/.next/standalone/config' '$APP_DIR/public/images' '$APP_DIR/.next/standalone/public/images'
    ln -sfn '$CONFIG_DIR' '$APP_DIR/config'
    ln -sfn '$CONFIG_DIR' '$APP_DIR/.next/standalone/config'
    mkdir -p '$APP_DIR/public'
    ln -sfn '$IMAGES_DIR' '$APP_DIR/public/images'
    mkdir -p '$APP_DIR/.next/standalone/public'
    ln -sfn '$IMAGES_DIR' '$APP_DIR/.next/standalone/public/images'
    chown -h homepage:homepage '$APP_DIR/config' '$APP_DIR/.next/standalone/config' '$APP_DIR/public/images' '$APP_DIR/.next/standalone/public/images' 2>/dev/null || true
  "

  if [[ "$INSTALL_SERVICE" -eq 1 ]]; then
    ssh "$REMOTE" "
      set -eu
      node_path=\"\$(command -v node)\"
      cat > '/etc/systemd/system/$SERVICE_NAME' <<EOF
[Unit]
Description=Homepage Dashboard
After=network.target

[Service]
Type=simple
User=homepage
Group=homepage
WorkingDirectory=$APP_DIR/.next/standalone
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
EnvironmentFile=/etc/default/homepage
ExecStart=\${node_path} server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
      systemctl daemon-reload
      systemctl enable '$SERVICE_NAME'
    "
  fi

  if [[ "$RESTART" -eq 1 ]]; then
    ssh "$REMOTE" "systemctl restart '$SERVICE_NAME' && systemctl is-active '$SERVICE_NAME'"
  else
    log "Files copied. Restart skipped; pass --restart to restart $SERVICE_NAME."
  fi
fi
