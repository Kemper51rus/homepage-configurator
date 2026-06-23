<h1>
  <img src="logo-conf.png" alt="Homepage configurator logo" width="36" height="36" align="absmiddle" style="vertical-align: -6px;">
  Homepage configurator
</h1>

Отдельный мод для `gethomepage/homepage`, который добавляет редактирование dashboard прямо из браузера:

- настройка, добавление и удаление сервисов;
- настройка, добавление и удаление закладок;
- перетаскивание карточек сервисов и закладок мышкой в режиме редактирования;
- перетаскивание страниц-вкладок мышкой в режиме редактирования;
- визуальное редактирование групп и layout-параметров;
- загрузка фонового изображения;
- загрузка внешних URL-иконок в локальный каталог иконок;
- режим редактирования поверх текущего интерфейса, без отдельной длинной страницы настроек.

<img src="preview.png" width="100%">

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

Если target был создан через Proxmox VE Community Scripts, запускайте установку мода уже внутри созданного LXC. Установщик сам найдёт `/opt/homepage`, будет использовать `/opt/homepage/config` для `custom.css/custom.js` и сохранит флаг редактора в существующий `/opt/homepage/.env`.

Повторный запуск `install.sh` поддерживает разные сценарии обновления:

- `Установить` - первая установка;
- `Обновить мод из GitHub` - пройти preflight нового patch и переустановить мод из актуальной версии репозитория на GitHub;
- `Обновить интеграцию в target из текущего каталога` - переустановить мод в target из локального checkout, из которого запущен скрипт;
- `Установить/обновить цветные карточки` - накатить managed-блок CSS, который нужен для `id` вида `color-red-name-card`;
- `Установить/обновить остальные правки custom.css` - накатить managed-блок дополнительных CSS-правок без радио и фона;
- `Установить радио (custom.css/custom.js)` - накатить managed-блоки радио/IP во внешние `custom.js` и `custom.css` Homepage; когда радио играет, клики по сервисам и закладкам принудительно открываются в новой вкладке;
- `Установить эффекты фона particles` - накатить managed-блоки интерактивного фона и FPS-кнопки во внешние `custom.js` и `custom.css` Homepage;
- `Установить все дополнения custom.css/custom.js` - накатить `cards`, `extras`, `radio` и `particles`;
- `Удалить` - убрать мод из target-проекта.

Шаблоны лежат в репозитории в `custom-config/`. Обычная установка сразу встраивает весь managed-набор `cards`, `extras`, `radio` и `particles`; отдельные custom-actions остаются для ручного обслуживания конкретного блока. Блоки `cards` и `extras` в `custom.css` помечены предупреждением: правки внутри них будут заменены при следующей установке или обновлении.

Ассеты радио лежат в `custom-config/radio/assets/radio/`. При установке `radio`, `particles` или `all` установщик копирует картинки и `Comfortaa.ttf` в каталог, который Homepage отдаёт как `/images/radio`: обычно `/srv/homepage-images/radio`, а в LXC от Proxmox VE Community Scripts - `/opt/homepage/public/images/radio`. После установки custom-дополнений скрипт перезапускает `homepage.service`, потому что `next start` не начинает отдавать новые файлы из `public/images` без перезапуска процесса.

Если в существующих `custom.css` или `custom.js` есть содержимое вне `HOMEPAGE-EDITOR` managed-блоков, интерактивный установщик покажет найденные строки и спросит, удалять ли такие файлы перед установкой выбранных presets. Для автоматического запуска можно явно задать `--clean-custom keep` или `--clean-custom delete`.

## Использование

После включения мода кнопка `Edit` появляется только при наведении курсора на левый нижний угол страницы.

В режиме редактирования:

- существующие карточки сервисов и закладок можно открыть кликом и изменить;
- карточки можно перетаскивать мышкой внутри своей группы;
- в конце каждой группы появляется карточка добавления;
- над каждой группой появляется кнопка редактирования группы для названия и разметки;
- панель группы можно перетаскивать на панель другой группы, чтобы поменять порядок;
- верхние страницы-вкладки можно перетаскивать мышкой, чтобы поменять их порядок;
- service-группу можно перетащить на `Drop inside` другой service-группы, чтобы сделать вложенную структуру как `250/300`;
- в нижней панели есть кнопка `Новая группа`, а тип новой группы выбирается уже в окне редактора;
- кнопка `Фон` открывает загрузку фонового изображения;
- кнопка `Иконки` скачивает URL-иконки из `services.yaml` и `bookmarks.yaml` в каталог `icons` внешней папки изображений и заменяет ссылки в YAML на API-пути `/api/config/icon/...`;
- кнопка `Ручная правка` открывает прямое редактирование `settings.yaml`, `widgets.yaml`, `services.yaml`, `bookmarks.yaml`, `custom.css` и `custom.js`;
- кнопка `Done` выключает режим редактирования.
- клавиша `Esc` закрывает открытые окна настроек и выходит из режима редактирования.

Изменения сохраняются в YAML-файлы целевого homepage:

- `config/services.yaml`
- `config/bookmarks.yaml`
- `config/settings.yaml`

Загруженный фон сохраняется в директорию `config` целевого проекта.
Загруженные иконки сохраняются в `${IMAGES_REAL_DIR}/icons`; при установке нашим target-скриптом это `/srv/homepage-images/icons`, а в LXC от Proxmox VE Community Scripts без `IMAGES_REAL_DIR` - `/opt/homepage/public/images/icons`. Редактор прописывает их через `/api/config/icon/...`, поэтому новые файлы начинают отдаваться сразу и не требуют перезапуска `homepage.service`.

Для сервисов при перетаскивании мод автоматически обновляет `weight`, потому что homepage сортирует сервисы внутри группы по этому полю.

Для групп можно редактировать основные параметры из `settings.yaml`:

- `style`
- `columns`
- `header`
- `tab`
- `icon`
- `initiallyCollapsed`

Поле `Страница` в редакторе группы показывает существующие вкладки и при этом позволяет ввести новую вручную.

В окне группы есть быстрые кнопки:

- `Vertical` - обычная вертикальная группа;
- `Horizontal` - группа на всю строку;
- `2/3/4/5 columns` - горизонтальная группа с выбранным числом колонок;
- `Toggle header` - показать или скрыть заголовок группы.

## Документация

- [Установка и удаление](doc/install.md)
- [Структура мода](doc/mod-structure.md)
- [Разработка](doc/development.md)

## Проверки

Зависимости для полного набора проверок: `shellcheck` и Chromium для Playwright (`npx playwright install --with-deps chromium`).

```bash
npm run check
npm run check:patch
npm run check:browser
```

Для проверки установки на временный checkout upstream:

```bash
npm run smoke:install
```

## Сборка Standalone

Staging checkout для проверки production-сборки можно держать внутри проекта в `.runtime-build/`. Это служебная копия upstream `gethomepage/homepage`, она исключена из git и может быть удалена/пересоздана.

Если `.runtime-build/` ещё нет:

```bash
git clone --depth 1 -b dev https://github.com/gethomepage/homepage.git .runtime-build
```

Для локальной проверки можно использовать scratch config внутри `.runtime-build`; это не шаблон пользовательских конфигов и не предназначено для публикации:

```bash
mkdir -p .runtime-build/config
./install.sh \
  --action update-target \
  --target .runtime-build \
  --config-dir .runtime-build/config \
  --custom all \
  --no-restart
```
