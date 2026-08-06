# Creator Task Bot

Telegram -> GPT-4o-mini -> ClickUp.

Кидаєш боту завдання в будь-якій формі — текстом, скріншотом, PDF, DOCX,
TXT/Markdown/CSV або поєднанням файла з коротким підписом.
Бот повністю перекладає бриф природною українською без додавання або зміни
змісту. Дослівно мовою оригіналу залишаються лише самі тексти хуків і репліки
скрипту для озвучки; назви їхніх секцій та решта брифу перекладаються. Окремо
уточнює, звідки взяти назву (назва файла, ID/заголовок у матеріалі або власна
назва користувача) та дедлайн. Коли інформації достатньо — показує актуальний
список виконавців із ClickUp, створює таску й надсилає посилання.
Посилання зберігаються без змін і залишаються клікабельними.

Публічні прямі посилання на відеофайли до 25 MB бот намагається завантажити
та прикріпити до ClickUp. Якщо завантаження неможливе, посилання залишається
в описі з жирним попередженням відкривати його лише в режимі інкогніто.

- `/start` — коротка інструкція
- `/cancel` — скасувати поточне незавершене завдання

## Env vars (Vercel -> Project -> Settings -> Environment Variables)

На Vercel змінні беруться з налаштувань проєкту. Для локального запуску
скопіюй `.env.example` у `.env.local` і заповни значення. `.env.local`
ігнорується Git і не потрапляє в репозиторій.

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

## Локальний запуск

```bash
npm run poll
```

Локально бот використовує Telegram long polling, а на Vercel — webhook.
Telegram не дозволяє одночасно використовувати polling і webhook для одного
bot token. Якщо локальна і Vercel-версія мають працювати паралельно, створи
окремого тестового бота через BotFather і вкажи його токен у локальному
`.env.local`. Решта сервісів і змінних можуть бути спільними.

## Вартість

Vercel Hobby ($0) + ClickUp Free ($0) + Upstash Redis free tier ($0) + OpenAI API
(оплата по факту використання gpt-4o-mini, копійки за таску).
