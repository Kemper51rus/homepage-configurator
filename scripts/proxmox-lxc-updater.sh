#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

emit_json_status() {
  local state="$1"
  local update_available="$2"
  local current_version="$3"
  local latest_version="$4"
  local message="$5"
  local release_notes="${6:-}"

  jq -cn \
    --arg currentVersion "$current_version" \
    --arg latestVersion "$latest_version" \
    --arg message "$message" \
    --arg releaseNotes "$release_notes" \
    --arg state "$state" \
    --argjson updateAvailable "$update_available" \
    '{
      configured: true,
      currentVersion: $currentVersion,
      latestVersion: $latestVersion,
      message: $message,
      releaseNotes: $releaseNotes,
      state: $state,
      updateAvailable: $updateAvailable
    }'
}

request="${SSH_ORIGINAL_COMMAND:-${*:-}}"
action=""
node=""
vmid=""
container=""

if [[ "$request" =~ ^(check|update)[[:space:]]+([a-zA-Z0-9.-]+)[[:space:]]+([0-9]{1,9})$ ]]; then
  action="${BASH_REMATCH[1]}"
  node="${BASH_REMATCH[2]}"
  vmid="${BASH_REMATCH[3]}"
elif [[ "$request" =~ ^docker-discover[[:space:]]+([a-zA-Z0-9.-]+)$ ]]; then
  action="docker-discover"
  node="${BASH_REMATCH[1]}"
elif [[ "$request" =~ ^(docker-check|docker-update)[[:space:]]+([a-zA-Z0-9.-]+)[[:space:]]+([0-9]{1,9})[[:space:]]+([a-zA-Z0-9][a-zA-Z0-9_.-]{0,127})$ ]]; then
  action="${BASH_REMATCH[1]}"
  node="${BASH_REMATCH[2]}"
  vmid="${BASH_REMATCH[3]}"
  container="${BASH_REMATCH[4]}"
else
  fail "Команда исполнителя Proxmox не разрешена"
fi

[[ "$node" == "$(hostname -s)" ]] || fail "Исполнитель установлен не на узле ${node}"

resource_for_vmid() {
  pvesh get /cluster/resources --type vm --output-format json |
    jq -c --arg node "$node" --argjson vmid "$vmid" \
      'first(.[] | select(.type == "lxc" and .node == $node and .vmid == $vmid)) // empty'
}

validate_running_lxc() {
  local resource status
  resource="$(resource_for_vmid)"
  [[ -n "$resource" ]] || fail "LXC ${vmid} не найден на узле ${node}"
  status="$(pct status "$vmid" | awk '{print $2}')"
  [[ "$status" == "running" ]] || fail "LXC ${vmid} не запущен"
}

docker_is_available() {
  pct exec "$vmid" -- sh -c \
    'command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1'
}

docker_container_exists() {
  pct exec "$vmid" -- docker inspect "$container" >/dev/null 2>&1
}

create_safety_copy() {
  local description="$1"
  local snapshot backup_storage

  snapshot="homepage-update-$(date -u +%Y%m%d-%H%M%S)"
  if pct snapshot "$vmid" "$snapshot" --description "$description" >&2; then
    printf 'snapshot %s' "$snapshot"
    return
  fi

  printf '%s\n' "Snapshot недоступен; создаётся vzdump-backup LXC ${vmid}" >&2
  backup_storage="$(
    pvesh get "/nodes/${node}/storage" --content backup --output-format json |
      jq -r '[.[] | select(.active == 1 and .enabled == 1)] | max_by(.avail) | .storage // empty'
  )"
  [[ -n "$backup_storage" ]] || fail "Нет доступного Proxmox storage для backup"

  # vzdump использует глобальную блокировку узла. Не ждём бесконечно уже
  # запущенный backup: информатор должен вернуть понятную ошибку и дать
  # повторить обновление после освобождения слота.
  if ! flock -n /var/run/vzdump.lock -c true 2>/dev/null; then
    fail "В Proxmox уже выполняется резервное копирование; повторите обновление после его завершения"
  fi

  if ! vzdump "$vmid" --storage "$backup_storage" --mode snapshot --compress zstd >&2; then
    printf '%s\n' "Online-backup недоступен; выполняется backup с кратким suspend LXC" >&2
    vzdump "$vmid" --storage "$backup_storage" --mode suspend --compress zstd >&2
  fi
  printf 'backup на %s' "$backup_storage"
}

discover_lxc_docker() {
  local resource="$1"
  local discovered_container item lxc_label discovered_vmid

  discovered_vmid="$(jq -r '.vmid' <<<"$resource")"
  lxc_label="$(jq -r '.name // ("LXC " + (.vmid | tostring))' <<<"$resource")"
  vmid="$discovered_vmid"
  if ! docker_is_available; then
    return 0
  fi

  while IFS= read -r item; do
    [[ -n "$item" ]] || continue
    discovered_container="$(jq -r '.Names // empty' <<<"$item")"
    [[ "$discovered_container" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$ ]] || continue
    jq -cn \
      --arg id "$discovered_container" \
      --arg image "$(jq -r '.Image // empty' <<<"$item")" \
      --arg lxcLabel "$lxc_label" \
      --arg node "$node" \
      --arg state "$(jq -r '.State // "unknown"' <<<"$item")" \
      --argjson vmid "$discovered_vmid" \
      '{kind:"docker", id:$id, image:$image, lxcLabel:$lxcLabel, node:$node, state:$state, vmid:$vmid}'
  done < <(pct exec "$discovered_vmid" -- docker ps -a --format '{{json .}}' 2>/dev/null)
}

if [[ "$action" == "docker-discover" ]]; then
  discovery_dir="$(mktemp -d /run/homepage-docker-discovery.XXXXXX)"
  trap 'rm -rf -- "$discovery_dir"' EXIT
  discovery_pids=()
  while IFS= read -r resource; do
    discovered_vmid="$(jq -r '.vmid' <<<"$resource")"
    (
      discover_lxc_docker "$resource" || true
    ) >"${discovery_dir}/${discovered_vmid}.jsonl" &
    discovery_pids+=("$!")

    if ((${#discovery_pids[@]} >= 6)); then
      wait "${discovery_pids[0]}"
      discovery_pids=("${discovery_pids[@]:1}")
    fi
  done < <(
    pvesh get /cluster/resources --type vm --output-format json |
      jq -c --arg node "$node" \
        '.[] | select(.type == "lxc" and .node == $node and .status == "running")'
  )

  for discovery_pid in "${discovery_pids[@]}"; do
    wait "$discovery_pid"
  done
  for discovery_file in "${discovery_dir}"/*.jsonl; do
    [[ -f "$discovery_file" ]] || continue
    cat "$discovery_file"
  done
  exit 0
fi

validate_running_lxc
exec 9>"/run/lock/homepage-lxc-update-${vmid}.lock"
flock -w 15 9 || fail "Другая операция с LXC ${vmid} ещё выполняется"

if [[ "$action" == "docker-check" || "$action" == "docker-update" ]]; then
  docker_is_available || fail "Docker внутри LXC ${vmid} не запущен"
  docker_container_exists || fail "Docker-контейнер ${container} внутри LXC ${vmid} не найден"

  inspect="$(pct exec "$vmid" -- docker inspect "$container")"
  image="$(jq -r '.[0].Config.Image // empty' <<<"$inspect")"
  current_image="$(jq -r '.[0].Image // empty' <<<"$inspect")"
  [[ -n "$image" && -n "$current_image" ]] || fail "Не удалось определить образ ${container}"

  if [[ "$image" == *@sha256:* ]]; then
    emit_json_status \
      "idle" "false" "${current_image#sha256:}" "закреплённый digest" \
      "Контейнер ${container} использует закреплённый digest и не обновляется автоматически"
    exit 0
  fi

  pct exec "$vmid" -- docker pull "$image" >&2
  latest_image="$(
    pct exec "$vmid" -- docker image inspect "$image" --format '{{.Id}}'
  )"
  current_short="${current_image#sha256:}"
  latest_short="${latest_image#sha256:}"
  current_short="${current_short:0:12}"
  latest_short="${latest_short:0:12}"

  if [[ "$current_image" == "$latest_image" ]]; then
    state="idle"
    [[ "$action" == "docker-update" ]] && state="success"
    emit_json_status \
      "$state" "false" "$current_short" "$latest_short" \
      "Образ ${image} для ${container} актуален"
    exit 0
  fi

  if [[ "$action" == "docker-check" ]]; then
    emit_json_status \
      "available" "true" "$current_short" "$latest_short" \
      "Для ${container} доступен новый образ ${image}"
    exit 0
  fi

  labels="$(jq -c '.[0].Config.Labels // {}' <<<"$inspect")"
  project="$(jq -r '.["com.docker.compose.project"] // empty' <<<"$labels")"
  service="$(jq -r '.["com.docker.compose.service"] // empty' <<<"$labels")"
  working_dir="$(jq -r '.["com.docker.compose.project.working_dir"] // empty' <<<"$labels")"
  config_files="$(jq -r '.["com.docker.compose.project.config_files"] // empty' <<<"$labels")"

  [[ "$project" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$ ]] ||
    fail "Контейнер ${container} не содержит безопасную метку Compose project"
  [[ "$service" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$ ]] ||
    fail "Контейнер ${container} не содержит безопасную метку Compose service"
  [[ "$working_dir" == /* && "$working_dir" != *".."* && "$working_dir" != *$'\n'* ]] ||
    fail "Контейнер ${container} не содержит безопасный Compose working_dir"
  [[ -n "$config_files" && "$config_files" != *$'\n'* ]] ||
    fail "Контейнер ${container} не содержит Compose config_files"

  compose_args=(
    docker compose
    --project-directory "$working_dir"
    --project-name "$project"
  )
  IFS=',' read -r -a compose_files <<<"$config_files"
  ((${#compose_files[@]} > 0)) || fail "Список Compose-файлов пуст"
  for config_file in "${compose_files[@]}"; do
    config_file="${config_file#"${config_file%%[![:space:]]*}"}"
    config_file="${config_file%"${config_file##*[![:space:]]}"}"
    [[ "$config_file" == /* && "$config_file" != *".."* ]] ||
      fail "Compose-файл ${config_file} не прошёл проверку"
    compose_args+=(-f "$config_file")
  done

  safety_copy="$(create_safety_copy "Перед обновлением Docker ${container} через Homepage")"
  pct exec "$vmid" -- "${compose_args[@]}" pull "$service" >&2
  pct exec "$vmid" -- "${compose_args[@]}" up -d --no-deps "$service" >&2

  updated_inspect="$(pct exec "$vmid" -- docker inspect "$container")"
  running="$(jq -r '.[0].State.Running // false' <<<"$updated_inspect")"
  health="$(jq -r '.[0].State.Health.Status // empty' <<<"$updated_inspect")"
  [[ "$running" == "true" ]] || fail "Обновлённый контейнер ${container} не запустился"
  [[ "$health" != "unhealthy" ]] || fail "Обновлённый контейнер ${container} имеет статус unhealthy"

  emit_json_status \
    "success" "false" "$latest_short" "$latest_short" \
    "Docker-контейнер ${container} обновлён; создан ${safety_copy}"
  exit 0
fi

package_manager="$(
  pct exec "$vmid" -- sh -c \
    'if command -v apt-get >/dev/null 2>&1; then printf apt; elif command -v apk >/dev/null 2>&1; then printf apk; else printf unsupported; fi'
)"
[[ "$package_manager" != "unsupported" ]] || fail "Пакетный менеджер LXC ${vmid} не поддерживается"

# shellcheck disable=SC2016
os_name="$(
  pct exec "$vmid" -- sh -c \
    '. /etc/os-release 2>/dev/null || true; printf "%s" "${PRETTY_NAME:-Linux}"'
)"
docker_count=0
if docker_is_available; then
  docker_count="$(pct exec "$vmid" -- docker ps -a -q 2>/dev/null | sed '/^$/d' | wc -l)"
fi

refresh_packages() {
  case "$package_manager" in
    apt)
      pct exec "$vmid" -- env DEBIAN_FRONTEND=noninteractive apt-get update -qq
      packages="$(pct exec "$vmid" -- sh -c 'apt list --upgradable 2>/dev/null | sed 1d')"
      ;;
    apk)
      pct exec "$vmid" -- apk update --quiet
      packages="$(pct exec "$vmid" -- sh -c 'apk version -l "<" 2>/dev/null')"
      ;;
  esac
}

emit_lxc_status() {
  local state="$1"
  local message="$2"
  local count release_notes latest_version update_available

  count="$(printf '%s\n' "$packages" | sed '/^[[:space:]]*$/d' | wc -l)"
  release_notes="$(printf '%s\n' "$packages" | sed '/^[[:space:]]*$/d' | head -n 100)"
  latest_version="$os_name"
  update_available="false"
  if ((count > 0)); then
    latest_version="${count} обновлений пакетов"
    update_available="true"
  fi
  if ((docker_count > 0)); then
    message="${message}; Docker-контейнеров: ${docker_count} — они доступны отдельными целями"
  fi

  emit_json_status \
    "$state" "$update_available" "$os_name" "$latest_version" \
    "$message" "$release_notes"
}

refresh_packages

if [[ "$action" == "check" ]]; then
  package_count="$(printf '%s\n' "$packages" | sed '/^[[:space:]]*$/d' | wc -l)"
  if ((package_count > 0)); then
    emit_lxc_status "available" "Для LXC ${vmid} доступно ${package_count} обновлений системных пакетов"
  else
    emit_lxc_status "idle" "Системные пакеты LXC ${vmid} актуальны"
  fi
  exit 0
fi

safety_copy="$(create_safety_copy "Перед обновлением пакетов через Homepage")"
case "$package_manager" in
  apt)
    pct exec "$vmid" -- env DEBIAN_FRONTEND=noninteractive apt-get \
      -o Dpkg::Options::=--force-confold \
      -y upgrade >&2
    ;;
  apk)
    pct exec "$vmid" -- apk upgrade >&2
    ;;
esac

refresh_packages
emit_lxc_status "success" "Пакеты LXC ${vmid} обновлены; создан ${safety_copy}"
