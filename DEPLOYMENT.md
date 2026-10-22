# Развёртывание AssessFlow на VPS

Нужны Linux VPS с Docker Compose, домен с DNS-записью на сервер и доступные порты 80/443. PostgreSQL, Redis, S3-хранилище и API не публикуются наружу. Для S3-совместимого хранения используется Garage в отдельном Docker volume. Один узел Garage не обеспечивает отказоустойчивость: для рабочих материалов настройте внешние резервные копии или переключите приложение на управляемое S3-хранилище.

## Первичная установка

1. Создайте `.env.production` на основе `.env.production.example`. Укажите домен и URL, задайте случайные секреты. Пароль PostgreSQL в `DATABASE_URL` должен совпадать с `POSTGRES_PASSWORD` и быть URL-safe. Для `S3_ACCESS_KEY` используйте `GK` и 32 шестнадцатеричных символа; `GARAGE_RPC_SECRET` должен содержать 64 hex-символа. Установите права файла `600`.
2. Соберите приложение и запустите только внутренние службы:

```sh
docker compose --env-file .env.production -f compose.production.yml build api
docker compose --env-file .env.production -f compose.production.yml up -d postgres redis object-store
docker compose --env-file .env.production -f compose.production.yml run --rm api npm run db:migrate
docker compose --env-file .env.production -f compose.production.yml run --rm api npm run db:seed
```

3. Создайте владельца платформы. Передавайте значения через защищённое окружение, не добавляйте пароль в аргументы команды. Пароль должен содержать не менее 16 символов.

```sh
docker compose --env-file .env.production -f compose.production.yml run --rm \
  -e OWNER_EMAIL -e OWNER_PASSWORD -e OWNER_NAME api npx tsx scripts/provision-owner.ts
```

4. Если на VPS ещё нет работающего прокси, запустите полный стек с Caddy:

```sh
docker compose --env-file .env.production -f compose.production.yml up -d
```

Владелец создаёт организацию, затем администратор добавляет эксперта и сотрудников и настраивает кампанию. Методики при первом запуске создаются черновиками; публикуйте их после проверки и утверждения переводов, лицензий и правил оценивания. Production API не запускается с `DEMO_MODE=true` или демонстрационной организацией в базе, поэтому используйте чистую базу.

В кабинете владельца платформы настройте OpenRouter: модель, ключ, разрешённых провайдеров, режим хранения данных и версию промпта. Задайте бюджет API-ключа в OpenRouter и лимиты в панели. `SETTINGS_ENCRYPTION_KEY` храните отдельно от базы и включите в план восстановления: он защищает сохранённый ключ провайдера.

## Если на VPS уже работает Caddy

Не запускайте второй прокси: порты 80/443 уже заняты. Укажите Docker-сеть текущего Caddy в `EXTERNAL_PROXY_NETWORK`, затем добавьте `deploy/compose.existing-caddy.yml` к каждой команде Compose:

```sh
EXTERNAL_PROXY_NETWORK=n8n_proxy docker compose --env-file .env.production \
  -f compose.production.yml -f deploy/compose.existing-caddy.yml up -d
```

В активный Caddyfile добавьте сайт для домена AssessFlow: `/api/*` направьте на `api:4000`, остальные запросы — на `web:3000`. Проверьте конфигурацию через `caddy validate`, затем выполните graceful reload. Перед правкой сохраните копию Caddyfile; не перезапускайте чужие Compose-проекты.

Проверьте `https://<домен>/api/health`: успешный ответ содержит `{"status":"ok"}`.

## Эксплуатация

- `GET /api/health` проверяет соединение с PostgreSQL. Логи контейнеров и AI-генераций контролируются средствами VPS.
- `sh deploy/backup.sh` сохраняет дамп PostgreSQL и архив данных Garage. На короткое время скрипт приостанавливает Garage для согласованной копии его data и metadata; в этот период загрузки файлов будут недоступны. Шифруйте архивы и отправляйте во внешнее хранилище; держите `.env.production` и ключи отдельно. Не публикуйте архивы с секретами.
- Проверяйте восстановление в отдельной среде, не поверх рабочей базы.
- При временной недоступности OpenRouter тесты продолжают рассчитываться на backend, а AI-анализ можно запустить повторно из кабинета. Результаты пользователей остаются в PostgreSQL.
- Для обновления сначала создайте резервную копию, соберите новый образ, примените `db:migrate` и перезапустите только контейнеры AssessFlow. Миграции должны оставаться обратно совместимыми; завершённые попытки не меняются при публикации версии теста.