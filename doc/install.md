# Установка и удаление

## Требования

Для установки нужен именно checkout исходников `gethomepage/homepage`, а не только директория `config`.

Минимально на инстансе должны быть:

- `bash`;
- `curl`;
- `git`;
- `node`;
- пакетный менеджер для сборки Homepage: обычно `pnpm`, реже `npm` или `yarn`;
- права на запись в директорию Homepage;
- для автоматического перезапуска - доступ к `systemctl restart homepage.service`.
- для runtime-деплоя без `.git` - `rsync` и SSH-доступ к runtime-серверу.

## Quick install

Установка target-проекта Homepage:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-configurator/main/install-update-homepage.sh)
```

Скрипт `install-update-homepage.sh` устанавливает или обновляет upstream `gethomepage/homepage` в `/opt/homepage`, настраивает `homepage.service`, внешние каталоги конфигов и картинок. По умолчанию сервис слушает `0.0.0.0:3000`; внешний reverse proxy настраивается отдельно. Если нужен локальный nginx внутри LXC, запустите установщик с `HOMEPAGE_INSTALL_NGINX=1`.

Для установки target-проекта запускайте его от `root`.

Установка мода:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-configurator/main/install.sh)
```

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
- `Проверить статус` - показать значение `HOMEPAGE_BROWSER_EDITOR` в `.env.local`.

Если задан `HOMEPAGE_EDITOR_TOKEN`, операции записи из браузера (`PUT/POST /api/config/editor`) требуют этот токен.
Клиент редактора попросит токен при первой ошибке `401` и сохранит его в `localStorage` браузера.
Для systemd-инсталляции токен удобно хранить в `/etc/default/homepage`; `install-update-homepage.sh` сохраняет существующее значение при обновлении.

Скрипт сам ищет target-проект в таком порядке:

1. `HOMEPAGE_TARGET_DIR` или `--target`;
2. `WorkingDirectory` сервиса `homepage.service`;
3. `/opt/homepage`;
4. `/app`;
5. `/usr/src/app`;
6. текущая директория запуска.

Если checkout Homepage не найден, скрипт попросит ввести путь вручную.

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

После установки target-проекта наш `install.sh` должен найти Homepage автоматически, потому что `install-update-homepage.sh` создаёт `/opt/homepage` и `homepage.service` с `WorkingDirectory=/opt/homepage`.

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
3. включение `HOMEPAGE_BROWSER_EDITOR=true`;
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
4. не требуют сборки target-проекта и не перезапускают `homepage.service`.

Блоки `cards` и `extras` в `custom.css` помечены как управляемые. Не правьте CSS внутри этих блоков руками: при следующей установке или обновлении `install.sh` заменит содержимое между START/END-маркерами. Свои ручные правила добавляйте ниже END-маркера.

## Что делает установщик

При установке скрипт:

1. скачивает этот репозиторий во временную директорию;
2. находит checkout Homepage;
3. копирует файлы из `overlay/` в target-проект;
4. применяет `browser-editor.patch`;
5. записывает `HOMEPAGE_BROWSER_EDITOR=true` в `.env.local`;
6. запускает сборку Homepage;
7. перезапускает `homepage.service`, если сервис активен.

При обновлении скрипт:

1. откатывает предыдущую версию patch и удаляет overlay-файлы;
2. заново копирует overlay и применяет patch;
3. включает мод в `.env.local`;
4. запускает одну сборку Homepage;
5. перезапускает `homepage.service`, если сервис активен.

При удалении скрипт:

1. откатывает `browser-editor.patch`;
2. удаляет overlay-файлы мода из target-проекта;
3. записывает `HOMEPAGE_BROWSER_EDITOR=false` в `.env.local`;
4. снова запускает сборку и перезапуск сервиса.

## LXC / Systemd

Для установки в LXC, где Homepage лежит в `/opt/homepage` и запущен через `homepage.service`, обычно достаточно quick install команды выше.

После установки проверьте:

```bash
systemctl status homepage.service
curl -I -H 'Host: 100.100.0.230:3000' http://127.0.0.1:3000/
```

## Runtime-Деплой Без `.git`

Рабочая схема после разделения проекта и runtime-сервера:

1. полный git-проект мода хранится локально в `/projects/homepage-configurator`;
2. target checkout `gethomepage/homepage` собирается локально или на staging-хосте;
3. на LXC/runtime-сервер доставляются только production-файлы;
4. `/srv/homepage-config` и `/srv/homepage-images` остаются runtime-data и не затираются деплоем.

Перед `pnpm build` в staging checkout должен быть актуальный `config` из runtime-сервера. Homepage prerender-ит главную страницу на build-time; если собрать без live `settings.yaml`, после деплоя пропадут build-time элементы вроде `title`, `background`, страниц-вкладок и порядка групп, хотя runtime API будет читать правильный `/srv/homepage-config`.

Пример подготовки staging build:

```bash
cd /projects/homepage-configurator
./install.sh --action update-target --target /projects/homepage-runtime-build --custom skip --no-restart

rm -rf /projects/homepage-runtime-build/config
mkdir -p /projects/homepage-runtime-build/config
rsync -a --delete root@100.100.0.230:/srv/homepage-config/ /projects/homepage-runtime-build/config/

cd /projects/homepage-runtime-build
pnpm run build
```

Dry-run:

```bash
cd /projects/homepage-configurator
scripts/deploy-runtime.sh --source /path/to/built/homepage
```

Применить и перезапустить сервис:

```bash
scripts/deploy-runtime.sh --source /path/to/built/homepage --apply --restart
```

Перевести systemd на standalone runtime:

```bash
scripts/deploy-runtime.sh --source /path/to/built/homepage --apply --install-service --restart
```

По умолчанию скрипт деплоит на `root@100.100.0.230` в `/opt/homepage`. Это можно переопределить:

```bash
scripts/deploy-runtime.sh \
  --source /path/to/built/homepage \
  --remote root@100.100.0.230 \
  --app-dir /opt/homepage \
  --config-dir /srv/homepage-config \
  --images-dir /srv/homepage-images \
  --install-service \
  --apply
```

Скрипт ожидает production-сборку с `.next/standalone/server.js`, `.next/static` и `public`.
При `--install-service` systemd unit запускает standalone server напрямую из `.next/standalone` через `node server.js` и задаёт `HOSTNAME=0.0.0.0`, чтобы внешний прокси мог ходить на `runtime-host:3000`.

Если используется доступ по IP или домену и появляется `Host validation failed`, добавьте нужный host в настройки запуска Homepage. Например:

```bash
HOMEPAGE_ALLOWED_HOSTS=localhost:3000,127.0.0.1:3000,100.100.0.230:3000
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
HOMEPAGE_ALLOWED_HOSTS=localhost:3001,127.0.0.1:3001,100.100.0.230:3001 \
HOMEPAGE_ALLOWED_DEV_ORIGINS=100.100.0.230 \
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

в `.env.local` целевого проекта. Пропатченные файлы она не удаляет.

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
