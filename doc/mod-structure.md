# Структура мода

Проект `gethomepage/homepage` считается целевым upstream-checkout. Этот репозиторий хранит:

- исходники мода в `overlay/`;
- core-patch для точек встраивания;
- установщик;
- отдельную историю изменений.

## Overlay

Исходники мода живут здесь:

```text
overlay/src/mods/browser-editor/*
overlay/src/pages/api/config/*
```

`overlay/src` повторяет структуру target-проекта. При установке файлы копируются так:

```text
overlay/src/mods/browser-editor/*        -> src/mods/browser-editor/*
overlay/src/pages/api/config/*.js        -> src/pages/api/config/*.js
```

Клиентские helper-файлы, например `overlay/src/mods/browser-editor/client/*`, также копируются внутрь target-проекта и импортируются как `mods/browser-editor/client/*`.

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

Рабочая схема:

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
- API редактирования включается только при `HOMEPAGE_BROWSER_EDITOR=true`. Для write-запросов можно задать `HOMEPAGE_EDITOR_TOKEN`; тогда браузерный клиент попросит токен и будет отправлять его в `X-Homepage-Editor-Token`.
- Если upstream сильно изменит компоненты карточек или структуру API, patch может потребовать ручного обновления.
