// Simplest possible local run: no ngrok, no webhook, no public URL.
// The bot itself asks Telegram "any new messages?" in a loop (long polling)
// and feeds each one straight into the same handler used on Vercel.
//
// Usage:
//   npm run dev
//
// Just run it and message your bot in Telegram - that's it.
// (Long polling is for local dev only. On Vercel we use a webhook instead,
// because serverless functions can't run an infinite loop.)

import handler from './api/telegram.js';

const REQUIRED_VARS = [
    'TELEGRAM_BOT_TOKEN',
    'CLICKUP_API_TOKEN',
    'CLICKUP_LIST_ID',
    'OPENAI_API_KEY',
    'UPSTASH_REDIS_URL',
    'UPSTASH_REDIS_TOKEN',
];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length) {
    console.error(`Не задані env vars у .env.local: ${missing.join(', ')}`);
    process.exit(1);
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

async function fakeRes() {
    const state = {};
    return {
        status(code) {
            state.code = code;
            return this;
        },
        json(obj) {
            state.body = obj;
        },
        send(text) {
            state.body = text;
        },
        _state: state,
    };
}

async function pollLoop() {
    let offset = 0;

    // Drop any updates that piled up while the bot was offline, so we don't
    // reply to a backlog of old messages on startup.
    const initial = await fetch(`${API}/getUpdates?timeout=0`).then((r) => r.json());
    if (initial.ok && initial.result.length > 0) {
        offset = initial.result[initial.result.length - 1].update_id + 1;
    }

    console.log('Бот запущений (polling). Пиши йому в Telegram. Ctrl+C щоб зупинити.');

    while (true) {
        let data;
        try {
            const res = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`);
            data = await res.json();
        } catch (err) {
            console.error('Помилка getUpdates, повтор через 3с:', err.message);
            await new Promise((r) => setTimeout(r, 3000));
            continue;
        }

        if (!data.ok) {
            console.error('Telegram API error:', data);
            await new Promise((r) => setTimeout(r, 3000));
            continue;
        }

        for (const update of data.result) {
            offset = update.update_id + 1;
            try {
                await handler({ method: 'POST', body: update }, await fakeRes());
            } catch (err) {
                console.error('Помилка обробки повідомлення:', err);
            }
        }
    }
}

pollLoop();
