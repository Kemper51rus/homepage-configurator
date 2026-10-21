# Рабочий runtime Homepage

Проверено по действующему конфигу Traefik и systemd **2026-10-21**.

| Назначение | Адрес / путь |
| --- | --- |
| Пользовательский dashboard | `https://jexum.ru/` |
| Reverse proxy Traefik | `100.100.0.145` |
| Backend Homepage | `http://100.100.0.235:3000/` |
| SSH runtime | `root@100.100.0.235` |
| Полный checkout Homepage | `/opt/homepage` |
| Standalone build | `/opt/homepage/.next/standalone` |
| Пользовательская конфигурация | `/opt/homepage/config` |
| Картинки и иконки | `/opt/homepage/public/images` |
| systemd unit | `homepage.service` |
| Конфиг публичного маршрута на Traefik | `/etc/traefik/conf.d/homepage.yaml` |
| Канонический URL локальной иконки | `/api/config/icon/<filename>` |

Оба действующих router `homepage` и `homepage-lan` указывают на один service backend `http://100.100.0.235:3000/`. Публичный router сохраняет middleware Authentik; существующий LAN-router имеет собственный admin IP allowlist. При диагностике запрещено отключать Authentik или добавлять новый обход авторизации.

## Проверять не только прямой backend

1. Сверить текущий `/etc/traefik/conf.d/homepage.yaml` с этой таблицей: документация не заменяет live-конфиг.
2. Проверить версию в `/opt/homepage/.homepage-configurator-manifest.json`, состояние `homepage.service` и `/api/healthcheck`.
3. Проверить реальные URL `img.src` и наличие файлов иконок, включая старые `/api/ingress/.../api/config/icon/...` пути.
4. Для публичного домена проверить существующую маршрутизацию, middleware и `/var/log/traefik/access.log` (обычный текстовый формат, не JSON). Не выводить cookies, токены и query с секретами.
5. Отличать `200 image/*` от страницы входа Authentik с `200 text/html` после redirect. Проверка без авторизованной сессии не подтверждает пользовательский браузер.
6. После сохранения закладки проверять актуальный YAML и повторную загрузку иконок. Не сообщать о полном исправлении публичного сценария только на основании backend smoke.

Проверка иконок, включая старые URL с одним, двумя и четырьмя ingress-префиксами:

```bash
HOMEPAGE_BROWSER_SMOKE_URL=http://100.100.0.235:3000/ node scripts/local-icon-route-smoke.mjs
```

Для публичного домена этот тест требует штатной авторизованной сессии. Не выдавать redirect на страницу входа за успешный image response.

Пользовательские YAML содержат секреты: перед исправлениями создавать приватный backup и изменять только целевые поля. Не перезаписывать весь config старыми snapshot, если пользователь параллельно редактирует dashboard.
