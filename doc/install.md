# Установка и удаление

## Требования

Для установки нужен именно checkout исходников [gethomepage/homepage](https://github.com/gethomepage/homepage), а не только директория `config`.

Минимально на инстансе должны быть:

- `bash`;
- `curl`;
- `git` для применения core-patch; `install.sh` автоматически установит его через `apt-get`, если запущен от `root` в Debian/Ubuntu LXC;
- `node`;
- пакетный менеджер для сборки Homepage: обычно `pnpm`, реже `npm` или `yarn`;
- права на запись в директорию Homepage;
- для автоматического перезапуска - доступ к `systemctl restart homepage.service`.

## Quick install

Установка target-проекта Homepage через Proxmox VE Community Scripts из Proxmox VE Shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/homepage.sh)"
```

Источник: [community-scripts.org/scripts/homepage](https://community-scripts.org/scripts/homepage).

Установка этого мода (Homepage configurator):

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-configurator/main/install.sh)
```

Если target был создан через Proxmox VE Community Scripts, запускайте установку мода уже внутри созданного LXC. Такой target лежит в `/opt/homepage`, config находится в `/opt/homepage/config`, а переменные окружения хранятся в `/opt/homepage/.env`; `install.sh` учитывает этот layout автоматически.

`install.sh` поддерживает действия:

- `Установить` - первая установка мода;
- `Обновить мод из GitHub` - переустановить мод поверх target-проекта из актуальной версии GitHub-репозитория;
- `Обновить интеграцию в target из текущего каталога` - переустановить мод в target из локального checkout, из которого запущен скрипт;
- `Удалить` - убрать мод из target-проекта;
- `Проверить статус` - показать значение `HOMEPAGE_BROWSER_EDITOR` в env-файле target (`.env.local` или существующий `.env`).

Кнопка `Иконки` в браузерном редакторе скачивает внешние `http/https` иконки из `services.yaml` и `bookmarks.yaml`, кладёт файлы в `${IMAGES_REAL_DIR}/icons` и заменяет URL в YAML на API-пути `/api/config/icon/...`. При установке нашим target-скриптом `${IMAGES_REAL_DIR}` равен `/srv/homepage-images`. В LXC от Proxmox VE Community Scripts, где `IMAGES_REAL_DIR` обычно не задан, иконки сохраняются в `/opt/homepage/public/images/icons`. Иконки отдаются через API, чтобы новые файлы работали сразу без перезапуска `homepage.service`.

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

1. Установите target-проект Homepage (например, через Proxmox VE Community Scripts).
2. Дождитесь успешного запуска `homepage.service`.
3. Запустите `install.sh` и выберите установку мода.

После установки или обновления мода `install.sh` сразу устанавливает весь managed-набор `custom.css/custom.js`: `cards`, `extras`, `radio` и `particles`.

Для нестандартной диагностики можно явно указать только `--custom skip` или `--custom all`. Штатный режим - `all`, потому что topbar, радио, фон и настройки теперь связаны с managed custom-файлами; отключение отдельных частей выполняется через интерфейс редактора.

Минимальная поддерживаемая версия target-проекта Homepage хранится в [`version.json`](../version.json) в поле `target.minimumVersion`. Если версия target ниже этого минимума, установка или обновление мода остановится с сообщением сначала обновить target проект из консоли командой `update`.

Если в существующих `custom.css` или `custom.js` есть содержимое вне `HOMEPAGE-EDITOR` managed-блоков, интерактивный запуск покажет найденные строки и спросит, удалять ли такие файлы перед установкой полного managed-набора. При удалении создаётся timestamp backup вида `.cleanup-YYYYMMDD-HHMMSS.bak`.

Для неинтерактивного режима можно явно выбрать поведение:

```bash
bash ./install.sh --action install --clean-custom keep
bash ./install.sh --action update --clean-custom delete
```

После установки target-проекта наш `install.sh` должен найти Homepage автоматически, потому что оба варианта создают `/opt/homepage` и `homepage.service` с `WorkingDirectory=/opt/homepage`.

Низкоуровневый установщик `install.mjs` поддерживает safety-режимы:

```bash
node install.mjs --dry-run --target /path/to/gethomepage/homepage
node install.mjs --target /path/to/gethomepage/homepage
node install.mjs --dry-run --uninstall --target /path/to/gethomepage/homepage
node install.mjs --uninstall --target /path/to/gethomepage/homepage
```

Перед применением он показывает план, проверяет, что target похож на checkout [gethomepage/homepage](https://github.com/gethomepage/homepage), сохраняет backup затрагиваемых файлов в `.homepage-configurator-backups/` и пишет manifest `.homepage-configurator-manifest.json`. При uninstall удаляются файлы из manifest; если overlay-файл был изменён вручную, uninstall остановится без `--force`.

Интерактивные действия `Обновить мод из GitHub` и `Обновить интеграцию в target из текущего каталога` сначала проходят preflight-проверку нового patch, затем переустанавливают overlay и core patch поверх существующего manifest. Обычное действие `Удалить` остаётся защищённым.

## Обновление Target-Проекта

Перед обновлением upstream Homepage лучше временно удалить мод:

1. запустите `install.sh` и выберите `Удалить`;
2. обновите upstream Homepage штатным способом (например, через git pull в /opt/homepage или переустановку скрипта);
3. снова запустите `install.sh` и выберите `Установить`.

Это нужно потому, что мод меняет core-файлы Homepage через `browser-editor.patch`.

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

1. preflight-проверку нового `browser-editor.patch`;
2. повторную установку overlay-файлов и `browser-editor.patch`;
3. включение `HOMEPAGE_BROWSER_EDITOR=true` в env-файле target;
4. установку managed custom-блоков до сборки;
5. одну сборку Homepage;
6. синхронизацию `.next/static` и `public` в `.next/standalone`, если используется standalone;
7. один перезапуск `homepage.service`, если сервис активен.

## Обновление Из Интерфейса Редактора

После установки мода в режиме редактирования появляется отдельная кнопка `Обновления`. Она сравнивает установленную версию с [`version.json`](../version.json) в ветке `main` и может запустить обновление прямо с сервера.

Автопроверка выполняется при загрузке страницы, но кешируется в `localStorage` браузера на 24 часа. Кнопка ручной проверки всегда делает свежий запрос к GitHub.

Обновление из браузера запускает `install.sh --action update --clean-custom keep --no-restart`, пишет лог в config-папку, а после успешной сборки планирует перезапуск `homepage.service`. YAML-конфиги не устанавливаются и не заменяются; managed custom-блоки обновляются так же, как при обычной установке.

Окно обновлений также показывает версию target Homepage и минимальную поддерживаемую версию из `version.json`. Если target старый, кнопка обновления мода блокируется; сначала нужно обновить Homepage из консоли командой `update`.

Для нестандартных установок можно задать переменные окружения сервиса:

- `HOMEPAGE_CONFIGURATOR_TARGET_DIR` - полный checkout Homepage, если autodetect не подходит;
- `HOMEPAGE_CONFIGURATOR_VERSION_URL` - альтернативный URL `version.json`;
- `HOMEPAGE_CONFIGURATOR_REPO` и `HOMEPAGE_CONFIGURATOR_BRANCH` - источник обновления;
- `HOMEPAGE_CONFIGURATOR_INSTALL_URL` - URL `install.sh`;
- `HOMEPAGE_CONFIGURATOR_RESTART_COMMAND` - команда перезапуска, если `systemctl restart homepage.service` не подходит.

Если updater не находит полный checkout Homepage, он не пытается обновлять standalone-only runtime. Для такого окружения используйте внешний deploy.

## Custom-Дополнения

При установке мода инсталлятор автоматически интегрирует весь managed-набор дополнений (`cards`, `extras`, `radio` и `particles`) в файлы `custom.js` и `custom.css`. 

Каталог для ассетов `/images` (картинки радио и шрифты) определяется автоматически:

1. `HOMEPAGE_IMAGES_DIR`, `IMAGES_REAL_DIR` или `--images-dir`;
2. `IMAGES_REAL_DIR`/`HOMEPAGE_IMAGES_DIR` из `.env.local`, `.env` target-проекта или `/etc/default/homepage`;
3. sibling-каталог `/srv/homepage-images`, если config находится в `/srv/homepage-config`;
4. `public/images` target-проекта, что важно для LXC от Proxmox VE Community Scripts.

Блоки `cards` и `extras` в `custom.css` помечены как управляемые. Не правьте CSS внутри этих блоков руками: при следующей установке или обновлении инсталлятор заменит содержимое между START/END-маркерами. Свои ручные правила добавляйте ниже END-маркера.

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

Если используется доступ по IP или домену и появляется `Host validation failed`, добавьте нужный host в настройки запуска Homepage. Например:

```bash
HOMEPAGE_ALLOWED_HOSTS=localhost:3000,127.0.0.1:3000,<runtime-host>:3000
```

## Docker

Стандартный контейнер [gethomepage/homepage](https://github.com/gethomepage/homepage) нельзя надежно пропатчить на месте: внутри него нет постоянного writable checkout исходников. После пересоздания контейнера такие изменения пропадут.

Для Docker нужен один из вариантов:

- отдельный checkout [gethomepage/homepage](https://github.com/gethomepage/homepage), в который ставится мод, после чего собирается свой image;
- кастомный image, где установка мода выполняется на этапе build;
- bind-mounted writable source checkout, если контейнер специально собран под такой режим.

Если установщик видит только стандартный Docker-контейнер и не находит checkout Homepage, он остановится и покажет объяснение.

## Ручная установка из репозитория мода

Из директории этого репозитория:

```bash
npm run install:target -- --target /opt/homepage
npm run enable:target -- --target /opt/homepage
```

Где `/opt/homepage` - путь к локальному checkout проекта [gethomepage/homepage](https://github.com/gethomepage/homepage).

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
