# Разработка

Рабочий каталог разработки:

```bash
cd /projects/homepage-configurator
```

Staging checkout Homepage для проверки или сборки:

```text
.runtime-build
```

`.runtime-build/` лежит внутри проекта, исключён из git и содержит отдельный checkout upstream `gethomepage/homepage` с установленным overlay-модом. Это не источник правды; при проблемах каталог можно удалить и создать заново:

```bash
git clone --depth 1 -b dev https://github.com/gethomepage/homepage.git .runtime-build
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
./install.sh --action update-target --target .runtime-build --custom skip --no-restart
```

3. Проверяем target:

```bash
rm -rf .runtime-build/config
mkdir -p .runtime-build/config
rsync -a --delete <runtime-ssh>:/srv/homepage-config/ .runtime-build/config/
cd .runtime-build
pnpm build
```

`config` нужен до `pnpm build`: Homepage prerender-ит `/` и встраивает build-time настройки из `settings.yaml`, включая фон и страницы-вкладки.

4. Доставляем runtime на сервер, если сборка прошла:

```bash
cd /projects/homepage-configurator
scripts/deploy-runtime.sh --source .runtime-build --remote <runtime-ssh>
scripts/deploy-runtime.sh --source .runtime-build --remote <runtime-ssh> --apply --restart
```

## Когда Обновлять Patch

`browser-editor.patch` обновляется только если изменились точки встраивания в core:

- `src/pages/index.jsx`
- `src/components/services/*`
- `src/components/bookmarks/*`
- `next.config.js`

Если менялся только код в `overlay/src/mods/browser-editor/*` или `overlay/src/pages/api/config/*`, patch обычно не нужно менять.

## Что Считается Нормальным

В target checkout после установки будут лежать:

- `src/mods/browser-editor/*`
- `src/pages/api/config/background.js`
- `src/pages/api/config/editor.js`

Это runtime-копия мода внутри target-проекта. Источник правды все равно остается в `/projects/homepage-configurator/overlay`.

## Быстрые Команды

Установить мод:

```bash
cd /projects/homepage-configurator
npm run install:target -- --target /opt/homepage
```

Включить мод:

```bash
cd /projects/homepage-configurator
npm run enable:target -- --target /opt/homepage
```

Проверить статус:

```bash
cd /projects/homepage-configurator
npm run status:target -- --target /opt/homepage
```

Проверить production:

```bash
curl -I -H 'Host: <runtime-host>:3000' http://127.0.0.1:3000/
curl -i -H 'Host: <runtime-host>:3000' http://127.0.0.1:3000/api/config/editor
```
