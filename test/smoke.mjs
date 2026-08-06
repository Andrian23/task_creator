// Local smoke test: mocks fetch (Telegram/OpenAI/ClickUp/Redis) and drives the
// webhook handler through a full "ask -> answer -> create" cycle.
// Run: node test/smoke.mjs
import assert from 'node:assert';
import {
  protectVerbatimSections,
  restoreVerbatimSections,
  addIncognitoFlags,
} from '../lib/verbatim.js';

const verbatimSource = `Brief:\nTranslate this brief.\nHooks:\nHook 1: Never change THIS!\nScript:\nFirst exact line.\n-- 2 of 4 --\nSecond exact line.\n[VISUAL: Translate this note]`;
const protectedVerbatim = protectVerbatimSections(verbatimSource);
assert.ok(!protectedVerbatim.text.includes('Never change THIS!'));
assert.ok(!protectedVerbatim.text.includes('Second exact line.'));
assert.ok(protectedVerbatim.text.includes('[VISUAL: Translate this note]'));
assert.strictEqual(
  restoreVerbatimSections(protectedVerbatim.text, protectedVerbatim.replacements),
  verbatimSource
);
const linked = protectVerbatimSections('Reference: https://example.com/video');
assert.ok(!linked.text.includes('https://example.com/video'));
assert.strictEqual(
  addIncognitoFlags(restoreVerbatimSections(linked.text, linked.replacements)),
  'Reference:\n**⚠️ Відкривати тільки в режимі інкогніто:**\nhttps://example.com/video'
);

process.env.TELEGRAM_BOT_TOKEN = 'TEST_TG_TOKEN';
process.env.CLICKUP_API_TOKEN = 'TEST_CU_TOKEN';
process.env.CLICKUP_LIST_ID = '123';
process.env.OPENAI_API_KEY = 'TEST_OAI_KEY';
process.env.UPSTASH_REDIS_URL = 'https://fake-redis.example.com';
process.env.UPSTASH_REDIS_TOKEN = 'TEST_REDIS_TOKEN';

const redisStore = new Map();
const sentMessages = [];

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);

  // Upstash Redis REST (command array in body)
  if (u.startsWith('https://fake-redis.example.com')) {
    const [cmd, key, ...args] = JSON.parse(opts.body);
    if (cmd === 'GET') {
      return jsonResponse({ result: redisStore.get(key) ?? null });
    }
    if (cmd === 'SET') {
      if (args.includes('NX') && redisStore.has(key)) {
        return jsonResponse({ result: null });
      }
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

  if (u.includes('api.telegram.org') && u.includes('/answerCallbackQuery')) {
    return jsonResponse({ ok: true });
  }

  // OpenAI chat completions
  if (u.includes('api.openai.com')) {
    const payload = {
            action: 'create',
            title: 'Зняти відео про X',
            title_source: 'user',
            description: 'Зняти відео про X, дедлайн пʼятниця',
            due_datetime: '2026-08-14T18:00:00+07:00',
            priority: 'high',
          };
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    });
  }

  // ClickUp create task
  if (u.includes('api.clickup.com')) {
    if (u.endsWith('/member')) {
      return jsonResponse({ members: [{ id: 42, username: 'Оля' }] });
    }
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

// Turn 1: bot always asks how to name the task
await handler(
  { method: 'POST', body: { update_id: 101, message: { chat: { id: 1 }, text: 'Оля: зняти відео про X' } } },
  fakeRes()
);
assert.strictEqual(sentMessages.length, 1);
assert.match(sentMessages[0].text, /Як назвати таску/);
assert.ok(redisStore.has('session:1'), 'session should wait for the title');

// Turn 2: user provides title instructions -> bot asks for the deadline
await handler(
  { method: 'POST', body: { update_id: 102, message: { chat: { id: 1 }, text: 'Назва: Зняти відео про X' } } },
  fakeRes()
);
assert.strictEqual(sentMessages.length, 2);
assert.strictEqual(sentMessages[1].text, 'На коли дедлайн?');

// Turn 3: user provides deadline -> model translates -> bot shows a preview
await handler(
  { method: 'POST', body: { update_id: 103, message: { chat: { id: 1 }, text: 'до пʼятниці' } } },
  fakeRes()
);
assert.strictEqual(sentMessages.length, 3);
assert.match(sentMessages[2].text, /Переглянь таску/);
assert.strictEqual(sentMessages[2].reply_markup.inline_keyboard[0][0].callback_data, 'review:approve');
assert.ok(redisStore.has('session:1'), 'pending task should wait for review');

// Turn 4: user approves preview -> bot asks for an assignee
await handler(
  {
    method: 'POST',
    body: {
      update_id: 104,
      callback_query: {
        id: 'callback-1',
        data: 'review:approve',
        message: { chat: { id: 1 } },
      },
    },
  },
  fakeRes()
);
assert.strictEqual(sentMessages.length, 4);
assert.match(sentMessages[3].text, /На кого призначити/);
assert.strictEqual(sentMessages[3].reply_markup.inline_keyboard[0][0].callback_data, 'assign:42');

// Turn 5: user selects a ClickUp member -> task is created and assigned
await handler(
  {
    method: 'POST',
    body: {
      update_id: 105,
      callback_query: {
        id: 'callback-2',
        data: 'assign:42',
        message: { chat: { id: 1 } },
      },
    },
  },
  fakeRes()
);
assert.strictEqual(sentMessages.length, 5);
assert.match(sentMessages[4].text, /app\.clickup\.com\/t\/abc123/);
assert.ok(!redisStore.has('session:1'), 'session should be cleared after task creation');

console.log('OK - all smoke assertions passed');
