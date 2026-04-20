# Разработка

Рабочий каталог разработки:

```bash
cd /opt/homepage-configurator
```

Target-проект для проверки:

```text
/opt/homepage
```

## Правило

Меняем код мода только здесь:

```text
overlay/src/mods/browser-editor/*
overlay/src/pages/api/config/*
```

Core `homepage` не редактируем напрямую, если изменение можно сделать в overlay.

Подробная структура мода описана в [mod-structure.md](mod-structure.md).

## Базовый Цикл

1. Правим файлы в `overlay/`
2. Устанавливаем мод в target:

```bash
npm run install:target -- --target /opt/homepage
npm run enable:target -- --target /opt/homepage
```

3. Проверяем target:

```bash
cd /opt/homepage
pnpm build
systemctl restart homepage.service
```

4. Открываем:

```text
http://100.100.0.230:3000/
```

## Когда Обновлять Patch

`browser-editor.patch` обновляется только если изменились точки встраивания в core:

- `src/pages/index.jsx`
- `src/components/services/*`
- `src/components/bookmarks/*`
- `next.config.js`

Если менялся только код в `overlay/src/mods/browser-editor/*` или `overlay/src/pages/api/config/*`, patch обычно не нужно менять.

## Что Считается Нормальным

В `/opt/homepage` после установки будут лежать:

- `src/mods/browser-editor/*`
- `src/pages/api/config/background.js`
- `src/pages/api/config/editor.js`

Это runtime-копия мода внутри target-проекта. Источник правды все равно остается в `/opt/homepage-configurator/overlay`.

## Быстрые Команды

Установить мод:

```bash
cd /opt/homepage-configurator
npm run install:target -- --target /opt/homepage
```

Включить мод:

```bash
cd /opt/homepage-configurator
npm run enable:target -- --target /opt/homepage
```

Проверить статус:

```bash
cd /opt/homepage-configurator
npm run status:target -- --target /opt/homepage
```

Проверить production:

```bash
curl -I -H 'Host: 100.100.0.230:3000' http://127.0.0.1:3000/
curl -i -H 'Host: 100.100.0.230:3000' http://127.0.0.1:3000/api/config/editor
```
