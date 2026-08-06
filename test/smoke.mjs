// Local smoke test: mocks fetch (Telegram/OpenAI/ClickUp/Redis) and drives the
// webhook handler through a full "ask -> answer -> create" cycle.
// Run: node test/smoke.mjs
import assert from 'node:assert';

process.env.TELEGRAM_BOT_TOKEN = 'TEST_TG_TOKEN';
process.env.CLICKUP_API_TOKEN = 'TEST_CU_TOKEN';
process.env.CLICKUP_LIST_ID = '123';
process.env.OPENAI_API_KEY = 'TEST_OAI_KEY';
process.env.UPSTASH_REDIS_URL = 'https://fake-redis.example.com';
process.env.UPSTASH_REDIS_TOKEN = 'TEST_REDIS_TOKEN';

const redisStore = new Map();
const sentMessages = [];
let openaiCallCount = 0;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);

  // Upstash Redis REST (command array in body)
  if (u.startsWith('https://fake-redis.example.com')) {
    const [cmd, key, ...args] = JSON.parse(opts.body);
    if (cmd === 'GET') {
      return jsonResponse({ result: redisStore.get(key) ?? null });
    }
    if (cmd === 'SET') {
      redisStore.set(key, args[0]);
      return jsonResponse({ result: 'OK' });
    }
    if (cmd === 'DEL') {
      redisStore.delete(key);
      return jsonResponse({ result: 1 });
    }
  }

  // Telegram sendMessage
  if (u.includes('api.telegram.org') && u.includes('/sendMessage')) {
    sentMessages.push(JSON.parse(opts.body));
    return jsonResponse({ ok: true });
  }

  // OpenAI chat completions
  if (u.includes('api.openai.com')) {
    openaiCallCount += 1;
    const payload =
      openaiCallCount === 1
        ? { action: 'ask', question: 'Який дедлайн?' }
        : {
            action: 'create',
            creator: 'Оля',
            title: 'Зняти відео про X',
            description: 'Зняти відео про X, дедлайн пʼятниця',
            due_date: '2026-08-14',
            priority: 'high',
          };
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    });
  }

  // ClickUp create task
  if (u.includes('api.clickup.com')) {
    return jsonResponse({ id: 'abc123', url: 'https://app.clickup.com/t/abc123' }, 200);
  }

  throw new Error(`Unmocked fetch: ${u}`);
};

function jsonResponse(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
  };
}

function fakeRes() {
  const state = {};
  return {
    status(code) {
      state.code = code;
      return this;
    },
    json(obj) {
      state.body = obj;
      return this;
    },
    send(obj) {
      state.body = obj;
      return this;
    },
    _state: state,
  };
}

const { default: handler } = await import('../api/telegram.js');

// Turn 1: user sends initial task text -> model asks a follow-up question
await handler(
  { method: 'POST', body: { message: { chat: { id: 1 }, text: 'Оля: зняти відео про X' } } },
  fakeRes()
);
assert.strictEqual(sentMessages.length, 1);
assert.strictEqual(sentMessages[0].text, 'Який дедлайн?');
assert.ok(redisStore.has('session:1'), 'session should be persisted after "ask"');

// Turn 2: user answers -> model returns create -> ClickUp task created, session cleared
await handler(
  { method: 'POST', body: { message: { chat: { id: 1 }, text: 'до пʼятниці' } } },
  fakeRes()
);
assert.strictEqual(sentMessages.length, 2);
assert.match(sentMessages[1].text, /app\.clickup\.com\/t\/abc123/);
assert.ok(!redisStore.has('session:1'), 'session should be cleared after task creation');

console.log('OK - all smoke assertions passed');
