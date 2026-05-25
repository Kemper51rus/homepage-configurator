# Установка и удаление

## Требования

Для установки нужен именно checkout исходников `gethomepage/homepage`, а не только директория `config`.

Минимально на инстансе должны быть:

- `bash`;
- `curl`;
- `git` для применения core-patch; `install.sh` автоматически установит его через `apt-get`, если запущен от `root` в Debian/Ubuntu LXC;
- `node`;
- пакетный менеджер для сборки Homepage: обычно `pnpm`, реже `npm` или `yarn`;
- права на запись в директорию Homepage;
- для автоматического перезапуска - доступ к `systemctl restart homepage.service`.
- для runtime-деплоя без `.git` - `rsync` и SSH-доступ к runtime-серверу.

## Quick install

Установка target-проекта Homepage нашим скриптом внутри готового Debian/Ubuntu LXC:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-configurator/main/install-update-homepage.sh)
```

Скрипт `install-update-homepage.sh` устанавливает или обновляет upstream `gethomepage/homepage` в `/opt/homepage`, настраивает `homepage.service`, внешние каталоги конфигов и картинок. По умолчанию сервис слушает `0.0.0.0:3000`; внешний reverse proxy настраивается отдельно и не входит в этот проект.

Для установки target-проекта запускайте его от `root`.

Установка target-проекта Homepage через Proxmox VE Community Scripts из Proxmox VE Shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/homepage.sh)"
```

Источник: [community-scripts.org/scripts/homepage](https://community-scripts.org/scripts/homepage).

Установка мода:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-configurator/main/install.sh)
```

Если target был создан через Proxmox VE Community Scripts, запускайте установку мода уже внутри созданного LXC. Такой target лежит в `/opt/homepage`, config находится в `/opt/homepage/config`, а переменные окружения хранятся в `/opt/homepage/.env`; `install.sh` учитывает этот layout автоматически.

`install.sh` поддерживает действия:

- `Установить` - первая установка мода;
- `Обновить мод из GitHub` - переустановить мод поверх target-проекта из актуальной версии GitHub-репозитория;
- `Обновить интеграцию в target из текущего каталога` - переустановить мод в target из локального checkout, из которого запущен скрипт;
- `Установить/обновить цветные карточки` - встроить managed-блок CSS, который нужен для `id` вида `color-red-name-card`;
- `Установить/обновить остальные правки custom.css` - встроить managed-блок дополнительных CSS-правок без радио и фона;
- `Установить радио (custom.css/custom.js)` - встроить managed-блоки радио/IP во внешние `custom.js` и `custom.css` Homepage; при активном воспроизведении радио ссылки сервисов и закладок открываются в новой вкладке;
- `Установить эффекты фона particles` - встроить managed-блоки интерактивного фона и FPS-кнопки во внешние `custom.js` и `custom.css` Homepage;
- `Установить все дополнения custom.css/custom.js` - встроить `cards`, `extras`, `radio` и `particles`;
- `Удалить` - убрать мод из target-проекта;
- `Проверить статус` - показать значение `HOMEPAGE_BROWSER_EDITOR` в env-файле target (`.env.local` или существующий `.env`).

Если задан `HOMEPAGE_EDITOR_TOKEN`, операции записи из браузера (`PUT/POST /api/config/editor`) требуют этот токен.
Клиент редактора попросит токен при первой ошибке `401` и сохранит его в `localStorage` браузера.
Для systemd-инсталляции нашим `install-update-homepage.sh` токен удобно хранить в `/etc/default/homepage`; скрипт сохраняет существующее значение при обновлении. В LXC от Proxmox VE Community Scripts токен можно добавить в `/opt/homepage/.env`, рядом с `HOMEPAGE_ALLOWED_HOSTS`.

Кнопка `Иконки` в браузерном редакторе скачивает внешние `http/https` иконки из `services.yaml` и `bookmarks.yaml`, кладёт файлы в `${IMAGES_REAL_DIR}/icons` и заменяет URL в YAML на API-пути `/api/config/icon/...`. При установке нашим target-скриптом `${IMAGES_REAL_DIR}` равен `/srv/homepage-images`, а deploy-скрипт сохраняет эту папку как runtime-data и не затирает её. В LXC от Proxmox VE Community Scripts, где `IMAGES_REAL_DIR` обычно не задан, иконки сохраняются в `/opt/homepage/images/icons`. Иконки отдаются через API, чтобы новые файлы работали сразу без перезапуска `homepage.service`.

Скрипт сам ищет target-проект в таком порядке:

1. `HOMEPAGE_TARGET_DIR` или `--target`;
2. `WorkingDirectory` сервиса `homepage.service`;
3. `/opt/homepage`;
4. `/app`;
5. `/usr/src/app`;
6. текущая директория запуска.

Если checkout Homepage не найден, скрипт попросит ввести путь вручную.

Для target без `.git`, как у tarball-установки Proxmox VE Community Scripts, `install.mjs` пропускает проверку staged-файлов и применяет `browser-editor.patch` напрямую через `git apply`. При обычном git checkout safety-проверка staged-файлов остаётся включённой.

Для действий с `custom.css/custom.js` скрипт сначала пытается определить папку config автоматически:

1. `HOMEPAGE_CONFIG_DIR` или `--config-dir`;
2. `config` target-проекта Homepage, если это symlink или обычная директория;
3. `/srv/homepage-config`;
4. `./config` в текущем каталоге.

Если папка config не найдена, скрипт попросит ввести путь вручную и при необходимости создаст директорию.

## Порядок Первой Установки

1. Запустите `install-update-homepage.sh` и выберите установку target-проекта.
2. Дождитесь успешной сборки и запуска `homepage.service`.
3. Запустите `install.sh` и выберите установку мода.

После установки или обновления мода в интерактивном режиме `install.sh` спросит, что делать с дополнениями `custom.css/custom.js`:

1. поставить только цветные карточки;
2. поставить цветные карточки и остальные правки `custom.css` без радио/фона;
3. поставить все дополнения: `cards`, `extras`, `radio`, `particles`;
4. пропустить custom-дополнения.

Для неинтерактивного запуска используйте `--custom skip`, `--custom cards`, `--custom extras` или `--custom all`.

Если в существующих `custom.css` или `custom.js` есть содержимое вне `HOMEPAGE-EDITOR` managed-блоков, интерактивный запуск покажет найденные строки и спросит, удалять ли такие файлы перед установкой выбранных presets. При удалении создаётся timestamp backup вида `.cleanup-YYYYMMDD-HHMMSS.bak`.

Для неинтерактивного режима можно явно выбрать поведение:

```bash
bash ./install.sh --action install-custom --clean-custom keep
bash ./install.sh --action install-custom --clean-custom delete
```

После установки target-проекта наш `install.sh` должен найти Homepage автоматически, потому что оба варианта создают `/opt/homepage` и `homepage.service` с `WorkingDirectory=/opt/homepage`.

Низкоуровневый установщик `install.mjs` поддерживает safety-режимы:

```bash
node install.mjs --dry-run --target /path/to/gethomepage/homepage
node install.mjs --target /path/to/gethomepage/homepage
node install.mjs --dry-run --uninstall --target /path/to/gethomepage/homepage
node install.mjs --uninstall --target /path/to/gethomepage/homepage
```

Перед применением он показывает план, проверяет, что target похож на checkout `gethomepage/homepage`, сохраняет backup затрагиваемых файлов в `.homepage-configurator-backups/` и пишет manifest `.homepage-configurator-manifest.json`. При uninstall удаляются файлы из manifest; если overlay-файл был изменён вручную, uninstall остановится без `--force`.

Интерактивные действия `Обновить мод из GitHub` и `Обновить интеграцию в target из текущего каталога` используют `--force` только для удаления предыдущей версии мода перед установкой новой. Обычное действие `Удалить` остаётся защищённым.

## Обновление Target-Проекта

Перед обновлением upstream Homepage лучше временно удалить мод:

1. запустите `install.sh` и выберите `Удалить`;
2. запустите `install-update-homepage.sh` и выберите `Обновить`;
3. снова запустите `install.sh` и выберите `Установить`.

Это нужно потому, что мод меняет core-файлы Homepage через `browser-editor.patch`, а `install-update-homepage.sh` обновляет target через `git pull`.

## Обновление Мода Из GitHub

Если нужно подтянуть актуальную версию мода с GitHub и переустановить её в target-проект, достаточно снова запустить:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-configurator/main/install.sh)
```

и выбрать `Обновить мод из GitHub`.

Это действие всегда берёт код мода из GitHub, даже если рядом лежит локальный checkout с незакоммиченными изменениями.

## Обновление Интеграции Из Локального Checkout

Если код мода менялся локально и нужно переустановить его в target-проект без скачивания с GitHub, запустите `install.sh` из корня локального checkout и выберите `Обновить интеграцию в target из текущего каталога`.

Либо можно явно указать локальный checkout:

```bash
HOMEPAGE_EDITOR_MOD_DIR=/opt/homepage-configurator bash ./install.sh --action update-target
```

Это действие использует только локальные файлы мода и завершится ошибкой, если не сможет найти `install.mjs`, `browser-editor.patch` и `overlay/` в текущем каталоге или в `HOMEPAGE_EDITOR_MOD_DIR`.

Оба сценария обновления делают:

1. удаление текущей версии мода из target-проекта;
2. повторную установку overlay-файлов и `browser-editor.patch`;
3. включение `HOMEPAGE_BROWSER_EDITOR=true` в env-файле target;
4. одну сборку Homepage;
5. один перезапуск `homepage.service`, если сервис активен.

## Установка Custom-Дополнений Во Внешние Custom Файлы

Если нужно накатить только managed-блоки custom-дополнений из этого репозитория во внешнюю папку config Homepage, запустите:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-configurator/main/install.sh)
```

и выберите нужное действие:

1. `Установить/обновить цветные карточки`
2. `Установить/обновить остальные правки custom.css`
3. `Установить радио (custom.css/custom.js)`
4. `Установить эффекты фона particles`
5. `Установить все дополнения custom.css/custom.js`

Либо можно указать директорию явно:

```bash
HOMEPAGE_CONFIG_DIR=/srv/homepage-config bash ./install.sh --action install-radio
```

или:

```bash
HOMEPAGE_CONFIG_DIR=/srv/homepage-config bash ./install.sh --action install-particles
```

Цветные карточки и остальные CSS-правки:

```bash
HOMEPAGE_CONFIG_DIR=/srv/homepage-config bash ./install.sh --action install-cards
HOMEPAGE_CONFIG_DIR=/srv/homepage-config bash ./install.sh --action install-extras
```

Все custom-дополнения сразу:

```bash
HOMEPAGE_CONFIG_DIR=/srv/homepage-config bash ./install.sh --action install-custom
```

Эти действия:

1. берут нужный preset из `custom-config/` репозитория мода;
2. создаёт резервные копии существующих `custom.js` и `custom.css` как `.bak`, если содержимое отличается;
3. встраивают или обновляют только свой managed-блок в `custom.js` и `custom.css`, не затирая другой preset;
4. при установке `radio`, `particles` или `all` копируют картинки радио и `Comfortaa.ttf` из `custom-config/radio/assets/radio/` в каталог, который Homepage отдаёт как `/images/radio`;
5. спрашивают, удалять ли `custom.css`/`custom.js`, если в них найдено содержимое вне managed-блоков;
6. не требуют сборки target-проекта и не перезапускают `homepage.service`.

Каталог `/images` определяется автоматически:

1. `HOMEPAGE_IMAGES_DIR`, `IMAGES_REAL_DIR` или `--images-dir`;
2. `IMAGES_REAL_DIR`/`HOMEPAGE_IMAGES_DIR` из `.env.local`, `.env` target-проекта или `/etc/default/homepage`;
3. sibling-каталог `/srv/homepage-images`, если config находится в `/srv/homepage-config`;
4. `public/images` target-проекта, что важно для LXC от Proxmox VE Community Scripts.

Блоки `cards` и `extras` в `custom.css` помечены как управляемые. Не правьте CSS внутри этих блоков руками: при следующей установке или обновлении `install.sh` заменит содержимое между START/END-маркерами. Свои ручные правила добавляйте ниже END-маркера.

## Что делает установщик

При установке скрипт:

1. скачивает этот репозиторий во временную директорию;
2. находит checkout Homepage;
3. копирует файлы из `overlay/` в target-проект;
4. применяет `browser-editor.patch`;
5. записывает `HOMEPAGE_BROWSER_EDITOR=true` в env-файл target (`.env.local` или существующий `.env`);
6. запускает сборку Homepage;
7. перезапускает `homepage.service`, если сервис активен.

При обновлении скрипт:

1. откатывает предыдущую версию patch и удаляет overlay-файлы;
2. заново копирует overlay и применяет patch;
3. включает мод в env-файле target (`.env.local` или существующем `.env`);
4. запускает одну сборку Homepage;
5. перезапускает `homepage.service`, если сервис активен.

При удалении скрипт:

1. откатывает `browser-editor.patch`;
2. удаляет overlay-файлы мода из target-проекта;
3. записывает `HOMEPAGE_BROWSER_EDITOR=false` в env-файл target (`.env.local` или существующий `.env`);
4. снова запускает сборку и перезапуск сервиса.

## LXC / Systemd

Для установки в LXC, где Homepage лежит в `/opt/homepage` и запущен через `homepage.service`, обычно достаточно quick install команды выше.

Для LXC, созданного Proxmox VE Community Scripts:

1. создайте LXC из Proxmox VE Shell командой `bash -c "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/homepage.sh)"`;
2. войдите в созданный LXC;
3. запустите установку мода командой `bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-configurator/main/install.sh)`.

В этом варианте конфиги Homepage находятся в `/opt/homepage/config`, поэтому для установки только custom-дополнений можно явно передать:

```bash
HOMEPAGE_CONFIG_DIR=/opt/homepage/config bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-configurator/main/install.sh)
```

Для radio/FPS assets в community LXC установщик использует `/opt/homepage/public/images/radio`, потому что этот путь отдаётся Homepage наружу как `/images/radio`.

После установки проверьте:

```bash
systemctl status homepage.service
curl -I -H 'Host: <runtime-host>:3000' http://127.0.0.1:3000/
```

## Runtime-Деплой Без `.git`

Рабочая схема после разделения проекта и runtime-сервера:

1. полный git-проект мода хранится локально в `/projects/homepage-configurator`;
2. target checkout `gethomepage/homepage` собирается локально в `.runtime-build/` внутри проекта;
3. на LXC/runtime-сервер доставляются только production-файлы;
4. `/srv/homepage-config` и `/srv/homepage-images` остаются runtime-data и не затираются деплоем.

Перед `pnpm build` в staging checkout должен быть актуальный `config` из runtime-сервера. Homepage prerender-ит главную страницу на build-time; если собрать без live `settings.yaml`, после деплоя пропадут build-time элементы вроде `title`, `background`, страниц-вкладок и порядка групп, хотя runtime API будет читать правильный `/srv/homepage-config`.

`.runtime-build/` - служебная сборочная копия upstream `gethomepage/homepage`. Она лежит внутри `/projects/homepage-configurator`, исключена из git через `.gitignore` и может быть удалена/пересоздана.

Если каталога ещё нет:

```bash
cd /projects/homepage-configurator
git clone --depth 1 -b dev https://github.com/gethomepage/homepage.git .runtime-build
```

Пример подготовки staging build:

```bash
cd /projects/homepage-configurator
./install.sh --action update-target --target .runtime-build --custom skip --no-restart

rm -rf .runtime-build/config
mkdir -p .runtime-build/config
rsync -a --delete <runtime-ssh>:/srv/homepage-config/ .runtime-build/config/

cd .runtime-build
pnpm run build
```

Dry-run:

```bash
cd /projects/homepage-configurator
scripts/deploy-runtime.sh --source .runtime-build --remote <runtime-ssh>
```

Применить и перезапустить сервис:

```bash
scripts/deploy-runtime.sh --source .runtime-build --remote <runtime-ssh> --apply --restart
```

Перевести systemd на standalone runtime:

```bash
scripts/deploy-runtime.sh --source .runtime-build --remote <runtime-ssh> --apply --install-service --restart
```

Runtime host передаётся явно через `--remote` или переменную `HOMEPAGE_RUNTIME_REMOTE`:

```bash
scripts/deploy-runtime.sh \
  --source .runtime-build \
  --remote <runtime-ssh> \
  --app-dir /opt/homepage \
  --config-dir /srv/homepage-config \
  --images-dir /srv/homepage-images \
  --install-service \
  --apply
```

Скрипт ожидает production-сборку с `.next/standalone/server.js`, `.next/static` и `public`.
При `--install-service` systemd unit запускает standalone server напрямую из `.next/standalone` через `node server.js` и задаёт `HOSTNAME=0.0.0.0`, чтобы внешний прокси мог ходить на `runtime-host:3000`.

Подробный runtime runbook: [runtime.md](runtime.md).

Если используется доступ по IP или домену и появляется `Host validation failed`, добавьте нужный host в настройки запуска Homepage. Например:

```bash
HOMEPAGE_ALLOWED_HOSTS=localhost:3000,127.0.0.1:3000,<runtime-host>:3000
```

## Docker

Стандартный контейнер `gethomepage/homepage` нельзя надежно пропатчить на месте: внутри него нет постоянного writable checkout исходников. После пересоздания контейнера такие изменения пропадут.

Для Docker нужен один из вариантов:

- отдельный checkout `gethomepage/homepage`, в который ставится мод, после чего собирается свой image;
- кастомный image, где установка мода выполняется на этапе build;
- bind-mounted writable source checkout, если контейнер специально собран под такой режим.

Если установщик видит только стандартный Docker-контейнер и не находит checkout Homepage, он остановится и покажет объяснение.

## Ручная установка из репозитория мода

Из директории этого репозитория:

```bash
npm run install:target -- --target /opt/homepage
npm run enable:target -- --target /opt/homepage
```

Где `/opt/homepage` - путь к локальному checkout проекта `gethomepage/homepage`.

После установки перезапустите homepage обычным способом. Для dev-запуска с доступом по IP нужно указать точный host и port:

```bash
PORT=3001 \
HOMEPAGE_ALLOWED_HOSTS=localhost:3001,127.0.0.1:3001,<runtime-host>:3001 \
HOMEPAGE_ALLOWED_DEV_ORIGINS=<runtime-host> \
HOMEPAGE_BROWSER_EDITOR=true \
pnpm dev -p 3001
```

Для production/deploy обычно достаточно добавить:

```bash
HOMEPAGE_BROWSER_EDITOR=true
```

и корректно настроить `HOMEPAGE_ALLOWED_HOSTS` под ваш домен или IP.

## Отключение

```bash
npm run disable:target -- --target /opt/homepage
```

Команда только выставляет:

```text
HOMEPAGE_BROWSER_EDITOR=false
```

в env-файл целевого проекта (`.env.local` или существующий `.env`). Пропатченные файлы она не удаляет.

## Полное удаление

```bash
npm run uninstall:target -- --target /opt/homepage
```

Эта команда пытается откатить core-patch, удалить overlay-файлы мода и выставить:

```text
HOMEPAGE_BROWSER_EDITOR=false
```

## Проверка статуса

```bash
npm run status:target -- --target /opt/homepage
```
