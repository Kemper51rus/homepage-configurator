# Runtime / Runbook

Этот документ фиксирует рабочую схему после разделения локального git-проекта и runtime-сервера.

## Источник Правды

- локальный полный проект: `/projects/homepage-configurator`;
- staging checkout upstream Homepage: `/projects/homepage-configurator/.runtime-build`;
- `.runtime-build/` исключён из git и может быть удалён/создан заново;
- runtime-сервер: SSH `<runtime-ssh>`;
- runtime app dir: `/opt/homepage`;
- runtime config: `/srv/homepage-config`;
- runtime images/icons: `/srv/homepage-images`.

На runtime-сервере `.git` не нужен. Изменения делаются локально, коммитятся и доставляются на сервер только как production runtime.

## Текущая Runtime-Модель

`homepage.service` должен запускать standalone Next.js build напрямую:

```ini
WorkingDirectory=/opt/homepage/.next/standalone
ExecStart=/usr/bin/node server.js
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
```

Сервис слушает `0.0.0.0:3000`. Этот проект не устанавливает и не настраивает nginx. Если нужен внешний reverse proxy, он должен быть отдельной инфраструктурной настройкой, а не частью `homepage-configurator`.

## Сборка

```bash
cd /projects/homepage-configurator

git clone --depth 1 -b dev https://github.com/gethomepage/homepage.git .runtime-build
./install.sh --action update-target --target .runtime-build --custom skip --no-restart

rm -rf .runtime-build/config
mkdir -p .runtime-build/config
rsync -a --delete <runtime-ssh>:/srv/homepage-config/ .runtime-build/config/

cd .runtime-build
pnpm run build
```

Live `config` нужен до build: Homepage prerender-ит главную страницу и использует `settings.yaml` для фона, title, страниц-вкладок и порядка групп.

## Деплой

Dry-run:

```bash
cd /projects/homepage-configurator
scripts/deploy-runtime.sh --source .runtime-build --remote <runtime-ssh>
```

Применить:

```bash
scripts/deploy-runtime.sh --source .runtime-build --remote <runtime-ssh> --apply --restart
```

Если нужно заново записать systemd unit под standalone:

```bash
scripts/deploy-runtime.sh --source .runtime-build --remote <runtime-ssh> --apply --install-service --restart
```

Deploy-скрипт не затирает `/srv/homepage-config` и `/srv/homepage-images`.

## Проверки После Деплоя

```bash
ssh <runtime-ssh> 'systemctl is-active homepage.service'
ssh <runtime-ssh> 'systemctl show homepage.service -p WorkingDirectory -p ExecStart -p Environment --no-pager'
ssh <runtime-ssh> 'ss -ltnp | grep ":3000"'
ssh <runtime-ssh> 'curl -sS -I --max-time 5 http://127.0.0.1:3000/ | sed -n "1,5p"'
```

Локальные проверки проекта:

```bash
npm run check
npm run smoke:install
npm run check:patch
npm run check:browser
```

## Иконки

Кнопка `Иконки` скачивает внешние URL-иконки из `services.yaml` и `bookmarks.yaml` в `${IMAGES_REAL_DIR}/icons`. При стандартном runtime это `/srv/homepage-images/icons`.

В YAML записываются API-пути `/api/config/icon/...`, а не прямые `/images/...`. Так новые иконки начинают открываться сразу и не требуют перезапуска `homepage.service`.

## Nginx

Nginx не является частью этой установки. В штатной схеме LXC `homepage` отдаёт сервис напрямую на `:3000`; маршрутизация доменов должна решаться вне проекта.
