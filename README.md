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

Установка target-проекта Homepage:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-configurator/main/install-update-homepage.sh)
```

Установка мода:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Kemper51rus/homepage-configurator/main/install.sh)
```

Повторный запуск `install.sh` поддерживает разные сценарии обновления:

- `Установить` - первая установка;
- `Обновить мод из GitHub` - снять мод и поставить заново из актуальной версии репозитория на GitHub;
- `Обновить интеграцию в target из текущего каталога` - переустановить мод в target из локального checkout, из которого запущен скрипт;
- `Установить/обновить цветные карточки` - накатить managed-блок CSS, который нужен для `id` вида `color-red-name-card`;
- `Установить/обновить остальные правки custom.css` - накатить managed-блок дополнительных CSS-правок без радио и фона;
- `Установить радио (custom.css/custom.js)` - накатить managed-блоки радио/IP во внешние `custom.js` и `custom.css` Homepage; когда радио играет, клики по сервисам и закладкам принудительно открываются в новой вкладке;
- `Установить эффекты фона particles` - накатить managed-блоки интерактивного фона и FPS-кнопки во внешние `custom.js` и `custom.css` Homepage;
- `Установить все дополнения custom.css/custom.js` - накатить `cards`, `extras`, `radio` и `particles`;
- `Удалить` - убрать мод из target-проекта.

Шаблоны лежат в репозитории в `custom-config/`. Установщик встраивает их как отдельные managed-блоки, поэтому `cards`, `extras`, `radio` и `particles` можно ставить независимо друг от друга без взаимного затирания. Блоки `cards` и `extras` в `custom.css` помечены предупреждением: правки внутри них будут заменены при следующей установке или обновлении.

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
Загруженные иконки сохраняются в `${IMAGES_REAL_DIR}/icons`; при стандартной установке это `/srv/homepage-images/icons`. Редактор прописывает их через `/api/config/icon/...`, поэтому новые файлы начинают отдаваться сразу и не требуют перезапуска `homepage.service`.

Для write-доступа к API редактора можно задать `HOMEPAGE_EDITOR_TOKEN`; тогда браузер попросит токен при первом сохранении и будет отправлять его в `X-Homepage-Editor-Token`.

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
- [Runtime/runbook](doc/runtime.md)
- [Структура мода](doc/mod-structure.md)
- [Разработка](doc/development.md)

## Проверки

```bash
npm run check
npm run check:patch
npm run check:browser
```

Для проверки установки на временный checkout upstream:

```bash
npm run smoke:install
```

## Runtime-деплой

Staging checkout для сборки живёт внутри проекта в `.runtime-build/`. Это служебная копия upstream `gethomepage/homepage`, она исключена из git и может быть удалена/пересоздана.

Если `.runtime-build/` ещё нет:

```bash
git clone --depth 1 -b dev https://github.com/gethomepage/homepage.git .runtime-build
```

После сборки staging checkout можно доставить на runtime-сервер только production-файлы:

```bash
scripts/deploy-runtime.sh --source .runtime-build
scripts/deploy-runtime.sh --source .runtime-build --apply --restart
scripts/deploy-runtime.sh --source .runtime-build --apply --install-service --restart
```

По умолчанию это LXC `homepage` по SSH `root@100.100.0.230`, target `/opt/homepage`.

Перед `pnpm build` staging checkout должен содержать актуальный `config` с runtime-сервера:

```bash
rsync -a --delete root@100.100.0.230:/srv/homepage-config/ .runtime-build/config/
```

Homepage генерирует главную страницу на build-time. Если собрать без live `settings.yaml`, после деплоя могут пропасть фон, title, страницы-вкладки и порядок групп, хотя runtime API будет читать правильный `/srv/homepage-config`.
