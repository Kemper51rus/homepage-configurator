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

## Quick install

Установка target-проекта Homepage:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-editor/main/install-update-homepage.sh)
```

Скрипт `install-update-homepage.sh` устанавливает или обновляет upstream `gethomepage/homepage` в `/opt/homepage`, настраивает `homepage.service`, nginx, внешние каталоги конфигов и картинок.

Для установки target-проекта запускайте его от `root`.

Установка мода:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-editor/main/install.sh)
```

`install.sh` поддерживает действия:

- `Установить` - первая установка мода;
- `Обновить мод из GitHub` - переустановить мод поверх target-проекта из актуальной версии GitHub-репозитория;
- `Обновить интеграцию в target из текущего каталога` - переустановить мод в target из локального checkout, из которого запущен скрипт;
- `Удалить` - убрать мод из target-проекта;
- `Проверить статус` - показать значение `HOMEPAGE_BROWSER_EDITOR` в `.env.local`.

Скрипт сам ищет target-проект в таком порядке:

1. `HOMEPAGE_TARGET_DIR` или `--target`;
2. `WorkingDirectory` сервиса `homepage.service`;
3. `/opt/homepage`;
4. `/app`;
5. `/usr/src/app`;
6. текущая директория запуска.

Если checkout Homepage не найден, скрипт попросит ввести путь вручную.

## Порядок Первой Установки

1. Запустите `install-update-homepage.sh` и выберите установку target-проекта.
2. Дождитесь успешной сборки и запуска `homepage.service`.
3. Запустите `install.sh` и выберите установку мода.

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
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-editor/main/install.sh)
```

и выбрать `Обновить мод из GitHub`.

Это действие всегда берёт код мода из GitHub, даже если рядом лежит локальный checkout с незакоммиченными изменениями.

## Обновление Интеграции Из Локального Checkout

Если код мода менялся локально и нужно переустановить его в target-проект без скачивания с GitHub, запустите `install.sh` из корня локального checkout и выберите `Обновить интеграцию в target из текущего каталога`.

Либо можно явно указать локальный checkout:

```bash
HOMEPAGE_EDITOR_MOD_DIR=/opt/homepage-browser-editor-mod bash ./install.sh --action update-target
```

Это действие использует только локальные файлы мода и завершится ошибкой, если не сможет найти `install.mjs`, `browser-editor.patch` и `overlay/` в текущем каталоге или в `HOMEPAGE_EDITOR_MOD_DIR`.

Оба сценария обновления делают:

1. удаление текущей версии мода из target-проекта;
2. повторную установку overlay-файлов и `browser-editor.patch`;
3. включение `HOMEPAGE_BROWSER_EDITOR=true`;
4. одну сборку Homepage;
5. один перезапуск `homepage.service`, если сервис активен.

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
