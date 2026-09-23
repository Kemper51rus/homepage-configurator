# Компоненты Homepage Configurator

## Профили

- **Classic** — установлен только Homepage Configurator.
- **Studio** — Classic и compile-time компонент `homepage-studio`.

Компоненты не загружают исполняемый код из браузера. Изменение профиля копирует проверенные файлы в полный checkout Homepage, выполняет production build и требует перезапуска сервиса.

## Component manifest v1

Компонент описывается файлом `homepage-component.json` со следующими основными полями:

- `schema`, `id`, `name`, `version`;
- `requires.homepageConfigurator` и `requires.homepage`;
- `capabilities`;
- `overlay.root` и `overlay.files`;
- `replacesCoreFiles` — явный allowlist файлов core, которые компонент вправе заменить;
- `apiRoutes`, `managedCss`, `runtimeScripts`;
- `configFiles`, `dataDirs`, `persistentFiles`;
- `verification`.

Все пути обязаны быть относительными POSIX-путями внутри component root. Traversal, абсолютные пути, Windows-пути, дубликаты и symlink escape отклоняются до изменения target.

## Manifest установки schema 2

`.homepage-configurator-manifest.json` хранит отдельно:

```json
{
  "schema": 2,
  "core": {},
  "components": {
    "homepage-studio": {
      "version": "0.1.0-beta.1",
      "ownedFiles": [],
      "hashes": {},
      "replaced": {},
      "backupRoot": null,
      "configFiles": [],
      "dataDirs": [],
      "persistentFiles": []
    }
  }
}
```

Для каждого owned-файла сохраняется SHA-256. Заменённые core-файлы сохраняются в component backup и восстанавливаются при удалении. Persistent-файлы и data directories не удаляются.

## CLI

```bash
# Сначала установить Classic core
node install.mjs --target /opt/homepage --install

# Переключить профиль Classic -> Studio
node install.mjs --target /opt/homepage \
  --component install homepage-studio \
  --component-dir /path/to/homepage-studio

# Статус и обновление
node install.mjs --target /opt/homepage --component status homepage-studio
node install.mjs --target /opt/homepage \
  --component update homepage-studio \
  --component-dir /path/to/homepage-studio

# Вернуться к Classic
node install.mjs --target /opt/homepage --component remove homepage-studio
```

`--component-dir` принимается только как локальный trusted directory. URL не разрешены. Совместимость версий проверяется до мутации.

## Browser updater

Браузер отправляет только:

```json
{
  "action": "run-component-operation",
  "componentId": "homepage-studio",
  "sourceId": "github-stable",
  "operation": "install"
}
```

Server-side allowlist разрешает только `homepage-studio/github-stable`. Источники задаются окружением сервиса:

- `HOMEPAGE_CONFIGURATOR_SOURCE_DIR`;
- `HOMEPAGE_STUDIO_COMPONENT_DIR`;
- необязательный loopback healthcheck `HOMEPAGE_COMPONENT_HEALTHCHECK_URL`.

Клиентские URL, пути и команды отклоняются. Операция защищена maintenance lock, выполняет build без shell и восстанавливает snapshot при ошибке build или healthcheck. Runtime автоматически не перезапускается.

## Проверки

```bash
npm run check
npm run smoke:component-profile
COMPONENT_SMOKE_BUILD=1 npm run smoke:component-profile
```

Матрица проверяет core-only, install Studio, remove, точное восстановление Classic, сохранение persistent-файлов, reinstall и production builds всех состояний.
