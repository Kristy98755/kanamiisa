# AGENTS.md — карта проекта kanamiisa

Гайд для будущих агентов. Обновляй при изменениях структуры.

## Что это

Личный сайт-визитка Канами (`kanamiisa.uk`) + веб-приложение **Stenographist** (голосовой
диктофон → распознавание речи → «История болезни»).

- Один Cloudflare Worker `kanamiisa` раздаёт **всё**: статику сайта, авторизацию, почту, API.
- Второй Cloudflare Worker `stenographist` — backend ИИ-пайплайна Stenographist (вызывается по URL
  `https://stenographist.itismynickname9.workers.dev`).
- Фронт Stenographist лежит в репо и раздаётся тем же воркером `kanamiisa` по путям `/stenographist/*`.
- Статика: воркер отдаёт `ASSETS` (каталог `.`), `run_worker_first: true`.
- Язык общения с пользователем — русский. Код без комментариев, стиль vanilla JS.

## Карта файлов

```
kanamiisa\
├─ index.html              Лендинг: hero, «Обо мне», «Донаты» (только реквизиты), ссылки, галерея,
│                          мини-игры (flappy-miku, piano, hearts), easter eggs (miku beam, confetti).
│                          Всё инлайн-CSS/JS в одном файле.
├─ gallery\                Фото-галерея (статика)
├─ games\                  flappy\, miku-piano\, hearts\, miku-piano-data\, ranking.js, miku_beam.mp3
├─ js\auto-logout.js       Общая кнопка логаута (подключается из stenographist/panel.html)
├─ qrcode.js               QR-библиотека (используется ТОЛЬКО в stenographist/login/setup.html)
├─ yatips.png              Неиспользуемый ассет (Яндекс Чаевые удалены из секции Донаты)
├─ _headers                COOP/COEP для /stenographist/* (нужны ffmpeg.wasm → SharedArrayBuffer)
├─ CNAME                   kanamiisa.uk
├─ wrangler.jsonc           Конфиг воркера kanamiisa (main: worker/index.js, assets: ".")
├─ worker\                  Воркер kanamiisa
│  ├─ index.js              Роутинг + auth + audio/AI (см. «Роуты» ниже)
│  ├─ auth.js               Сессии, логи, brute-force, пользователи (KV)
│  ├─ totp.js / webauthn.js TOTP и WebAuthn
│  ├─ mail.js               Почтовый клиент (/mail + /mail/api/*, D1 MAIL_DB)
│  └─ rankings.js           /api/rankings (игры: таблица рекордов)
├─ stenographist\           Frontend Stenographist
│  ├─ index.html            Основное приложение (запись/загрузка аудио, прогресс, результат)
│  ├─ login.html            Единый вход (TOTP root / пароль гость)
│  ├─ login\setup.html      Настройка TOTP + QR
│  ├─ panel.html            Админка: сессии, kick, логи, пользователи
│  ├─ css\style.css
│  ├─ js\
│  │  ├─ app.js             UI: MediaRecorder, волна на canvas, загрузка файла, прогресс, результат
│  │  ├─ demo.js            DEMO_CONFIG + workerProcess() — ВЕСЬ клиентский пайплайн к воркеру
│  │  ├─ session.js         Heartbeat 30с, kick, оверлеи инкогнито/фона, fingerprint
│  │  ├─ fingerprint.js     ~1400 строк детекта браузера/инкогнито
│  │  └─ storage.js         IndexedDB для истории записей
│  ├─ worker\               ОТДЕЛЬНЫЙ воркер stenographist (свой wrangler.toml!)
│  │  ├─ index.js           Роуты + auth + /stenographist/api/process (SSE-пайплайн)
│  │  └─ wrangler.toml      name="stenographist", KV AUTH_KV, [ai] ЗАКОММЕНЧЕН
│  ├─ PROGRESS.md           Текущий статус, таблица эндпоинтов, KV-схема, деплой
│  └─ TEMPLATE.md           Доменный шаблон «Истории болезни» (JSON-схема)
├─ ARCHITECTURE.md          УСТАРЕЛ (см. PROGRESS.md)
└─ AGENTS.md                Этот файл
```

## Воркеры и деплой

| Worker | Конфиг | Что делает |
|---|---|---|
| `kanamiisa` | `wrangler.jsonc` | Статика сайта, `/login*`, `/stenographist/*` (статика+auth), `/mail`, `/api/rankings` |
| `stenographist` | `stenographist/worker/wrangler.toml` | ИИ-пайплайн: `POST /stenographist/api/process` |

- Аккаунт `8ab4d1eac66401d351de96dfb5119777`, KV `AUTH_KV` = `072e1df22e17491287febbc77eb72e47`
  (общий для обоих воркеров), D1 `MAIL_DB` = `89036ca8-e0d9-4bb8-9185-50f205770ce9`.
- Git: `"C:\Program Files\Git\cmd\git.exe"`. Деплой: `git push origin main` → автодеплой Cloudflare;
  вручную:
  - `kanamiisa` — `npx wrangler deploy` из корня репо;
  - `stenographist` — `npx wrangler deploy --config wrangler.toml` **из `stenographist/worker`**
    (без `--config` wrangler подхватывает корневой `wrangler.jsonc` и задеплоит не тот воркер).
- Wrangler 4.108.0.

### Роуты воркера `kanamiisa` (worker/index.js)
```
/login*, /login/api/*            TOTP/WebAuthn/настройка
/stenographist                   302 → /login
/stenographist/*                  статика + легаси auth (`login/api/*`)
/api/event|fingerprint|logout|session|sessions|session/kill|users|logs
/stenographist/api/process       handleProcess (SSE, полный пайплайн) — но см. баги
/api/rankings*                   rankings.js
/mail, /mail/api/*               mail.js (D1 MAIL_DB)
/                                index.html
* (fallback)                     статика из ASSETS
```

### Авторизация
- Cookie `session_id`: `SameSite=Strict`, **не HttpOnly** (JS читает), `Path=/stenographist`, TTL 1 ч.
- Root `kanamiisa` — TOTP; гости — пароль. KV-ключи: `user:*`, `session:*`, `session_list:*`,
  `failed:*`, `totp:secret` (детали и kick-механизм — `stenographist/PROGRESS.md`).
- Fingerprint и heartbeat — обязательная часть anti-incognito flow; не удалять.

## Stenographist: как работает пайплайн

1. **Запись** (`app.js`): `getUserMedia` → `MediaRecorder` (mimeType fallback webm/ogg/mp4,
   `getSupportedMimeType()`, app.js:232) → `recordedBlob`. Либо **загрузка файла** (аудио ≤25 МБ).
2. **`workerProcess(audioBlob, onProgress)`** (`demo.js:68`):
   - `decodeAudioData` → длительность.
   - ≤60 с: один POST. >60 с: **ffmpeg.wasm 0.11.6** (CDN unpkg, требует COOP/COEP из `_headers`)
     режет на mp3-чанки по 60 с и шлёт их последовательно.
   - Каждый чанк → `POST ${WORKER_URL}/process?mode=transcribe`, поле `audio` → JSON `{transcript}`.
   - Итоговый текст → `POST ${WORKER_URL}/process?mode=generate`, поле `transcript`,
     `Accept: text/event-stream` → SSE (`progress` / `result` / `error`).
   - `WORKER_URL = https://stenographist.itismynickname9.workers.dev` (demo.js:2).
3. **Воркер `stenographist`**: `handleProcess` → `formData.get('audio')` → SSE
   (`handleProcessSSE`: 5→35→45→95→100%) → `transcribeAudio` (`env.AI.run('@cf/openai/whisper')`)
   → `generateMedicalHistory` (`@cf/meta/llama-3.1-8b-instruct-fast`, огромный русский system-prompt,
   `parseJSON` с очисткой ```json fences).
4. Результат → `showResult()` (доступно для редактирования) + `saveRecording()` в IndexedDB.

## Баги Stenographist — исправлено 2026-10-25 (проверено живыми запросами)

1. **Клиент ходил в несуществующий роут.** `demo.js` → `POST /process?...` → 404.
   Фикс: путь теперь `${WORKER_URL}/stenographist/api/process?mode=...`.
2. **`mode` не был реализован.** Фикс: `handleProcess` парсит `mode`:
   `transcribe` (audio → `{transcript}`), `generate` (transcript → SSE/JSON
   `{transcript, medicalHistory}`), иначе полный пайплайн (как раньше).
3. **ReferenceError `headers` в `handleProcessSSE`** (`stenographist/worker/index.js`) → 500.
   Фикс: `...corsHeaders(env)` внутри функции; в главном воркере в SSE добавлен `...corsHeaders()`.
4. **AI binding был выключен.** Фикс: `[ai] binding = "AI"` в `stenographist/worker/wrangler.toml`
   и `"ai": { "binding": "AI" }` в `wrangler.jsonc` → `env.AI` доступен (Whisper + Llama 3.1 8B).
5. **Ошибки проглатывались в UI.** Фикс: `app.js` показывает `err.message` в тосте (6000 мс,
   обрезка до 300 символов), полная ошибка — в `console.error`.
6. **LLM-модель была удалена из каталога.** `@cf/meta/llama-3.1-8b-instruct` deprecated
   2026-05-30 → 5028. Фикс: `@cf/meta/llama-3.1-8b-instruct-fast` (активный `-fast` вариант),
   в обоих воркерах. Также `parseJSON` теперь принимает объект/`content`/`response` и даёт
   понятную ошибку, если модель вернула не то.
7. **Ошибки AI маскировались** как «service not configured». Фикс: разделены ветки
   «нет binding» и «`AI.run` упал» — в ответе видна реальная причина.

Проверено живыми запросами после деплоя (2026-10-25):
- `mode=transcribe` + реальный ogg 148 с → JSON `{transcript}` (25 с).
- `mode=generate` + SSE → прогресс 45→95→100 и `result` с `medicalHistory`.
- полный пайплайн (без `mode`, `Accept: text/event-stream`) → 5/35/45/95/100 + результат.
- `/process` → 404 (клиент больше не использует этот путь).

- Роут `worker/index.js:158` (`/stenographist/api/process` в главном воркере) — дубль,
  клиент им не пользуется; `mode` там НЕ реализован (только полный пайплайн).

## Gotchas

- `_headers` (COOP/COEP) обязателен для `/stenographist/*` — без него ffmpeg.wasm падает
  (нужен SharedArrayBuffer). Сайт отдаёт эти заголовки (проверено).
- Скрипт ffmpeg берётся с unpkg — у него есть CORS/CORP, поэтому под COEP работает.
- `qrcode.js` нужен только `stenographist/login/setup.html` — не удалять из репо.
- KV free tier: 100K reads/день, 1K writes/день — heartbeat каждые 30 с по всем сессиям жрёт записи.
- Секция «Донаты» в `index.html` — только текст с реквизитами
  (MBank/Simbank/O!Bank/Баланс Билайн Кыргызстан: +996220110764); Яндекс Чаевые и QR удалены.
