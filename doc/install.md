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

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-editor/main/install.sh)
```

Скрипт сам ищет target-проект в таком порядке:

1. `HOMEPAGE_TARGET_DIR` или `--target`;
2. `WorkingDirectory` сервиса `homepage.service`;
3. `/opt/homepage`;
4. `/app`;
5. `/usr/src/app`;
6. текущая директория запуска.

Если checkout Homepage не найден, скрипт попросит ввести путь вручную.

## Что делает установщик

При установке скрипт:

1. скачивает этот репозиторий во временную директорию;
2. находит checkout Homepage;
3. копирует файлы из `overlay/` в target-проект;
4. применяет `browser-editor.patch`;
5. записывает `HOMEPAGE_BROWSER_EDITOR=true` в `.env.local`;
6. запускает сборку Homepage;
7. перезапускает `homepage.service`, если сервис активен.

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
