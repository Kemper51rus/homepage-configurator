# Homepage Browser Editor Mod

Отдельный мод для `gethomepage/homepage`, который добавляет редактирование dashboard прямо из браузера:

- настройка, добавление и удаление сервисов;
- настройка, добавление и удаление закладок;
- загрузка фонового изображения;
- режим редактирования поверх текущего интерфейса, без отдельной длинной страницы настроек.

Проект `gethomepage/homepage` считается целевым upstream-checkout. Этот репозиторий хранит сам мод, patch-файл, установщик и отдельную историю изменений.

## Установка В Homepage

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

## Использование

После включения мода на странице homepage появится кнопка `Edit`.

В режиме редактирования:

- существующие карточки сервисов и закладок можно открыть кликом и изменить;
- в конце каждой группы появляется карточка добавления;
- кнопка `Background` открывает загрузку фонового изображения;
- кнопка `Done` выключает режим редактирования.

Изменения сохраняются в YAML-файлы целевого homepage:

- `config/services.yaml`
- `config/bookmarks.yaml`
- `config/settings.yaml`

Загруженный фон сохраняется в директорию `config` целевого проекта.

## Отключение

```bash
npm run disable:target -- --target /opt/homepage
```

Команда только выставляет:

```text
HOMEPAGE_BROWSER_EDITOR=false
```

в `.env.local` целевого проекта. Пропатченные файлы она не удаляет.

## Проверка Статуса

```bash
npm run status:target -- --target /opt/homepage
```

## Patch

Установщик применяет patch:

```text
patches/browser-editor.patch
```

Patch добавляет в целевой homepage:

- `src/mods/browser-editor/*` - основной код мода;
- thin wrappers для Next API в `src/pages/api/config/*`;
- небольшие точки подключения в карточках и списках сервисов/закладок;
- поддержку `HOMEPAGE_BROWSER_EDITOR` в `next.config.js`;
- вспомогательные npm-скрипты в `package.json` целевого проекта.

## Обновление Patch-Файла

Patch генерируется из уже пропатченного checkout homepage. В целевом проекте есть команда:

```bash
pnpm browser-editor:create-patch
```

После этого скопируйте обновленный `patches/browser-editor.patch` обратно в этот репозиторий мода.

## Примечания

- Мод переписывает YAML через `js-yaml`, поэтому комментарии внутри сохраненного YAML-файла могут быть потеряны.
- API редактирования не добавляет отдельную авторизацию. Используйте мод только за доверенным reverse proxy, VPN или другим контролем доступа.
- Если upstream сильно изменит компоненты карточек или структуру API, patch может потребовать ручного обновления.
