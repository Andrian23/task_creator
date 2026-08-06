# Creator Task Bot

Telegram -> GPT-4o-mini -> ClickUp.

Кидаєш боту завдання в будь-якій формі — текстом, скріншотом, або і тим, і іншим.
Якщо чогось не вистачає (найчастіше — хто виконавець, або в чому суть), бот перепитає
одним коротким питанням. Коли інформації достатньо — створює таску в ClickUp і кидає лінк.

- `/start` — коротка інструкція
- `/cancel` — скасувати поточне незавершене завдання

## Env vars (Vercel -> Project -> Settings -> Environment Variables)

| Змінна | Що це |
|---|---|
| `TELEGRAM_BOT_TOKEN` | токен від @BotFather |
| `CLICKUP_API_TOKEN` | ClickUp personal API token (`pk_...`) |
| `CLICKUP_LIST_ID` | числовий ID списку ClickUp |
| `OPENAI_API_KEY` | ключ OpenAI (використовується `gpt-4o-mini`) |
| `UPSTASH_REDIS_URL` | REST URL безкоштовної Upstash Redis бази (для пам'яті діалогу) |
| `UPSTASH_REDIS_TOKEN` | REST token тієї ж бази |

### Звідки взяти Upstash

Потрібна безкоштовна Redis-база, щоб бот пам'ятав діалог між повідомленнями
(serverless-функції на Vercel не мають пам'яті між запитами).

1. Vercel -> проєкт -> вкладка **Storage** -> **Create Database** -> **Upstash** -> **Redis** (free tier).
2. Після створення відкрий базу -> вкладка **REST API** -> скопіюй `UPSTASH_REDIS_REST_URL` і `UPSTASH_REDIS_REST_TOKEN`.
3. Додай їх у Environment Variables проєкту під іменами `UPSTASH_REDIS_URL` і `UPSTASH_REDIS_TOKEN` (можна перейменувати при додаванні).

## Deploy

1. Import цей репозиторій у Vercel ("Add New Project" -> вибрати репо).
2. Додати всі 6 env vars вище.
3. Deploy. Запиши URL деплою, напр. `https://your-project.vercel.app`.
4. Постав Telegram webhook — відкрий один раз у браузері (підстав свій `<TOKEN>` і `<URL>`):

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL>/api/telegram
```

Має з'явитись `{"ok":true,"result":true,"description":"Webhook was set"}`.

## Вартість

Vercel Hobby ($0) + ClickUp Free ($0) + Upstash Redis free tier ($0) + OpenAI API
(оплата по факту використання gpt-4o-mini, копійки за таску).
