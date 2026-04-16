# Homepage Browser Editor Mod

Отдельный мод для `gethomepage/homepage`, который добавляет редактирование dashboard прямо из браузера:

- настройка, добавление и удаление сервисов;
- настройка, добавление и удаление закладок;
- перетаскивание карточек сервисов и закладок мышкой в режиме редактирования;
- визуальное редактирование групп и layout-параметров;
- загрузка фонового изображения;
- режим редактирования поверх текущего интерфейса, без отдельной длинной страницы настроек.

## Quick install

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-editor/main/install.sh)
```

После запуска скрипт покажет меню:

```text
1) Установить
2) Удалить
3) Проверить статус
4) Отмена
```

Если Homepage установлен не в `/opt/homepage`, укажите путь явно:

```bash
HOMEPAGE_TARGET_DIR=/path/to/homepage bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-editor/main/install.sh)
```

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

Скрипт сам ищет target-проект в таком порядке:

1. `HOMEPAGE_TARGET_DIR` или `--target`;
2. `WorkingDirectory` сервиса `homepage.service`;
3. `/opt/homepage`;
4. `/app`;
5. `/usr/src/app`;
6. текущая директория запуска.

## Что Делает Установщик

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

Проект `gethomepage/homepage` считается целевым upstream-checkout. Этот репозиторий хранит:

- исходники мода в `overlay/`;
- core-patch для точек встраивания;
- установщик;
- отдельную историю изменений.

## Установка В Homepage

Из директории этого репозитория:

```bash
npm run install:target -- --target /opt/homepage
npm run enable:target -- --target /opt/homepage
```

Где `/opt/homepage` - путь к локальному checkout проекта `gethomepage/homepage`.

Команда установки делает две вещи:

1. копирует runtime-файлы мода из `overlay/` в target-проект;
2. накладывает patch только на минимальные core-файлы, в которые мод должен встроиться.

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

## Использование

После включения мода на странице homepage появится кнопка `Edit`.

В режиме редактирования:

- существующие карточки сервисов и закладок можно открыть кликом и изменить;
- карточки можно перетаскивать мышкой внутри своей группы;
- в конце каждой группы появляется карточка добавления;
- над каждой группой появляется кнопка `Layout` для редактирования названия и разметки группы;
- панель группы можно перетаскивать на панель другой группы, чтобы поменять порядок;
- service-группу можно перетащить на `Drop inside` другой service-группы, чтобы сделать вложенную структуру как `250/300`;
- в нижней панели появляются кнопки `Service group` и `Bookmark group` для создания новых групп;
- кнопка `Background` открывает загрузку фонового изображения;
- кнопка `Done` выключает режим редактирования.

Изменения сохраняются в YAML-файлы целевого homepage:

- `config/services.yaml`
- `config/bookmarks.yaml`
- `config/settings.yaml`

Загруженный фон сохраняется в директорию `config` целевого проекта.

Для сервисов при перетаскивании мод автоматически обновляет `weight`, потому что homepage сортирует сервисы внутри группы по этому полю.

Для групп можно редактировать основные параметры из `settings.yaml`:

- `style`
- `columns`
- `header`
- `tab`
- `icon`
- `initiallyCollapsed`

В окне `Layout` есть быстрые кнопки:

- `Vertical` - обычная вертикальная группа;
- `Horizontal` - группа на всю строку;
- `2/3/4/5 columns` - горизонтальная группа с выбранным числом колонок;
- `Toggle header` - показать или скрыть заголовок группы.

## Отключение

```bash
npm run disable:target -- --target /opt/homepage
```

Команда только выставляет:

```text
HOMEPAGE_BROWSER_EDITOR=false
```

в `.env.local` целевого проекта. Пропатченные файлы она не удаляет.

Полное удаление мода:

```bash
npm run uninstall:target -- --target /opt/homepage
```

Эта команда пытается откатить core-patch, удалить overlay-файлы мода и выставить:

```text
HOMEPAGE_BROWSER_EDITOR=false
```

## Проверка Статуса

```bash
npm run status:target -- --target /opt/homepage
```

## Структура Мода

Исходники мода живут здесь:

```text
overlay/src/mods/browser-editor/*
overlay/src/pages/api/config/*
```

Это основной рабочий каталог для дальнейшей разработки.

Короткий рабочий цикл разработки описан в:

```text
DEV.md
```

Target-проект `/opt/homepage` больше не считается источником правды для кода мода. Он нужен только для:

- установки;
- сборки;
- проверки в живом homepage.

## Patch

Установщик применяет patch:

```text
browser-editor.patch
```

Patch меняет в целевом homepage только минимальные core-файлы:

- `src/pages/index.jsx`
- `src/components/services/*`
- `src/components/bookmarks/*`
- `next.config.js`

## Принцип Поддержки

Мод дальше ведется по правилу `mod-first`:

- вся новая логика и UI редактора по возможности добавляются только в `overlay/src/mods/browser-editor/*`;
- thin wrappers для API поддерживаются в `overlay/src/pages/api/config/*`;
- core `homepage` меняется только в точках подключения, без которых мод физически не может встроиться;
- если изменение можно реализовать внутри модуля, core не трогаем;
- patch должен оставаться как можно меньше, чтобы его было проще переносить на новые версии upstream.

На практике это значит, что основные рисковые места patch ограничены несколькими файлами:

- `src/pages/index.jsx`
- `src/components/services/*`
- `src/components/bookmarks/*`
- `next.config.js`

## Обновление Patch-Файла

Patch генерируется из уже установленного target-проекта вручную или отдельным локальным workflow.

Рабочая схема теперь такая:

1. меняем файлы в этом репозитории, в `overlay/`;
2. запускаем установку в target:
   ```bash
   npm run install:target -- --target /opt/homepage
   ```
3. проверяем сборку и поведение в `/opt/homepage`;
4. при необходимости обновляем `browser-editor.patch`, если изменилась точка встраивания в core.

Код мода больше не должен редактироваться напрямую в `/opt/homepage/src/mods/browser-editor`.

## Примечания

- Мод переписывает YAML через `js-yaml`, поэтому комментарии внутри сохраненного YAML-файла могут быть потеряны.
- API редактирования не добавляет отдельную авторизацию. Используйте мод только за доверенным reverse proxy, VPN или другим контролем доступа.
- Если upstream сильно изменит компоненты карточек или структуру API, patch может потребовать ручного обновления.
