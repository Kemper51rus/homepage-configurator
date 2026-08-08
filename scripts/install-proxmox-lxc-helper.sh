#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  printf '%s\n' "Запустите установщик от root на узле Proxmox" >&2
  exit 1
fi

public_key_file="${1:-}"
homepage_ip="${2:-}"
helper_file="${3:-}"

if [[ ! -f "$public_key_file" || ! -f "$helper_file" || -z "$homepage_ip" ]]; then
  printf 'Использование: %s <public-key-file> <homepage-ip> <helper-file>\n' "$0" >&2
  exit 1
fi

python3 - "$homepage_ip" <<'PY'
import ipaddress
import sys

address = ipaddress.ip_address(sys.argv[1])
if not address.is_private:
    raise SystemExit("Адрес Homepage должен быть приватным")
PY

bash -n "$helper_file"
public_key="$(sed -n '1p' "$public_key_file")"
if [[ ! "$public_key" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))[[:space:]] ]]; then
  printf '%s\n' "Некорректный публичный SSH-ключ" >&2
  exit 1
fi

install -o root -g root -m 0755 "$helper_file" /usr/local/sbin/homepage-lxc-updater
install -o root -g root -m 0700 -d /root/.ssh

authorized_keys="/root/.ssh/authorized_keys"
if [[ -f "$authorized_keys" ]]; then
  backup="${authorized_keys}.before-homepage-lxc-updater-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a "$authorized_keys" "$backup"
fi

if [[ ! -f "$authorized_keys" ]] || ! grep -Fq "$public_key" "$authorized_keys"; then
  temporary="$(mktemp /root/.ssh/authorized_keys.homepage.XXXXXX)"
  trap 'rm -f "$temporary"' EXIT
  if [[ -f "$authorized_keys" ]]; then
    cp "$authorized_keys" "$temporary"
  fi
  printf 'restrict,from="%s",command="/usr/local/sbin/homepage-lxc-updater" %s\n' \
    "$homepage_ip" "$public_key" >>"$temporary"
  install -o root -g root -m 0600 "$temporary" "$authorized_keys"
fi

printf '%s\n' "Ограниченный helper обновлений LXC установлен"
