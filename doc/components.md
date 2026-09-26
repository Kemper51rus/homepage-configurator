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
- `configFiles`, `dataDirs`, `persistentFiles`.

Все пути обязаны быть относительными POSIX-путями внутри component root. Traversal, абсолютные пути, Windows-пути, дубликаты и symlink escape отклоняются до изменения target.

## Manifest установки schema 2

`.homepage-configurator-manifest.json` хранит отдельно:

```json
{
  "schema": 2,
  "core": {},
  "components": {
    "homepage-studio": {
      "version": "<studio-release-version>",
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

Server-side allowlist разрешает только `homepage-studio/github-stable`. URL release metadata, имя артефакта и репозиторий зафиксированы в server-коде; браузер не может их переопределить. Штатный browser lifecycle не требует `HOMEPAGE_CONFIGURATOR_SOURCE_DIR` или `HOMEPAGE_STUDIO_COMPONENT_DIR`.

Для `install` и `update` сервер:

1. получает metadata последнего Studio release с фиксированного HTTPS URL GitHub;
2. проверяет schema, component id, tag, версию, имя артефакта, размер и SHA-256;
3. скачивает архив Configurator строго для версии core из schema-2 manifest и сверяет единственную точную запись в `SHA256SUMS.txt`;
4. разрешает redirects только на allowlisted GitHub hosts и ограничивает время, размер ответа, число файлов и распакованный объём;
5. отклоняет traversal, абсолютные пути, ссылки, устройства, дубликаты и небезопасные пути manifest до изменения target.

`remove` скачивает только закреплённый архив Configurator, необходимый для восстановления Classic core. Клиентские URL, пути и команды отклоняются. Операция защищена maintenance lock, выполняет build без shell, сохраняет используемый runtime build до переключения и восстанавливает snapshot при ошибке build или pre-restart loopback endpoint check. После успеха API планирует автоматический перезапуск Homepage. Необязательная проверка задаётся только доверенной серверной переменной `HOMEPAGE_COMPONENT_HEALTHCHECK_URL` и допускает `localhost`, `127.0.0.1` или `[::1]`; она проверяет текущий процесс до рестарта и не является healthcheck нового build.

CLI `--component-dir` остаётся отдельным режимом для разработчика: он принимает только явно указанный локальный trusted directory и не загружает URL.

## Проверки

```bash
npm run check
npm run smoke:component-profile
COMPONENT_SMOKE_BUILD=1 npm run smoke:component-profile
```

Матрица проверяет core-only, install Studio, remove, точное восстановление Classic, сохранение persistent-файлов, reinstall и production builds всех состояний.
